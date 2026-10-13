// Stack: the one mandatory orchestrator and the optional specialists.
// Editable on the desktop; the phone shows the live picture from the daemon.
import { InstallByName } from '../components/InstallByName.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isOllamaCloudTag, type DaemonStackInfo } from 'os-code/protocol';
import { stackAdmin, useApp } from '../state/store.js';
import { bridge, type DesktopStatus } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonStack } from '../drivers/remoteDriver.js';
import { BackBar } from '../components/BackBar.js';
import { StackManager } from '../components/StackManager.js';
import { hardwareFromSummary } from '../lib/firstSeat.js';
import { HARBOR_MASTER_MODEL_NAME, resolveHarborMaster } from '../lib/harborMaster.js';
import { loadAppCatalog } from '../lib/catalog.js';
import { presetMemberIds, presetSpecialists, presetTotalGB } from '../lib/presets.js';
import type { Catalog } from 'os-code/protocol';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { SettingsGroup, SettingsRow } from '../components/SettingsRow.js';
import { StackMedia } from '../components/StackMedia.js';
import { STACK_CATEGORIES, STACK_LEAD, categoryLabel, type StackCategory } from '../lib/stack.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';
import { claudeModel, claudeModelLabel } from '../lib/claudeModels.js';
import { providerModelLabel } from '../lib/providers.js';
import { StatusSheet } from '../components/ProfileStatus.js';
import {
  desktopStackNote,
  offlineChosen,
  offlineNow,
  reasoningSlotSub,
} from '../state/offlineOps.js';

// The engine's specialist roles, named in the phone Stack's words.
const ROLES: StackCategory[] = ['coding', 'writing', 'analysis', 'vision', 'embedding', 'fast'];

/** The installed models for a picker, the current one first. */
function pickerModels(models: string[], current: string | undefined): string[] {
  return current && models.includes(current)
    ? [current, ...models.filter((m) => m !== current)]
    : models;
}

/** The models this computer's Ollama lists, split by where each answers: an
 *  Ollama cloud tag ("kimi-k3:cloud") is listed like a pulled model but runs
 *  on ollama.com, so it is a cloud model, never one on this computer (the
 *  engine's own judge, `isOllamaCloudTag`). */
function computerModels(models: readonly string[]): { here: string[]; cloud: string[] } {
  return {
    here: models.filter((m) => !isOllamaCloudTag(m)),
    cloud: models.filter((m) => isOllamaCloudTag(m)),
  };
}

/** A model the engine reports, by the name a person reads: a cloud model by
 *  its display name (Sonnet 5, not claude-sonnet-5), a local one by its tag,
 *  which is the name Ollama and the person use for it. */
function engineModelName(model: string, provider?: string): string {
  if (claudeModel(model)) return claudeModelLabel(model);
  return provider ? providerModelLabel(provider, model) : model;
}

/** The chip for where a seat the engine reports answers, in words that hold
 *  for a server on the LAN (UX and copy review, 2026-10-08, B): Cloud when it leaves
 *  this network (the engine's seatLeaves, a cloud tag included), On this
 *  computer when its server is this computer itself (hostIsLoopback), and On
 *  your network for any other server that stays. A seat with no kind (a
 *  specialist from an older engine) wears no chip. */
function SeatChip({ seat }: { seat: { kind?: 'local' | 'cloud'; onThisComputer?: true } }) {
  if (seat.kind === 'cloud') return <span className="kind-chip cloud">Cloud</span>;
  if (seat.kind !== 'local') return null;
  return (
    <span className="kind-chip local">
      {seat.onThisComputer ? 'On this computer' : 'On your network'}
    </span>
  );
}

