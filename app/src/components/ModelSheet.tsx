// The model sheet, in the Claude app's "Select model" shape. The root shows the
// default (My Stack), any models the user has pinned, the effort control, and two
// category buttons that open dedicated sheets, the way Claude's "more models"
// expands: Cloud Providers and Local LLMs. Each category has an honest empty
// state that routes to setup. When no stack exists yet, My Stack is greyed with a
// link to build one. Models in the category sheets swipe left to pin; a pinned
// model rides under My Stack for one-tap use and swipes there to unpin.
import { useEffect, useState } from 'react';
import type { ConversationSource } from '../state/types.js';
import { useApp } from '../state/store.js';
import { useSheetExit } from '../hooks/useSheetExit.js';
import { isDesktop } from '../lib/platform.js';
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
import { BackGlyph, CloseGlyph } from './SheetGlyphs.js';

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
          {'›'}
        </span>
      ) : null}
    </>
  );
}

function Row({
  main,
  sub,
  value,
  chevron,
  highlight,
  onClick,
}: {
  main: string;
  sub?: string;
  value?: string;
  chevron?: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`ms-row press-fb${highlight ? ' ms-row-default' : ''}`} onClick={onClick}>
      <RowContent main={main} sub={sub} value={value} chevron={chevron} />
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
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M12 3.6l2.35 4.77 5.26.76-3.8 3.71.9 5.24L12 15.9l-4.71 2.48.9-5.24-3.8-3.71 5.26-.76z"
          fill={pinned ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** A short, human name for a pinned source, shown under My Stack. */
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
}: {
  onPick: (source: ConversationSource) => void;
  onClose: () => void;
  /** Which sub-sheet to open on. Defaults to root; the out-of-usage tap opens 'local'. */
  initialStage?: 'root' | 'effort' | 'cloud' | 'local';
}) {
  const { settings, connectedProviders, cloudKeyPresent, saveSettings, setView } = useApp();
  const [stage, setStage] = useState<'root' | 'effort' | 'cloud' | 'local' | 'more'>(initialStage);
  const { closing, dismiss } = useSheetExit(onClose);
  const effort = settings.effort ?? DEFAULT_EFFORT;

  // Your paired computer's stack: the model(s) your machine runs, reachable
  // over your connection. Picking it runs the agent ON the box (the phone is
  // the remote control), so backgrounding never truncates a reply. Fetched
  // when a daemon is paired; 'error' means paired but unreachable right now.
  const daemon = settings.daemon;
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
  }, [daemon]);
  const boxModel =
    boxStack && boxStack !== 'error' ? (boxStack.orchestrator?.model ?? undefined) : undefined;

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

  const hasStack = Boolean(settings.stack);
  const claudeReady = cloudKeyPresent || isDesktop();
  const otherProviders = PROVIDERS.filter((p) => p.id !== 'anthropic' && connectedProviders[p.id]);
  const cloudEmpty = !claudeReady && otherProviders.length === 0;
  const deviceModels = Object.entries(settings.deviceModels);
  const pins = settings.pinnedModels ?? [];

  const setPin = (source: ConversationSource) => {
    void saveSettings({ pinnedModels: togglePin(pins, source) });
  };

  const goto = (view: Parameters<typeof setView>[0]) => {
    setView(view);
    onClose();
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
        onClick={(e) => e.stopPropagation()}
      >
        {stage === 'root' ? (
          <>
            <Header title="Select model" />
            {isDesktop() ? (
              <div className="ms-group">
                {desktopStatus === undefined ? (
                  <Row main="This computer" sub="Checking your engine..." onClick={() => {}} />
                ) : engineModel ? (
                  <Row
                    main="This computer"
                    sub={`${engineModel}, running on this machine`}
                    highlight
                    onClick={() => onPick({ kind: 'desktop' })}
                  />
                ) : (
                  <div className="ms-row ms-row-disabled">
                    <span className="ms-row-text">
                      <span className="ms-row-main">This computer</span>
                      <button className="ms-sublink press-fb" onClick={() => goto('stack')}>
                        No model set up yet. Build your stack
                      </button>
                    </span>
                  </div>
                )}
              </div>
            ) : null}
            {!isDesktop() ? (
              <div className="ms-group">
                {!daemon ? (
                  <Row
                    main="Connect your computer"
                    sub="Run your own model on your machine, from anywhere"
                    chevron
                    onClick={() => goto('pair')}
                  />
                ) : boxStack === undefined ? (
                  <Row main="My computer" sub="Checking your connection..." onClick={() => {}} />
                ) : boxStack === 'error' ? (
                  <div className="ms-row ms-row-disabled">
                    <span className="ms-row-text">
                      <span className="ms-row-main">My computer</span>
                      <button className="ms-sublink press-fb" onClick={() => goto('pair')}>
                        Not reachable right now. Reconnect
                      </button>
                    </span>
                  </div>
                ) : boxModel ? (
                  <Row
                    main="My computer"
                    sub={`${boxModel}, running on your machine`}
                    highlight
                    onClick={() => onPick({ kind: 'desktop' })}
                  />
                ) : (
                  <div className="ms-row ms-row-disabled">
                    <span className="ms-row-text">
                      <span className="ms-row-main">My computer</span>
                      <span className="ms-row-sub">No model set up on your computer yet.</span>
                    </span>
                  </div>
                )}
                {/* The free companion to the paid agent above: read-only chat
                    with the same local models, no repo, no edits, no charge. */}
                {daemon && boxStack && boxStack !== 'error' ? (
                  <Row
                    main="Chat with your computer"
                    sub="Free. Read-only, no repo or edits."
                    onClick={() => onPick({ kind: 'desktop-chat' })}
                  />
                ) : null}
              </div>
            ) : null}
            <div className="ms-group">
              {hasStack ? (
                <Row
                  main="My Stack"
                  sub="Your Reasoning LLM routes each task"
                  highlight
                  onClick={() => onPick({ kind: 'stack' })}
                />
              ) : (
                <div className="ms-row ms-row-disabled">
                  <span className="ms-row-text">
                    <span className="ms-row-main">My Stack</span>
                    <button className="ms-sublink press-fb" onClick={() => goto('stack')}>
                      Create your stack to get started
                    </button>
                  </span>
                </div>
              )}
              {pins.map((src) => (
                <SwipeRow
                  key={pinKey(src)}
                  pinned
                  onTap={() => onPick(src)}
                  onToggle={() => setPin(src)}
                >
                  <div className="ms-row">
                    <RowContent main={pinLabel(src)} sub={pinSub(src)} />
                    <PinStar pinned onToggle={() => setPin(src)} />
                  </div>
                </SwipeRow>
              ))}
            </div>

            <div className="ms-group">
              <Row
                main="Effort"
                value={effortLabel(effort)}
                chevron
                onClick={() => setStage('effort')}
              />
            </div>

            <div className="ms-group">
              <Row main="Cloud Providers" chevron onClick={() => setStage('cloud')} />
              <Row main="Local LLMs" chevron onClick={() => setStage('local')} />
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
                  value={e === effort ? '✓' : undefined}
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
            <Header title="Cloud Providers" />
            {cloudEmpty ? (
              <button className="ms-empty press-fb" onClick={() => goto('connections')}>
                No connected providers, add your API to get started.
              </button>
            ) : (
              <>
                {claudeReady ? (
                  <>
                    <div className="ms-heading">Claude</div>
                    <div className="ms-group">
                      {CLAUDE_MODELS_PRIMARY.map((m) => {
                        const src: ConversationSource = {
                          kind: 'cloud',
                          provider: 'anthropic',
                          model: m.id,
                        };
                        return (
                          <SwipeRow
                            key={m.id}
                            pinned={isPinned(pins, src)}
                            onTap={() => onPick(src)}
                            onToggle={() => setPin(src)}
                          >
                            <div className="ms-row">
                              <RowContent main={m.label} sub={m.blurb} />
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
                        const src: ConversationSource = {
                          kind: 'cloud',
                          provider: p.id,
                          model: m.id,
                        };
                        return (
                          <SwipeRow
                            key={m.id}
                            pinned={isPinned(pins, src)}
                            onTap={() => onPick(src)}
                            onToggle={() => setPin(src)}
                          >
                            <div className="ms-row">
                              <RowContent main={m.label} sub={m.tagline} />
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
            <div className="ms-heading">Claude</div>
            <div className="ms-group">
              {CLAUDE_MODELS_MORE.map((m) => {
                const src: ConversationSource = {
                  kind: 'cloud',
                  provider: 'anthropic',
                  model: m.id,
                };
                return (
                  <SwipeRow
                    key={m.id}
                    pinned={isPinned(pins, src)}
                    onTap={() => onPick(src)}
                    onToggle={() => setPin(src)}
                  >
                    <div className="ms-row">
                      <RowContent main={m.label} sub={m.blurb} />
                      <PinStar pinned={isPinned(pins, src)} onToggle={() => setPin(src)} />
                    </div>
                  </SwipeRow>
                );
              })}
            </div>
          </>
        ) : null}

        {stage === 'local' ? (
          <>
            <Header title="Local LLMs" />
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
                      onTap={() => onPick(src)}
                      onToggle={() => setPin(src)}
                    >
                      <div className="ms-row">
                        <RowContent main={name} sub="Runs fully on this device" />
                        <PinStar pinned={isPinned(pins, src)} onToggle={() => setPin(src)} />
                      </div>
                    </SwipeRow>
                  );
                })}
              </div>
            ) : (
              <button className="ms-empty press-fb" onClick={() => goto('marketplace')}>
                No connected local LLMs, download a model from the Marketplace to get started.
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
