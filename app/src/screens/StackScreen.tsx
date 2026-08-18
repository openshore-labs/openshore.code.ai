// Your stack: the one mandatory orchestrator and the optional specialists.
// Editable on the desktop; the phone shows the live picture from the daemon.
import { useCallback, useEffect, useState } from 'react';
import type { DaemonStackInfo } from 'os-code/protocol';
import { useApp } from '../state/store.js';
import { bridge, type DesktopStatus } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonStack } from '../drivers/remoteDriver.js';
import { BackBar } from '../components/BackBar.js';

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
  };

  const stack = status?.stack;
  const specialists = stack?.specialists ?? remote?.specialists ?? [];
  const orchestrator = stack?.orchestrator ?? remote?.orchestrator;

  return (
    <div className="screen">
      <BackBar title="Your stack" />
      <div className="screen-inner">
        <h1>Your stack</h1>
        <p className="lead">
          One model is the quarterback: it plans, reasons, and decides which model gets each
          play. Specialists are optional; anything missing, the quarterback covers itself.
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
            {isDesktop() ? (
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
                {isDesktop() ? (
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
        ) : null}
      </div>

      {pickFor && status ? (
        <div className="sheet-scrim" onClick={() => setPickFor(undefined)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>{pickFor === 'orchestrator' ? 'Who runs the show?' : `Model for ${pickFor}`}</h2>
            <p className="sheet-sub">Installed on this machine via Ollama. Get more in the marketplace.</p>
            <div className="sheet-actions">
              {status.ollama.models.length ? (
                status.ollama.models.map((m) => (
                  <button key={m} className="btn ghost" onClick={() => void choose(m)}>
                    {m}
                  </button>
                ))
              ) : (
                <p className="hint">
                  No local models yet. {status.ollama.up ? 'Grab one from the marketplace.' : status.ollama.detail}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