export function StackScreen() {
  const { settings, connectivity, showToast, setView, ensureHarborMaster, harborMasterDownload } =
    useApp();
  // Desktop Offline (2026-10-07): the phone's quiet door under its
  // status note, here in this computer's words. It offers Offline while
  // online, and the way back once Offline is chosen; a connection that simply
  // dropped is already Offline, with the lone pill in the bar.
  const [statusOpen, setStatusOpen] = useState(false);
  const offline = offlineNow(connectivity, settings.profileOverride);
  const chosen = offlineChosen(connectivity, settings.profileOverride);
  const stepDown = !settings.daemon && (settings.profileOverride === 'offline' || !offline);
  const [status, setStatus] = useState<DesktopStatus | undefined>();
  const [remote, setRemote] = useState<DaemonStackInfo | undefined>();
  const [pickFor, setPickFor] = useState<string | undefined>(); // 'orchestrator' or a role
  // The engine's status has not landed yet (or the read failed). Until it does,
  // the cards read quietly instead of claiming "Not set up yet" or "Off".
  const [readFailed, setReadFailed] = useState(false);
  // Declared above the phone's early return, so the hooks keep their order.
  const titleRef = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(async () => {
    if (isDesktop() && bridge()) {
      try {
        setStatus(await bridge()!.status());
        setReadFailed(false);
      } catch {
        setReadFailed(true);
      }
    } else if (settings.daemon) {
      try {
        setRemote(await daemonStack(settings.daemon));
      } catch {
        setRemote(undefined);
      }
    }
  }, [settings.daemon]);

  // A paired computer that goes offline, or comes back, is read again, so
  // the phone's Stack says which of its models answer meanwhile.
  useEffect(() => {
    void refresh();
  }, [refresh, connectivity.homeOffline]);

  // Prefab stacks: the catalog's presets, which arrive on the live feed and are
  // rebuilt on a schedule, so they refresh and reassess themselves as models
  // change. One tap here fills the whole stack without a trip to the Marketplace.
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [prefabBusy, setPrefabBusy] = useState<string | undefined>();
  const [prefabLine, setPrefabLine] = useState<string | undefined>();
  useEffect(() => {
    void loadAppCatalog(settings.daemon).then(({ catalog: c }) => setCatalog(c));
  }, [settings.daemon]);

  const installPrefab = async (presetId: string) => {
    const b = bridge();
    if (!b || !catalog || prefabBusy) return;
    const preset = catalog.presets.find((p) => p.id === presetId);
    if (!preset) return;
    const byId = new Map(catalog.models.map((m) => [m.id, m]));
    const ids = presetMemberIds(preset);
    if (ids.some((id) => !byId.has(id))) {
      showToast('This stack names a model the catalog does not have yet.');
      return;
    }
    setPrefabBusy(presetId);
    const off = b.onInstallProgress((p) => {
      if (!ids.includes(p.modelId)) return;
      setPrefabLine(p.percent != null ? `${p.line} ${Math.round(p.percent)}%` : p.line);
    });
    try {
      for (const id of ids) {
        const r = await b.installModel(id);
        if (!r.ok) {
          showToast(r.detail);
          return;
        }
      }
      const orch = byId.get(preset.stack.orchestrator)!;
      const set = await b.setOrchestrator(orch.source.ref);
      if (!set.ok) {
        showToast(set.detail);
        return;
      }
      for (const [role, id] of presetSpecialists(preset)) {
        const m = byId.get(id);
        if (m) await b.enableSpecialist(role, m.source.ref);
      }
      showToast(`${preset.name} is your stack. Ready to chat and build.`);
      await refresh();
      await useApp.getState().refreshDesktopStatus();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not install the stack.');
    } finally {
      off();
      setPrefabBusy(undefined);
      setPrefabLine(undefined);
    }
  };

  // One tap from "no model" to a working stack: DeepBlue, sized to this
  // computer, pulled through the engine and seated as the orchestrator by the
  // store (ensureHarborMaster owns the progress and the failure line, so the
  // Settings row and the First Seat card show the same state). The gate's copy
  // of the engine status is refreshed by the store so a chat opens right away.
  const starterPulling = Boolean(harborMasterDownload && !harborMasterDownload.failed);
  const starterSize = resolveHarborMaster(
    status ? (status.hardware ?? hardwareFromSummary(status.hardwareSummary)) : undefined,
  ).size;
  const getStarter = async () => {
    if (starterPulling) return;
    const ok = await ensureHarborMaster();
    if (ok) {
      showToast(`${HARBOR_MASTER_MODEL_NAME} is your model. Ready to chat.`);
      setPickFor(undefined);
      await refresh();
    } else {
      const why = useApp.getState().harborMasterDownload;
      if (why?.failed) showToast(why.label);
    }
  };

  const choose = async (model: string) => {
    const b = bridge();
    if (!b || !pickFor) return;
    const result =
      pickFor === 'orchestrator'
        ? await b.setOrchestrator(model)
        : await b.enableSpecialist(pickFor, model);
    showToast(result.detail);
    setPickFor(undefined);
    await refresh();
    // The first-answer gate reads the store's copy of the engine status; keep
    // it current so a chat opens the moment a model is chosen.
    await useApp.getState().refreshDesktopStatus();
  };

  const stack = status?.stack;
  const specialists = stack?.specialists ?? remote?.specialists ?? [];
  const orchestrator = stack?.orchestrator ?? remote?.orchestrator;
  const admin = stackAdmin(settings.account);
  const currentModel =
    pickFor === 'orchestrator'
      ? orchestrator?.model
      : specialists.find((s) => s.role === pickFor)?.model;
  const canEdit = isDesktop() && admin;
  // The picker's two lists: models on this computer, and Ollama cloud tags.
  const listed = computerModels(status?.ollama.models ?? []);
  const reading = isDesktop() && Boolean(bridge()) && !status && !readFailed;
  const readingLine = 'Reading your computer...';

  // The phone manages its own app-side stack (Reasoning model + bench). The
  // desktop keeps its live daemon-driven view below.
  if (!isDesktop()) return <StackManager computer={remote} />;

  // Read failed with no status yet: the rows say so, and Runs the show offers
  // Try again.
  const unanswered = readFailed && !status;
  const prefabs =
    canEdit && catalog && catalog.presets.length ? (
      <SettingsGroup
        title="Start with a prefab stack"
        intro="One tap fills your whole stack. The list updates when the catalog does."
        index={orchestrator ? 2 : 0}
      >
        {catalog.presets.map((preset) => {
          const total = presetTotalGB(preset, catalog);
          const busy = prefabBusy === preset.id;
          return (
            <SettingsRow
              key={preset.id}
              label={preset.name}
              sub={
                busy
                  ? (prefabLine ?? 'Installing...')
                  : `${preset.tagline}${preset.minVramGB ? ` Best with ${preset.minVramGB} GB of graphics memory.` : ''}`
              }
              value={
                <span className="pill local">
                  {total !== undefined ? `${total} GB` : 'size unknown'}
                </span>
              }
              disabled={Boolean(prefabBusy)}
              onClick={() => void installPrefab(preset.id)}
            />
          );
        })}
      </SettingsGroup>
    ) : null;

  return (
    <div className="screen">
      <BackBar title="Stack" titleHiddenUntil={titleRef} />
      {/* The desktop Stack in the Settings ledger, the phone's shape
          (design review, 2026-10-02): who runs the show, the specialists,
          then the prefab stacks (first while nothing runs the show). */}
      <div className="screen-inner settings stack-manager">
        <h1 ref={titleRef}>Stack</h1>
        <p className="lead">{STACK_LEAD}</p>

        <div className="stack-status">
          <p className="stack-status-note" role="status">
            {desktopStackNote(offline, chosen, status ? Boolean(status.offlineSeat) : undefined)}
          </p>
          {stepDown ? (
            <button
              type="button"
              className="linklike press-fb stack-status-change"
              onClick={() => setStatusOpen(true)}
            >
              {settings.profileOverride === 'offline' ? 'Follow the connection' : 'Choose Offline'}
            </button>
          ) : null}
        </div>
        {!settings.daemon ? (
          <StatusSheet open={statusOpen} onClose={() => setStatusOpen(false)} />
        ) : null}

        {!orchestrator ? prefabs : null}

        <SettingsGroup title="Runs the show" index={1}>
          <SettingsRow
            label={
              orchestrator
                ? engineModelName(orchestrator.model, orchestrator.provider)
                : reading
                  ? readingLine
                  : unanswered
                    ? 'Your computer did not answer.'
                    : 'Not set up yet'
            }
            sub={
              orchestrator
                ? // Offline, the model that answers meanwhile is the engine's
                  // own seat, read across every provider by address.
                  reasoningSlotSub(
                    offline,
                    orchestrator.kind === 'cloud',
                    status?.offlineSeat?.model,
                  )
                : unanswered
                  ? undefined
                  : 'Pick a model to run the show.'
            }
            value={orchestrator ? <SeatChip seat={orchestrator} /> : undefined}
            trailing={
              unanswered ? (
                <button
                  type="button"
                  className="btn ghost sm press-fb"
                  onClick={() => void refresh()}
                >
                  Try again
                </button>
              ) : undefined
            }
            onClick={
              canEdit && !reading && !unanswered ? () => setPickFor('orchestrator') : undefined
            }
          />
        </SettingsGroup>

        <SettingsGroup title="Specialists" index={2}>
          {ROLES.map((role) => {
            const enabled = specialists.find((s) => s.role === role);
            return (
              <SettingsRow
                key={role}
                label={categoryLabel(role)}
                sub={STACK_CATEGORIES.find((c) => c.id === role)?.hint}
                value={
                  reading || unanswered ? undefined : enabled ? (
                    // The model, and beside it where it answers, so a cloud
                    // tag placed for coding never looks local once placed.
                    <span className="settings-row-actions">
                      {engineModelName(enabled.model)}
                      <SeatChip seat={enabled} />
                    </span>
                  ) : (
                    <span className="stack-off">Off</span>
                  )
                }
                onClick={canEdit && !reading && !unanswered ? () => setPickFor(role) : undefined}
              />
            );
          })}
        </SettingsGroup>

        {isDesktop() && status && !reading && !unanswered ? (
          <StackMedia
            status={status}
            canEdit={canEdit}
            index={3}
            onChanged={() => void refresh()}
            onOpenMarketplace={() => setView('marketplace')}
          />
        ) : null}

        {orchestrator ? prefabs : null}

        {!isDesktop() ? (
          <p className="hint">
            {settings.daemon ? (
              `The stack lives on your computer; edit it there. ${thisDeviceNoun({ start: true })} rides it over Tailscale.`
            ) : (
              <>
                <button className="linklike" onClick={() => setView('pair')}>
                  Connect your computer
                </button>{' '}
                to see and use its stack.
              </>
            )}
          </p>
        ) : !admin ? (
          <p className="hint">
            Your admin sets the shared stack for the company. You can talk with your admin about
            changing it.
          </p>
        ) : null}
      </div>

      <Sheet open={Boolean(pickFor && status)} onClose={() => setPickFor(undefined)}>
        {pickFor && status ? (
          <>
            {/* Each role names its model, Coding model to Fast model, so every
                category reads right here and on Turn off below. */}
            <SheetHead
              title={
                pickFor === 'orchestrator'
                  ? 'Who runs the show?'
                  : `${categoryLabel(pickFor as StackCategory)} model`
              }
              onClose={() => setPickFor(undefined)}
            />
            <p className="sheet-sub">
              Models installed on this computer. Ollama, a free app, runs them.
            </p>
            <div className="sheet-actions">
              {listed.here.length ? (
                pickerModels(listed.here, currentModel).map((m) => {
                  const current = m === currentModel;
                  return (
                    <button
                      key={m}
                      type="button"
                      className={`btn ghost profile-option press-fb${current ? ' selected' : ''}`}
                      aria-current={current ? 'true' : undefined}
                      onClick={() => void choose(m)}
                    >
                      <span className="profile-option-text">
                        <span className="profile-option-title">{m}</span>
                        {current ? <span className="profile-option-blurb">Current</span> : null}
                      </span>
                    </button>
                  );
                })
              ) : (
                <>
                  <p className="hint">
                    No local models yet.{' '}
                    {status.ollama.up
                      ? pickFor === 'orchestrator'
                        ? 'Get DeepBlue below, sized to your computer, or install one by name.'
                        : 'Install one by name below.'
                      : status.ollama.detail}{' '}
                    <button
                      className="linklike"
                      onClick={() =>
                        void useApp
                          .getState()
                          .startGuideChat(status.ollama.up ? 'pick-a-model' : 'install-ollama')
                      }
                    >
                      Walk me through it
                    </button>
                  </p>
                  {status.ollama.up && pickFor === 'orchestrator' ? (
                    <button
                      className="btn primary press-fb"
                      disabled={starterPulling}
                      onClick={() => void getStarter()}
                    >
                      {starterPulling
                        ? `${harborMasterDownload!.label} of ${HARBOR_MASTER_MODEL_NAME}`
                        : `Get ${HARBOR_MASTER_MODEL_NAME} (${starterSize.weightsName}, ${starterSize.sizeGB} GB)`}
                    </button>
                  ) : null}
                </>
              )}
            </div>
            {/* An Ollama cloud tag answers on ollama.com, not here: it is
                listed apart, with the cloud chip, and says where its words go,
                in the cloud card's own nouns (UX and copy review, 2026-10-08, C). */}
            {listed.cloud.length ? (
              <>
                <p className="sheet-sub">
                  Cloud models your Ollama lists. They run on Ollama&apos;s cloud, under your Ollama
                  account, so your messages and the files the agent reads go to ollama.com.
                </p>
                <div className="sheet-actions">
                  {pickerModels(listed.cloud, currentModel).map((m) => {
                    const current = m === currentModel;
                    return (
                      <button
                        key={m}
                        type="button"
                        className={`btn ghost profile-option press-fb${current ? ' selected' : ''}`}
                        aria-current={current ? 'true' : undefined}
                        onClick={() => void choose(m)}
                      >
                        <span className="profile-option-text">
                          <span className="profile-option-title">
                            {m}
                            <span className="kind-chip cloud">Cloud</span>
                          </span>
                          {current ? <span className="profile-option-blurb">Current</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
            {status.ollama.up ? <InstallByName /> : null}
            {/* Turning a specialist off lives here, not as a button in the
                ledger (design review, 2026-10-02). */}
            {pickFor !== 'orchestrator' && specialists.some((s) => s.role === pickFor) ? (
              <div className="sheet-actions">
                <button
                  type="button"
                  className="btn danger press-fb"
                  onClick={async () => {
                    const role = pickFor;
                    setPickFor(undefined);
                    const result = await bridge()!.disableSpecialist(role);
                    showToast(result.detail);
                    await refresh();
                  }}
                >
                  Turn off the {categoryLabel(pickFor as StackCategory).toLowerCase()} model
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
