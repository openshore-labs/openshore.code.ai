// The Terminal room: a real terminal on your hub, wrapped into OpenShore, plus
// the Terminal Control switch. On, the active model runs commands and reads the
// output here on its own, so you are not copying results back into the chat by
// hand. Off, the default, every command waits for your tap.
//
// It follows the session: the terminal runs wherever the active coding session
// runs (this computer when the app is the engine, your hub when a chat is
// attached over the tailnet), so on a one machine setup there is never a choice
// to make. Reaching a second desktop's own hub is a separate, approved
// follow-up; for now this room shows the local engine and any attached hub.
import type { CSSProperties } from 'react';
import { driverFor, isOrgAdmin, useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { hapticApproval } from '../lib/haptics.js';
import { BackBar } from '../components/BackBar.js';
import { Switch } from '../components/Switch.js';
import { DesktopTerminal } from '../components/DesktopTerminal.js';
import {
  canControlTerminal,
  terminalControlOn,
  terminalTargetId,
  terminalTargetLabel,
} from '../lib/terminalControl.js';

export function TerminalRoomScreen() {
  const settings = useApp((s) => s.settings);
  const serverRole = useApp((s) => s.serverRole);
  const activeId = useApp((s) => s.activeId);
  const setView = useApp((s) => s.setView);
  const saveSettings = useApp((s) => s.saveSettings);
  const setTerminalControl = useApp((s) => s.setTerminalControl);

  const driver = activeId ? driverFor(activeId) : undefined;
  const hasTerminal = typeof driver?.openTerminal === 'function';
  const desktopLocal = isDesktop() && Boolean(bridge()) && !settings.preferRemoteHub;
  const targetId = terminalTargetId({ desktopLocal, daemon: settings.daemon });
  const targetLabel = terminalTargetLabel({ desktopLocal, daemon: settings.daemon });
  const canControl = canControlTerminal(
    settings.account,
    isOrgAdmin(settings.account) || serverRole === 'admin',
  );
  const controlOn = terminalControlOn(settings.terminalControl, targetId);
  const seen = settings.terminalRoomSeen === true;

  // First run: name the one requirement (a hub reachable over Tailscale) and
  // point at the flow that actually installs it, rather than a second copy of
  // those steps. "Got it" retires the intro on this device.
  if (!seen) {
    return (
      <div className="screen">
        <BackBar title="Terminal" />
        <div className="screen-inner">
          <h1>Terminal</h1>
          <p className="lead">
            A real terminal on your central computer, wrapped into OpenShore. The active model can
            run commands and read the output right here, so builds and tests do not go through copy
            and paste.
          </p>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Two things, once</h3>
            <ol className="terminal-firstrun">
              <li>
                Install the OpenShore desktop engine on the computer you want as your hub, the
                machine that holds your code. It works on macOS, Windows, or Linux.
              </li>
              <li>
                Put both this device and that computer on the same private Tailscale network, so
                this app can reach the hub with no ports opened to the world.
              </li>
            </ol>
            <p className="hint" style={{ marginBottom: 0 }}>
              Desktop and phone has the download links and the pairing steps.{' '}
              <button className="linklike" onClick={() => setView('pair')}>
                Open Desktop and phone
              </button>
              {' or '}
              <button
                className="linklike"
                onClick={() => void useApp.getState().startGuideChat('install-tailscale')}
              >
                walk me through Tailscale
              </button>
              .
            </p>
          </div>
          <button
            className="btn primary press-fb"
            style={{ marginTop: 14 }}
            onClick={() => void saveSettings({ terminalRoomSeen: true })}
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <BackBar title="Terminal" />
      <div className="screen-inner">
        <h1>Terminal</h1>
        <p className="lead">
          The terminal runs wherever your active coding session runs. With Terminal Control off, the
          model stays out of it and you drive the terminal yourself. Turn it on to let the model run
          commands here.
        </p>

        {targetId ? (
          <div className="card tc-card tc-section" style={{ '--i': 0 } as CSSProperties}>
            <div className="card-row">
              <div className="grow">
                <h3 style={{ margin: 0 }}>Terminal Control</h3>
                <div className="sub">
                  {controlOn
                    ? `On. The model runs commands on ${targetLabel} on its own.`
                    : `Off. The model cannot use the terminal on ${targetLabel}. You run commands here yourself.`}
                </div>
              </div>
              {canControl ? (
                <Switch
                  checked={controlOn}
                  label="Terminal Control"
                  onChange={(next) => {
                    // Turning it on is a decisive commit (autonomous shell), so
                    // mark it with the firmer tap over the Switch's own tick.
                    if (next) hapticApproval();
                    void setTerminalControl(next);
                  }}
                />
              ) : (
                <span className="pill">admin only</span>
              )}
            </div>
            {!canControl ? (
              <p className="hint" style={{ margin: '8px 0 0' }}>
                Only an organization admin can turn this on for a shared hub.
              </p>
            ) : null}
          </div>
        ) : null}

        {hasTerminal && driver ? (
          <div className="tc-section" style={{ '--i': 1 } as CSSProperties}>
            <div className="tc-running">
              <span className="tc-dot" aria-hidden="true" />
              Running on <span className="tc-host">{targetLabel}</span>
            </div>
            <div className="terminal-room-live">
              <DesktopTerminal key={activeId} driver={driver} />
            </div>
          </div>
        ) : targetId ? (
          <div className="card tc-section" style={{ '--i': 1 } as CSSProperties}>
            <h3 style={{ marginTop: 0 }}>No session open</h3>
            <p className="hint" style={{ marginBottom: 10 }}>
              The terminal follows your active coding session. Open a repository to start one on{' '}
              {targetLabel}.
            </p>
            <button className="btn press-fb" onClick={() => setView('repos')}>
              Open a repository
            </button>
          </div>
        ) : (
          <div className="card tc-section" style={{ '--i': 0 } as CSSProperties}>
            <h3 style={{ marginTop: 0 }}>Connect your hub</h3>
            <p className="hint" style={{ marginBottom: 10 }}>
              This device is not paired with a computer yet. Set it up under Desktop and phone, then
              the terminal lives here.
            </p>
            <button className="btn press-fb" onClick={() => setView('pair')}>
              Set up Desktop and phone
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
