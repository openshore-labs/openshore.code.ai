// The model sheet, in the Claude app's "Select model" shape. The root shows the
// default (Stack), any models the user has pinned, two category buttons that
// open dedicated sheets, the way Claude's "more models" expands (Cloud models
// and Local models), and the effort control last. The current pick wears a
// check. Each category has an honest empty state that routes to setup. When no
// stack exists yet, the Stack row is the way in to build one. Models in the
// category sheets swipe left to pin; a pinned model rides under Stack for
// one-tap use and swipes there to unpin. On a phone the very top row is the
// model on this phone: Harbor once it is downloaded, else Harbor Lite (with
// Harbor's download progress under it while it comes down). Harbor replaces
// Harbor Lite there, since the better model makes the guide moot (maintainer,
// 2026-09-25). On the desktop the top rows are this computer's engine: its
// agent and, beside it, the free chat with its own model (tech review ruling 8); Local
// models there lists that free chat, or the way to DeepBlue in the Stack,
// never the phone's own download.
import { useEffect, useRef, useState } from 'react';
import type { ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { dockedNoun, dockedNounLower } from '../lib/docking.js';
import type { Where } from '../lib/runsOn.js';
import { dockedModelLine, dockedNoModelLine } from '../lib/serverKeys.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { isDesktop, isPhone } from '../lib/platform.js';
import { HARBOR_BYLINE, HARBOR_MODEL_ID, HARBOR_MODEL_NAME } from '../lib/harbor.js';
import {
  HARBOR_MINI_BYLINE,
  HARBOR_MINI_MODEL_ID,
  HARBOR_MINI_MODEL_NAME,
} from '../lib/harborMini.js';
import { bridge, type DesktopStatus } from '../lib/electronBridge.js';
import { daemonStack } from '../drivers/remoteDriver.js';
import type { DaemonStackInfo } from 'os-code/protocol';
import {
  CLAUDE_MODELS_PRIMARY,
  CLAUDE_MODELS_MORE,
  claudeModelLabel,
} from '../lib/claudeModels.js';
import { PROVIDERS, providerInfo, providerModelLabel } from '../lib/providers.js';
import { EFFORTS, effortLabel, DEFAULT_EFFORT } from '../lib/effort.js';
import { isPinned, pinKey, togglePin } from '../lib/pins.js';
import { SwipeRow } from './SwipeRow.js';
import { engineChatReady } from '../state/firstRunOps.js';
import { HARBOR_MASTER_MODEL_NAME } from '../lib/harborMaster.js';
import { BackGlyph, CheckGlyph, ChevronGlyph, CloseGlyph } from './SheetGlyphs.js';
import { Icon } from './Icon.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';
import {
  CLOUD_SHEET_OFFLINE,
  CLOUD_WAITS,
  computerOfflineOf,
  offlineNoSeatSub,
  offlineNow,
  offlineSeatSub,
} from '../state/offlineOps.js';

/** The desktop's free chat row, and the Local models sheet's words there. */
export const DESKTOP_CHAT_ROW = 'Chat with this computer';
export const DESKTOP_CHAT_SUB = 'Free. Read-only, no repository or edits.';
export const DESKTOP_LOCAL_EMPTY = `No model on this computer yet. Set up ${HARBOR_MASTER_MODEL_NAME} in the Stack. It is free and runs here.`;

function RowContent({
  main,
  sub,
  value,
  chevron,
}: {
  main: string;
  sub?: string;
  value?: string;
  chevron?: boolean;
}) {
  return (
    <>
      <span className="ms-row-text">
        <span className="ms-row-main">{main}</span>
        {sub ? <span className="ms-row-sub">{sub}</span> : null}
      </span>
      {value ? <span className="ms-row-value">{value}</span> : null}
      {chevron ? (
        <span className="ms-row-chev" aria-hidden="true">
          <ChevronGlyph size={16} />
        </span>
      ) : null}
    </>
  );
}

/** A cloud model while offline (Desktop Offline): shown, so the person sees
 *  what waits, but not a pick, and in the muted ink of a row that cannot be
 *  tapped, with no spend mark. Its sheet says why once, at the top
 *  (CLOUD_SHEET_OFFLINE), so the row is its name alone. */
function WaitingRow({ main }: { main: string }) {
  return (
    <div className="ms-row ms-row-disabled" aria-disabled="true">
      <RowContent main={main} />
    </div>
  );
}

/** The current pick's mark at a row's trailing edge. */
function RowCheck() {
  return (
    <span className="ms-row-check" aria-hidden="true">
      <CheckGlyph size={18} />
    </span>
  );
}

function Row({
  main,
  sub,
  value,
  chevron,
  selected,
  onClick,
}: {
  main: string;
  sub?: string;
  value?: string;
  chevron?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="ms-row press-fb"
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
    >
      <RowContent main={main} sub={sub} value={value} chevron={chevron} />
      {selected ? <RowCheck /> : null}
    </button>
  );
}

/** A visible favorite toggle on a model row. It sits alongside the row's tap
 *  (pick) and the swipe (pin), so a favorite is one obvious tap, not a hidden
 *  gesture. Pointer-down and click are stopped so the star never also fires the
 *  row's pick or starts a swipe. */
function PinStar({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`ms-pin${pinned ? ' on' : ''}`}
      aria-label={pinned ? 'Unpin from favorites' : 'Pin as a favorite'}
      aria-pressed={pinned}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Icon size={20} weight="hairline">
        <path
          d="M12 3.6l2.35 4.77 5.26.76-3.8 3.71.9 5.24L12 15.9l-4.71 2.48.9-5.24-3.8-3.71 5.26-.76z"
          fill={pinned ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeLinejoin="round"
        />
      </Icon>
    </button>
  );
}

/** A short, human name for a pinned source, shown under Stack. */
function pinLabel(s: ConversationSource): string {
  if (s.kind === 'cloud') {
    return s.provider === 'anthropic'
      ? claudeModelLabel(s.model)
      : providerModelLabel(s.provider, s.model);
  }
  if (s.kind === 'device') return s.modelName;
  return 'Model';
}

function pinSub(s: ConversationSource): string {
  if (s.kind === 'cloud') {
    const name =
      s.provider === 'anthropic' ? 'Claude' : (providerInfo(s.provider)?.name ?? s.provider);
    return `${name}, in the cloud`;
  }
  if (s.kind === 'device') return 'Runs fully on this device';
  return '';
}

export function ModelSheet({
  onPick,
  onClose,
  initialStage = 'root',
  current,
  machine,
}: {
  onPick: (source: ConversationSource) => void;
  onClose: () => void;
  /** Which sub-sheet to open on. Defaults to root; the out-of-usage tap opens 'local'. */
  initialStage?: 'root' | 'effort' | 'cloud' | 'local';
  /** The brain the composer answers with now. Its row wears the check. */
  current?: ConversationSource;
  /** The machine this chat runs on (lib/runsOn.ts): its models are the ones
   *  listed. Unset, this device's own: this computer on the desktop, the
   *  active docked machine on a phone. */
  machine?: Where;
}) {
  const {
    settings,
    connectedProviders,
    cloudKeyPresent,
    saveSettings,
    setView,
    sourceReady,
    harborDownload,
    connectivity,
  } = useApp();
  // Offline (the connection's or the person's choice), cloud models wait for
  // a connection: listed, never picked (Desktop Offline, 2026-10-07).
  const offline = offlineNow(connectivity, settings.profileOverride);
  const [stage, setStage] = useState<'root' | 'effort' | 'cloud' | 'local' | 'more'>(initialStage);
  // Play the exit before a pick propagates (UI-4): the parent unmounts this
  // sheet the moment it learns the choice, so the choice is held until the
  // slide-down has landed. ApprovalSheet does the same.
  const pending = useRef<(() => void) | null>(null);
  const { closing, dismiss } = useSheetExit(() => {
    const run = pending.current;
    pending.current = null;
    if (run) run();
    else onClose();
  });
  const pick = (source: ConversationSource) => {
    pending.current = () => onPick(source);
    dismiss();
  };
  const effort = settings.effort ?? DEFAULT_EFFORT;
  const isCurrent = (s: ConversationSource) =>
    Boolean(current && current.kind === s.kind && pinKey(s) === pinKey(current));

  // Your paired computer's stack: the model(s) your machine runs, reachable
  // over your connection. Picking it runs the agent ON the box (the phone is
  // the remote control), so backgrounding never truncates a reply. Fetched
  // when a daemon is paired; 'error' means paired but unreachable right now.
  const machineWhere: Where =
    machine ??
    (isDesktop()
      ? { kind: 'local' }
      : settings.daemon
        ? { kind: 'docked', target: settings.daemon }
        : { kind: 'none' });
  const daemon = machineWhere.kind === 'docked' ? machineWhere.target : undefined;
  // This computer's own rows, or the docked machine's: a desktop chat whose
  // project runs on a server lists that server, the way a phone does.
  const localRows = isDesktop() && machineWhere.kind === 'local';
  const [boxStack, setBoxStack] = useState<DaemonStackInfo | 'error' | undefined>(undefined);
  useEffect(() => {
    if (!daemon) return;
    let live = true;
    daemonStack(daemon)
      .then((s) => live && setBoxStack(s))
      .catch(() => live && setBoxStack('error'));
    return () => {
      live = false;
    };
    // By address, so a machine read fresh each render is not asked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daemon?.baseUrl, daemon?.token]);
  const boxModel =
    boxStack && boxStack !== 'error' ? (boxStack.orchestrator?.model ?? undefined) : undefined;
  // Where that model runs: on the machine, or, for a cloud model, at its
  // provider on your key, sent from the machine (keys on your server,
  // 2026-10-09: a server's model is often a cloud one).
  const boxLine =
    daemon && boxStack && boxStack !== 'error' && boxStack.orchestrator
      ? dockedModelLine(boxStack.orchestrator, dockedNounLower(daemon))
      : undefined;
  // Desktop Offline: your computer works offline (its network is down, or
  // Offline is chosen there) with a cloud model running its show. That model
  // waits for the computer's connection, and the one its engine seats there
  // answers meanwhile, named, or none can yet. The phone's own reach is
  // untouched, so nothing else in this sheet changes.
  const boxCloudOffline =
    boxStack !== undefined &&
    boxStack !== 'error' &&
    computerOfflineOf(boxStack) !== undefined &&
    boxStack.orchestrator?.kind === 'cloud';
  const boxSeat = boxCloudOffline ? boxStack.offlineSeat?.model : undefined;
  // The free chat runs only a model that stays on the computer's network
  // (the daemon refuses any other by address), so its row shows only then,
  // as the desktop's does (engineChatReady).
  const boxChat =
    boxStack !== undefined &&
    boxStack !== 'error' &&
    boxStack.orchestrator !== undefined &&
    boxStack.orchestrator.kind !== 'cloud';

  // The desktop app's own engine: the model this machine runs (Ollama or a
  // cloud key set up in the Stack). This is the default brain on desktop, so
  // it gets the top row, with an honest "set one up" state routing to the
  // Stack when nothing is configured yet.
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | 'error' | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!isDesktop() || !bridge()) return;
    let live = true;
    bridge()!
      .status()
      .then((s) => live && setDesktopStatus(s))
      .catch(() => live && setDesktopStatus('error'));
    return () => {
      live = false;
    };
  }, []);
  const engineModel =
    desktopStatus && desktopStatus !== 'error'
      ? desktopStatus.stack.orchestrator?.model
      : undefined;
  // The free chat with that model (tech review ruling 8): no tools, no session, no
  // account. Only a local model, since the free chat refuses one that leaves
  // this network.
  const engineChat =
    desktopStatus && desktopStatus !== 'error' && engineChatReady(desktopStatus)
      ? desktopStatus.stack.orchestrator?.model
      : undefined;
  // Offline with a cloud model running the show, this computer's engine
  // answers on its own best model (the engine's offline seat), or, with
  // none installed, cannot answer yet.
  const engineCloudOffline =
    offline &&
    desktopStatus !== undefined &&
    desktopStatus !== 'error' &&
    desktopStatus.stack.orchestrator?.kind === 'cloud';
  // The seat is the engine's own, read across every provider on this
  // network by address, so the row names the model that will answer.
  const engineSeat = engineCloudOffline ? desktopStatus.offlineSeat?.model : undefined;
  const engineOfflineEmpty = engineCloudOffline && !engineSeat;
  const engineOrchestrator =
    desktopStatus && desktopStatus !== 'error' ? desktopStatus.stack.orchestrator : undefined;
  const engineSub = engineSeat
    ? offlineSeatSub(engineSeat, 'this computer')
    : engineOrchestrator
      ? dockedModelLine(engineOrchestrator, 'this computer')
      : `${engineModel}, running on this computer`;

  // The same signal the send path checks, so a stack built after the per-profile
  // stacks landed is pickable. The old read looked at the retired single-stack
  // settings field and left "My Stack" greyed on every fresh device.
  const hasStack = sourceReady({ kind: 'stack' });
  const claudeReady = cloudKeyPresent;
  const otherProviders = PROVIDERS.filter((p) => p.id !== 'anthropic' && connectedProviders[p.id]);
  const cloudEmpty = !claudeReady && otherProviders.length === 0;
  // The built-in guides are ready flags, not deviceModels entries, so Harbor is
  // listed here once downloaded (it used to reach no row but the Stack's).
  const deviceModels = [
    ...(settings.harborReady && !settings.deviceModels[HARBOR_MODEL_ID]
      ? ([[HARBOR_MODEL_ID, HARBOR_MODEL_NAME]] as Array<[string, string]>)
      : []),
    ...Object.entries(settings.deviceModels),
  ];
  const harborSource: ConversationSource = {
    kind: 'device',
    modelId: HARBOR_MODEL_ID,
    modelName: HARBOR_MODEL_NAME,
  };
  const harborLiteSource: ConversationSource = {
    kind: 'device',
    modelId: HARBOR_MINI_MODEL_ID,
    modelName: HARBOR_MINI_MODEL_NAME,
  };
  const harborComing = Boolean(harborDownload && !harborDownload.failed);
  const pins = settings.pinnedModels ?? [];

  const setPin = (source: ConversationSource) => {
    void saveSettings({ pinnedModels: togglePin(pins, source) });
  };

  // Leaving for a setup room plays the sheet's exit first, like a pick does,
  // so the sheet never snaps away mid-glide.
  const goto = (view: Parameters<typeof setView>[0]) => {
    pending.current = () => {
      setView(view);
      onClose();
    };
    dismiss();
  };

  const Header = ({ title }: { title: string }) => (
    <div className="mode-head">
      <button
        className="mode-close press-fb"
        aria-label={stage === 'root' ? 'Close' : 'Back'}
        onClick={() =>
          stage === 'root' ? dismiss() : setStage(stage === 'more' ? 'cloud' : 'root')
        }
      >
        {stage === 'root' ? <CloseGlyph /> : <BackGlyph />}
      </button>
      <h2>{title}</h2>
    </div>
  );

  return (
    <div className={`sheet-scrim${closing ? ' closing' : ''}`} onClick={dismiss}>
      <div
        className={`sheet model-sheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Select model"
        onClick={(e) => e.stopPropagation()}
      >
        {stage === 'root' ? (
          <>
            <Header title="Select model" />
            {localRows ? (
              <div className="ms-group">
                {desktopStatus === undefined ? (
                  <div className="ms-row ms-row-disabled">
                    <span className="ms-row-text">
                      <span className="ms-row-main">This computer</span>
                      <span className="ms-row-sub">Checking this computer...</span>
                    </span>
                  </div>
                ) : engineModel && engineOfflineEmpty ? (
                  <div className="ms-row ms-row-disabled" aria-disabled="true">
                    <span className="ms-row-text">
                      <span className="ms-row-main">This computer</span>
                      <span className="ms-row-sub">{offlineNoSeatSub('this computer')}</span>
                    </span>
                  </div>
                ) : engineModel ? (
                  <>
                    <Row
                      main="This computer"
                      sub={engineSub}
                      selected={isCurrent({ kind: 'desktop' })}
                      onClick={() => pick({ kind: 'desktop' })}
                    />
                    {/* The free companion to the agent above, the same as the
                        phone's: chat with this computer's own model, no
                        repository, no edits, no account. */}
                    {engineChat ? (
                      <Row
                        main={DESKTOP_CHAT_ROW}
                        sub={DESKTOP_CHAT_SUB}
                        selected={isCurrent({ kind: 'desktop-chat' })}
                        onClick={() => pick({ kind: 'desktop-chat' })}
                      />
                    ) : null}
                  </>
                ) : (
                  <Row
                    main="This computer"
                    sub="No model set up yet. Build your stack."
                    chevron
                    onClick={() => goto('stack')}
                  />
                )}
              </div>
            ) : null}
            {isPhone() && (settings.harborReady || settings.harborMiniReady || harborComing) ? (
              <div className="ms-group">
                {settings.harborReady ? (
                  <Row
                    main={HARBOR_MODEL_NAME}
                    sub={HARBOR_BYLINE}
                    selected={isCurrent(harborSource)}
                    onClick={() => pick(harborSource)}
                  />
                ) : (
                  <>
                    {settings.harborMiniReady ? (
                      <Row
                        main={HARBOR_MINI_MODEL_NAME}
                        sub={HARBOR_MINI_BYLINE}
                        selected={isCurrent(harborLiteSource)}
                        onClick={() => pick(harborLiteSource)}
                      />
                    ) : null}
                    {harborComing && harborDownload ? (
                      <div className="ms-row ms-row-disabled" aria-live="polite">
                        <span className="ms-row-text">
                          <span className="ms-row-main">{HARBOR_MODEL_NAME}</span>
                          <span className="ms-row-sub">
                            Downloading, {harborDownload.label}. It takes this spot when it is
                            ready.
                          </span>
                        </span>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            {!localRows ? (
              <div className="ms-group">
                {!daemon ? (
                  <Row
                    main="Connect your computer"
                    sub="Use your computer's models from here, while it is on."
                    chevron
                    onClick={() => goto('pair')}
                  />
                ) : boxStack === undefined ? (
                  <div className="ms-row ms-row-disabled">
                    <span className="ms-row-text">
                      <span className="ms-row-main">{dockedNoun(daemon)}</span>
                      <span className="ms-row-sub">Checking {dockedNounLower(daemon)}...</span>
                    </span>
                  </div>
                ) : boxStack === 'error' ? (
                  <Row
                    main={dockedNoun(daemon)}
                    sub="Not reachable right now. Reconnect."
                    chevron
                    onClick={() => goto('pair')}
                  />
                ) : boxModel && boxCloudOffline && !boxSeat ? (
                  <div className="ms-row ms-row-disabled" aria-disabled="true">
                    <span className="ms-row-text">
                      <span className="ms-row-main">{dockedNoun(daemon)}</span>
                      <span className="ms-row-sub">
                        {offlineNoSeatSub(dockedNounLower(daemon))}
                      </span>
                    </span>
                  </div>
                ) : boxModel ? (
                  <Row
                    main={dockedNoun(daemon)}
                    sub={boxSeat ? offlineSeatSub(boxSeat, dockedNounLower(daemon)) : boxLine}
                    selected={isCurrent({ kind: 'desktop' })}
                    onClick={() => pick({ kind: 'desktop' })}
                  />
                ) : (
                  <div className="ms-row ms-row-disabled">
                    <span className="ms-row-text">
                      <span className="ms-row-main">{dockedNoun(daemon)}</span>
                      <span className="ms-row-sub">
                        {dockedNoModelLine(daemon, settings.hubRoles?.[daemon.baseUrl])}
                      </span>
                    </span>
                  </div>
                )}
                {/* The free companion to the paid agent above: read-only chat
                    with the same local models, no repo, no edits, no charge. */}
                {daemon && boxChat ? (
                  <Row
                    main={`Chat with ${dockedNounLower(daemon)}`}
                    sub="Free. Read-only, no repository or edits."
                    selected={isCurrent({ kind: 'desktop-chat' })}
                    onClick={() => pick({ kind: 'desktop-chat' })}
                  />
                ) : null}
              </div>
            ) : null}
            <div className="ms-group">
              {hasStack ? (
                <Row
                  main="Stack"
                  sub="Your Reasoning model routes each task"
                  selected={isCurrent({ kind: 'stack' })}
                  onClick={() => pick({ kind: 'stack' })}
                />
              ) : (
                <Row
                  main="Stack"
                  sub="Not set up yet. Build your stack."
                  chevron
                  onClick={() => goto('stack')}
                />
              )}
              {pins.map((src) => {
                // A favorite whose model is not set up any more (its key was
                // removed, its download deleted) is shown quiet and honest, not
                // offered as a pick that would only toast "not ready".
                const waits = offline && src.kind === 'cloud';
                const ready = sourceReady(src) && !waits;
                return (
                  <SwipeRow
                    key={pinKey(src)}
                    pinned
                    onTap={() => (ready ? pick(src) : undefined)}
                    onToggle={() => setPin(src)}
                  >
                    <div className={`ms-row${ready ? '' : ' ms-row-disabled'}`}>
                      <RowContent
                        main={pinLabel(src)}
                        sub={
                          ready
                            ? pinSub(src)
                            : waits
                              ? CLOUD_WAITS
                              : 'Not set up on this device right now'
                        }
                      />
                      {ready && isCurrent(src) ? <RowCheck /> : null}
                      <PinStar pinned onToggle={() => setPin(src)} />
                    </div>
                  </SwipeRow>
                );
              })}
            </div>

            <div className="ms-group">
              <Row
                main="Cloud models"
                sub={offline ? CLOUD_WAITS : undefined}
                chevron
                onClick={() => setStage('cloud')}
              />
              <Row main="Local models" chevron onClick={() => setStage('local')} />
            </div>

            <div className="ms-group">
              <Row
                main="Effort"
                value={effortLabel(effort)}
                chevron
                onClick={() => setStage('effort')}
              />
            </div>
          </>
        ) : null}

        {stage === 'effort' ? (
          <>
            <Header title="Effort" />
            <div className="ms-group">
              {EFFORTS.map((e) => (
                <Row
                  key={e}
                  main={effortLabel(e)}
                  selected={e === effort}
                  onClick={() => {
                    void saveSettings({ effort: e });
                    setStage('root');
                  }}
                />
              ))}
            </div>
          </>
        ) : null}

        {stage === 'cloud' ? (
          <>
            <Header title="Cloud models" />
            {cloudEmpty ? (
              <button className="ms-empty press-fb" onClick={() => goto('connections')}>
                No cloud model connected yet. Connect one on your own API key.
              </button>
            ) : (
              <>
                {offline ? <p className="ms-note">{CLOUD_SHEET_OFFLINE}</p> : null}
                {claudeReady ? (
                  <>
                    <div className="ms-heading">Claude</div>
                    <div className="ms-group">
                      {CLAUDE_MODELS_PRIMARY.map((m) => {
                        if (offline) return <WaitingRow key={m.id} main={m.label} />;
                        const src: ConversationSource = {
                          kind: 'cloud',
                          provider: 'anthropic',
                          model: m.id,
                        };
                        return (
                          <SwipeRow
                            key={m.id}
                            pinned={isPinned(pins, src)}
                            onTap={() => pick(src)}
                            onToggle={() => setPin(src)}
                          >
                            <div className="ms-row">
                              <RowContent main={m.label} sub={m.blurb} />
                              {isCurrent(src) ? <RowCheck /> : null}
                              <PinStar pinned={isPinned(pins, src)} onToggle={() => setPin(src)} />
                            </div>
                          </SwipeRow>
                        );
                      })}
                      <Row main="More models" chevron onClick={() => setStage('more')} />
                    </div>
                  </>
                ) : null}
                {otherProviders.map((p) => (
                  <div key={p.id}>
                    <div className="ms-heading">{p.name}</div>
                    <div className="ms-group">
                      {p.models.map((m) => {
                        if (offline) return <WaitingRow key={m.id} main={m.label} />;
                        const src: ConversationSource = {
                          kind: 'cloud',
                          provider: p.id,
                          model: m.id,
                        };
                        return (
                          <SwipeRow
                            key={m.id}
                            pinned={isPinned(pins, src)}
                            onTap={() => pick(src)}
                            onToggle={() => setPin(src)}
                          >
                            <div className="ms-row">
                              <RowContent main={m.label} sub={m.tagline} />
                              {isCurrent(src) ? <RowCheck /> : null}
                              <PinStar pinned={isPinned(pins, src)} onToggle={() => setPin(src)} />
                            </div>
                          </SwipeRow>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        ) : null}

        {stage === 'more' ? (
          <>
            <Header title="More models" />
            {offline ? <p className="ms-note">{CLOUD_SHEET_OFFLINE}</p> : null}
            <div className="ms-heading">Claude</div>
            <div className="ms-group">
              {CLAUDE_MODELS_MORE.map((m) => {
                if (offline) return <WaitingRow key={m.id} main={m.label} />;
                const src: ConversationSource = {
                  kind: 'cloud',
                  provider: 'anthropic',
                  model: m.id,
                };
                return (
                  <SwipeRow
                    key={m.id}
                    pinned={isPinned(pins, src)}
                    onTap={() => pick(src)}
                    onToggle={() => setPin(src)}
                  >
                    <div className="ms-row">
                      <RowContent main={m.label} sub={m.blurb} />
                      {isCurrent(src) ? <RowCheck /> : null}
                      <PinStar pinned={isPinned(pins, src)} onToggle={() => setPin(src)} />
                    </div>
                  </SwipeRow>
                );
              })}
            </div>
          </>
        ) : null}

        {stage === 'local' && isDesktop() ? (
          // On the desktop the local models are the engine's, run by Ollama
          // on this computer; the on-device list is the phone's own. So this
          // lists the free chat with the engine's model, or, with none set
          // up, the way to DeepBlue in the Stack.
          <>
            <Header title="Local models" />
            {engineChat ? (
              <div className="ms-group">
                <Row
                  main={engineChat}
                  sub={DESKTOP_CHAT_SUB}
                  selected={isCurrent({ kind: 'desktop-chat' })}
                  onClick={() => pick({ kind: 'desktop-chat' })}
                />
              </div>
            ) : (
              <button className="ms-empty press-fb" onClick={() => goto('stack')}>
                {DESKTOP_LOCAL_EMPTY}
              </button>
            )}
          </>
        ) : null}

        {stage === 'local' && !isDesktop() ? (
          <>
            <Header title="Local models" />
            {deviceModels.length ? (
              <div className="ms-group">
                {deviceModels.map(([id, name]) => {
                  const src: ConversationSource = {
                    kind: 'device',
                    modelId: id,
                    modelName: name,
                  };
                  return (
                    <SwipeRow
                      key={id}
                      pinned={isPinned(pins, src)}
                      onTap={() => pick(src)}
                      onToggle={() => setPin(src)}
                    >
                      <div className="ms-row">
                        <RowContent main={name} sub="Runs fully on this device" />
                        {isCurrent(src) ? <RowCheck /> : null}
                        <PinStar pinned={isPinned(pins, src)} onToggle={() => setPin(src)} />
                      </div>
                    </SwipeRow>
                  );
                })}
              </div>
            ) : (
              <button className="ms-empty press-fb" onClick={() => goto('settings')}>
                No coding model on {thisDeviceNoun()} yet. Get Harbor in Settings.
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
