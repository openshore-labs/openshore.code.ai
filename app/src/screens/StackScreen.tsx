// Stack: the one mandatory orchestrator and the optional specialists.
// Editable on the desktop; the phone shows the live picture from the daemon.
import { InstallByName } from '../components/InstallByName.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonStackInfo } from 'os-code/protocol';
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
import { STACK_CATEGORIES, STACK_LEAD, categoryLabel, type StackCategory } from '../lib/stack.js';

// The engine's specialist roles, named in the phone Stack's words.
const ROLES: StackCategory[] = ['coding', 'writing', 'analysis', 'vision', 'embedding', 'fast'];

/** The installed models for a picker, the current one first. */
function pickerModels(models: string[], current: string | undefined): string[] {
  return current && models.includes(current)
    ? [current, ...models.filter((m) => m !== current)]
    : models;
}

export function StackScreen() {
  const { settings, showToast, setView, ensureHarborMaster, harborMasterDownload } = useApp();
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
  const reading = isDesktop() && Boolean(bridge()) && !status && !readFailed;
  const readingLine = 'Reading your computer...';

  // The phone manages its own app-side stack (Reasoning LLM + bench). The
  // desktop keeps its live daemon-driven view below.
  if (!isDesktop()) return <StackManager />;

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
          (Creative Studio, 2026-10-02): who runs the show, the specialists,
          then the prefab stacks (first while nothing runs the show). */}
      <div className="screen-inner settings stack-manager">
        <h1 ref={titleRef}>Stack</h1>
        <p className="lead">{STACK_LEAD}</p>

        {!orchestrator ? prefabs : null}

        <SettingsGroup title="Runs the show" index={1}>
          <SettingsRow
            label={
              orchestrator
                ? orchestrator.model
                : reading
                  ? readingLine
                  : unanswered
                    ? 'Your computer did not answer.'
                    : 'Not set up yet'
            }
            sub={
              orchestrator
                ? 'Plans every task and routes it.'
                : unanswered
                  ? undefined
                  : 'Pick a model to run the show.'
            }
            value={
              orchestrator ? (
                <span className={`kind-chip ${orchestrator.kind}`}>
                  {orchestrator.kind === 'local' ? 'On this computer' : 'Cloud'}
                </span>
              ) : undefined
            }
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
                    enabled.model
                  ) : (
                    <span className="stack-off">Off</span>
                  )
                }
                onClick={canEdit && !reading && !unanswered ? () => setPickFor(role) : undefined}
              />
            );
          })}
        </SettingsGroup>

        {orchestrator ? prefabs : null}

        {!isDesktop() ? (
          <p className="hint">
            {settings.daemon ? (
              'The stack lives on your computer; edit it there. This phone rides it over Tailscale.'
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
              {status.ollama.models.length ? (
                pickerModels(status.ollama.models, currentModel).map((m) => {
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
            {status.ollama.up ? <InstallByName /> : null}
            {/* Turning a specialist off lives here, not as a button in the
                ledger (Creative Studio, 2026-10-02). */}
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
