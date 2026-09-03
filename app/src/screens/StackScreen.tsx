// Your stack: the one mandatory orchestrator and the optional specialists.
// Editable on the desktop; the phone shows the live picture from the daemon.
import { useCallback, useEffect, useState } from 'react';
import type { DaemonStackInfo } from 'os-code/protocol';
import { stackAdmin, useApp } from '../state/store.js';
import { bridge, type DesktopStatus } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonStack } from '../drivers/remoteDriver.js';
import { BackBar } from '../components/BackBar.js';
import { StackManager } from '../components/StackManager.js';
import { STARTER_MODEL } from '../lib/starterModel.js';
import { loadAppCatalog } from '../lib/catalog.js';
import { presetMemberIds, presetSpecialists, presetTotalGB } from '../lib/presets.js';
import type { Catalog } from 'os-code/protocol';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';

const ROLES: Array<{ role: string; plain: string }> = [
  { role: 'coding', plain: 'great at code' },
  { role: 'writing', plain: 'writes beautifully' },
  { role: 'analysis', plain: 'good with numbers' },
  { role: 'vision', plain: 'can read screenshots' },
  { role: 'embedding', plain: 'finds the right files' },
  { role: 'fast', plain: 'fast for small edits' },
];

export function StackScreen() {
  const { settings, showToast, setView } = useApp();
  const [status, setStatus] = useState<DesktopStatus | undefined>();
  const [remote, setRemote] = useState<DaemonStackInfo | undefined>();
  const [pickFor, setPickFor] = useState<string | undefined>(); // 'orchestrator' or a role

  const refresh = useCallback(async () => {
    if (isDesktop() && bridge()) {
      setStatus(await bridge()!.status());
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

  // One tap from "no model" to a working stack: pull the curated starter
  // through the engine (progress lines come back over the install channel),
  // then make it the orchestrator. The gate's copy of the engine status is
  // refreshed at the end so a chat opens right away.
  const [starter, setStarter] = useState<{ line: string } | undefined>();
  const getStarter = async () => {
    const b = bridge();
    if (!b || starter) return;
    setStarter({ line: `Getting ${STARTER_MODEL.name} (${STARTER_MODEL.sizeGB} GB)...` });
    const off = b.onInstallProgress((p) => {
      if (p.modelId !== STARTER_MODEL.catalogId) return;
      setStarter({
        line: p.percent != null ? `${p.line} ${Math.round(p.percent)}%` : p.line,
      });
    });
    try {
      const pulled = await b.installModel(STARTER_MODEL.catalogId);
      if (!pulled.ok) {
        showToast(pulled.detail);
        return;
      }
      const set = await b.setOrchestrator(STARTER_MODEL.ollamaRef);
      showToast(set.ok ? `${STARTER_MODEL.name} is your model. Ready to chat.` : set.detail);
      setPickFor(undefined);
      await refresh();
      await useApp.getState().refreshDesktopStatus();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not get the starter model.');
    } finally {
      off();
      setStarter(undefined);
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
  const canEdit = isDesktop() && admin;

  // The phone manages its own app-side stack (Reasoning LLM + bench). The
  // desktop keeps its live daemon-driven view below.
  if (!isDesktop()) return <StackManager />;

  return (
    <div className="screen">
      <BackBar title="Your stack" />
      <div className="screen-inner">
        <h1>Your stack</h1>
        <p className="lead">
          One model is the quarterback: it plans, reasons, and decides which model gets each play.
          Specialists are optional; anything missing, the quarterback covers itself.
        </p>

        {canEdit && catalog && catalog.presets.length ? (
          <div className="card" style={{ marginBottom: 12 }}>
            <h3>Start with a prefab stack</h3>
            <p className="hint" style={{ marginTop: 4 }}>
              One tap fills your whole stack. These refresh on their own as new models land, so they
              stay current without you touching the Marketplace.
            </p>
            {catalog.presets.map((preset) => {
              const total = presetTotalGB(preset, catalog);
              const busy = prefabBusy === preset.id;
              return (
                <div key={preset.id} style={{ marginTop: 10 }}>
                  <div className="card-row">
                    <div className="grow">
                      <strong>{preset.name}</strong>
                      <div className="sub">{preset.tagline}</div>
                    </div>
                    <span className="pill local">
                      {total !== undefined ? `${total} GB` : 'size unknown'}
                    </span>
                  </div>
                  <button
                    className="btn ghost press-fb"
                    style={{ width: '100%', marginTop: 6 }}
                    disabled={Boolean(prefabBusy)}
                    onClick={() => void installPrefab(preset.id)}
                  >
                    {busy
                      ? (prefabLine ?? 'Installing...')
                      : `Download ${preset.name}${preset.minVramGB ? ` · needs ${preset.minVramGB} GB VRAM` : ''}`}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="card">
          <div className="card-row">
            <div className="grow">
              <h3>Quarterback</h3>
              <div className="sub">
                {orchestrator
                  ? `${orchestrator.model} on ${orchestrator.provider}`
                  : 'Not set up yet. Pick a model to run the show.'}
              </div>
            </div>
            {orchestrator ? (
              <span className={`pill ${orchestrator.kind}`}>{orchestrator.kind}</span>
            ) : null}
            {canEdit ? (
              <button
                className="btn ghost"
                style={{ padding: '8px 14px' }}
                onClick={() => setPickFor('orchestrator')}
              >
                Change
              </button>
            ) : null}
          </div>
        </div>

        {ROLES.map(({ role, plain }) => {
          const enabled = specialists.find((s) => s.role === role);
          return (
            <div className="card" key={role}>
              <div className="card-row">
                <div className="grow">
                  <h3>
                    {role} <span className="sub">({plain})</span>
                  </h3>
                  <div className="sub">
                    {enabled ? enabled.model : 'Off. The orchestrator handles this itself.'}
                  </div>
                </div>
                {canEdit ? (
                  enabled ? (
                    <button
                      className="btn ghost"
                      style={{ padding: '8px 14px' }}
                      onClick={async () => {
                        const result = await bridge()!.disableSpecialist(role);
                        showToast(result.detail);
                        await refresh();
                      }}
                    >
                      Turn off
                    </button>
                  ) : (
                    <button
                      className="btn ghost"
                      style={{ padding: '8px 14px' }}
                      onClick={() => setPickFor(role)}
                    >
                      Enable
                    </button>
                  )
                ) : null}
              </div>
            </div>
          );
        })}

        {!isDesktop() ? (
          <p className="hint">
            {settings.daemon ? (
              'The stack lives on your desktop; edit it there. This phone rides it over Tailscale.'
            ) : (
              <>
                <button className="linklike" onClick={() => setView('pair')}>
                  Connect your desktop
                </button>{' '}
                (Menu, then Desktop + phone) to see and use its stack.
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
            <SheetHead
              title={pickFor === 'orchestrator' ? 'Who runs the show?' : `Model for ${pickFor}`}
              onClose={() => setPickFor(undefined)}
            />
            <p className="sheet-sub">
              Installed on this machine via Ollama. Get more in the marketplace.
            </p>
            <div className="sheet-actions">
              {status.ollama.models.length ? (
                status.ollama.models.map((m) => (
                  <button key={m} className="btn ghost" onClick={() => void choose(m)}>
                    {m}
                  </button>
                ))
              ) : (
                <>
                  <p className="hint">
                    No local models yet.{' '}
                    {status.ollama.up
                      ? 'Get the starter below, or browse the marketplace.'
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
                      disabled={Boolean(starter)}
                      onClick={() => void getStarter()}
                    >
                      {starter
                        ? starter.line
                        : `Get the starter model (${STARTER_MODEL.name}, ${STARTER_MODEL.sizeGB} GB)`}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
