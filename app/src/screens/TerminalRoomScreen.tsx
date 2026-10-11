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
//
// With no coding session open, the room offers the plain home shell: a shell in
// the target computer's home folder, no repository needed. The model stays out
// of it (it only reads a session's own terminal).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { driverFor, isOrgAdmin, useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { hapticCommit } from '../lib/haptics.js';
import { BackBar } from '../components/BackBar.js';
import { Switch } from '../components/Switch.js';
import { DesktopTerminal } from '../components/DesktopTerminal.js';
import { canOpenHomeShell, homeShellHost } from '../lib/homeShell.js';
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
  // One ref per return, so the bar's title tucks under each one's own h1.
  const firstRunTitleRef = useRef<HTMLHeadingElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // The plain home shell, opened on a tap when no session is. A member device
  // is never offered it: the hub keeps a raw shell admin-only. The host is
  // built once per target and disposed when the target changes or the room
  // closes; the shell itself keeps running on the computer.
  const daemon = settings.daemon;
  const shellInput = {
    desktopLocal,
    daemon: desktopLocal ? undefined : daemon,
    member: !desktopLocal && serverRole === 'member',
  };
  const shellOffered = canOpenHomeShell(shellInput);
  const [homeShellOpen, setHomeShellOpen] = useState(false);
  const shellKey = `${desktopLocal ? 'local' : (daemon?.baseUrl ?? '')}|${shellInput.member}`;
  const homeHost = useMemo(
    () => (homeShellOpen && !hasTerminal ? homeShellHost(shellInput) : undefined),
    // shellKey carries the target; shellInput is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [homeShellOpen, hasTerminal, shellKey],
  );
  useEffect(() => () => homeHost?.dispose(), [homeHost]);

  // First run: name the one requirement (a hub reachable over Tailscale) and
  // point at the flow that actually installs it, rather than a second copy of
  // those steps. Connect your computer or Not now retires the intro on this
  // device. A device that already reaches a computer (this desktop, or a
  // paired phone) has done both steps, so it skips straight to the terminal.
  if (!seen && !targetId) {
    return (
      <div className="screen">
        <BackBar title="Terminal" titleHiddenUntil={firstRunTitleRef} />
        <div className="screen-inner">
          <h1 ref={firstRunTitleRef}>Terminal</h1>
          <p className="lead">
            A real terminal on your computer, here in OpenShore. Run builds and tests yourself, or
            let the model run them when you allow it.
          </p>
          {/* The same shape as Repositories' card: what it needs, one
              primary, then the guide link under it. Not now sits outside. */}
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Two steps, once</h3>
            <ol className="setup-steps">
              <li>
                Install OpenShore on the computer that holds your code. It works on macOS, Windows,
                or Linux.
              </li>
              <li>
                Put both this device and that computer on the same private Tailscale network, so
                this app can reach it with no ports opened to the world.
              </li>
            </ol>
            <button
              type="button"
              className="btn primary block press-fb"
              onClick={() => {
                // The view switches first, so the room never flashes its
                // second state on the way out.
                setView('pair');
                void saveSettings({ terminalRoomSeen: true });
              }}
            >
              Connect your computer
            </button>
            <button
              type="button"
              className="linklike door press-fb"
              onClick={() => void useApp.getState().startGuideChat('pair-computer')}
            >
              Walk me through it
            </button>
          </div>
          <button
            type="button"
            className="btn quiet block press-fb"
            onClick={() => void saveSettings({ terminalRoomSeen: true })}
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <BackBar title="Terminal" titleHiddenUntil={titleRef} />
      <div className="screen-inner">
        <h1 ref={titleRef}>Terminal</h1>
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
                    if (next) hapticCommit();
                    void setTerminalControl(next);
                  }}
                />
              ) : (
                <span className="pill">Admin only</span>
              )}
            </div>
            {!canControl ? (
              <p className="hint" style={{ margin: '8px 0 0' }}>
                Only an organization admin can turn this on for a shared computer.
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
        ) : homeHost ? (
          <div className="tc-section" style={{ '--i': 1 } as CSSProperties}>
            <div className="tc-running">
              <span className="tc-dot" aria-hidden="true" />
              Home folder on <span className="tc-host">{targetLabel}</span>
            </div>
            <div className="terminal-room-live">
              <DesktopTerminal key={shellKey} driver={homeHost} />
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              A plain shell, no repository needed. The model stays out of this one.{' '}
              <button className="linklike" onClick={() => setView('repos')}>
                Open a repository
              </button>{' '}
              to code with it.
            </p>
          </div>
        ) : targetId ? (
          <div className="card tc-section" style={{ '--i': 1 } as CSSProperties}>
            <h3 style={{ marginTop: 0 }}>No session open</h3>
            <p className="hint" style={{ marginBottom: 10 }}>
              {shellOffered
                ? `Open a plain shell in the home folder on ${targetLabel}, or open a repository to code with the model there.`
                : `The terminal follows your active coding session. Open a repository to start one on ${targetLabel}.`}
            </p>
            <div className="tc-actions">
              {shellOffered ? (
                <button className="btn primary press-fb" onClick={() => setHomeShellOpen(true)}>
                  Open a shell
                </button>
              ) : null}
              {/* The secondary beside Open a shell, and the primary when it is
                  the card's only way forward. */}
              <button
                className={`btn ${shellOffered ? 'ghost' : 'primary'} press-fb`}
                onClick={() => setView('repos')}
              >
                Open a repository
              </button>
            </div>
          </div>
        ) : (
          <div className="card tc-section" style={{ '--i': 0 } as CSSProperties}>
            <h3 style={{ marginTop: 0 }}>The terminal lives on your computer</h3>
            <p className="hint" style={{ marginBottom: 10 }}>
              This device is not connected to a computer yet. Connect it, and the terminal opens
              here.
            </p>
            <button type="button" className="btn primary press-fb" onClick={() => setView('pair')}>
              Connect your computer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
