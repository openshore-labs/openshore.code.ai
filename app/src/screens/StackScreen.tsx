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

const ROLES: Array<{ role: string; plain: string }> = [
  { role: 'coding', plain: 'great at code' },
  { role: 'writing', plain: 'writes beautifully' },
  { role: 'analysis', plain: 'good with numbers' },
  { role: 'vision', plain: 'can read screenshots' },
  { role: 'embedding', plain: 'finds the right files' },
  { role: 'fast', plain: 'fast for small edits' },
];

export function StackScreen() {
  const { settings, showToast } = useApp();
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
            {settings.daemon
              ? 'The stack lives on your desktop; edit it there. This phone rides it over Tailscale.'
              : 'Connect your desktop (Menu, then Desktop + phone) to see and use its stack.'}
          </p>
        ) : !admin ? (
          <p className="hint">
            Your admin sets the shared stack for the company. You can talk with your admin about
            changing it.
          </p>
        ) : null}
      </div>

      {pickFor && status ? (
        <div className="sheet-scrim" onClick={() => setPickFor(undefined)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{pickFor === 'orchestrator' ? 'Who runs the show?' : `Model for ${pickFor}`}</h2>
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
                    {status.ollama.up ? 'Get the starter below, or browse the marketplace.' : status.ollama.detail}{' '}
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
