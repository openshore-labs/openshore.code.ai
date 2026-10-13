// Runs on (2026-10-12): "in your projects, you can choose the Hub to
// run your project from, either your home computer, home server, or remote
// server." A pill under the project's title, beside its repositories and its
// instructions, and the sheet it opens: this computer (on the desktop), each
// docked machine with its kind, size and whether it answers, or follow this
// device. New chats only; a chat already started stays where it began
// (lib/runsOn.ts). Shown once a machine is docked, since before that there is
// nothing to choose.
import { useEffect, useState, type CSSProperties } from 'react';
import { hubList, useApp, whereContextOf } from '../state/store.js';
import type { Project } from '../state/types.js';
import { daemonHealth } from '../drivers/remoteDriver.js';
import { THIS_COMPUTER, deviceWhere, projectWhere, type Where } from '../lib/runsOn.js';
import {
  machineFactsLine,
  machineKindLabel,
  machineKindOf,
  type DockPlace,
  type MachineFacts,
} from '../lib/docking.js';
import { hostOf } from './DockForm.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';
import { CheckGlyph } from './SheetGlyphs.js';
import { Icon } from './Icon.js';

/** What a place is called in a pill or a row. */
export function whereName(where: Where): string {
  if (where.kind === 'local') return 'this computer';
  if (where.kind === 'docked') return where.target.name?.trim() || hostOf(where.target.baseUrl);
  return 'nowhere yet';
}

/** The pill's words: where new chats in this project run. */
export function runsOnLabel(where: Where): string {
  return `Runs on ${whereName(where)}`;
}

/** A machine's second line: its kind, and its size once it said. */
function kindLine(hub: {
  kind?: 'desktop' | 'server';
  place?: DockPlace;
  machine?: MachineFacts;
}): string {
  const kind = machineKindLabel(machineKindOf(hub));
  const size = machineFactsLine(hub.machine);
  return size ? `${kind}, ${size}` : kind;
}

export function RunsOnPill({
  project,
  disabled,
  onOpen,
}: {
  project: Project;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const settings = useApp((s) => s.settings);
  if (hubList(settings).length === 0) return null;
  const where = projectWhere(project, whereContextOf(settings));
  return (
    <button type="button" className="project-pill press-fb" disabled={disabled} onClick={onOpen}>
      <MachineGlyph />
      <span>{runsOnLabel(where)}</span>
    </button>
  );
}

export function RunsOnSheet({
  project,
  open,
  onClose,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  const { settings, setProjectRunsOn, noteMachineFacts, setView, showToast } = useApp();
  const hubs = hubList(settings);
  const ctx = whereContextOf(settings);
  // Whether each machine answers, asked while the sheet is open.
  const [reach, setReach] = useState<Record<string, 'yes' | 'no'>>({});
  const hubKey = hubs.map((h) => h.baseUrl).join(',');
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setReach({});
    for (const hub of hubs) {
      void daemonHealth(hub).then((h) => {
        if (!alive) return;
        setReach((r) => ({ ...r, [hub.baseUrl]: h.ok ? 'yes' : 'no' }));
        if (h.machine) void noteMachineFacts(hub.baseUrl, h.machine);
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hubKey]);

  const current = project.runsOn;
  const choose = (runsOn: string | undefined, name: string) => {
    void setProjectRunsOn(project.id, runsOn);
    onClose();
    if (runsOn !== current) showToast(`New chats in ${project.name} run on ${name}.`);
  };
  const deviceName = whereName(deviceWhere(ctx));
  const desktopLocal = ctx.desktopLocal;

  return (
    <Sheet open={open} onClose={onClose} className="info-sheet">
      <SheetHead title="Runs on" onClose={onClose} />
      <p className="sheet-sub">
        Where new chats in this project run: their sessions, their terminal and their repositories.
        A chat already started stays where it began.
      </p>
      <div className="sheet-actions">
        <button
          type="button"
          className={`profile-row stagger-in${current === undefined ? ' active' : ''}`}
          style={{ '--i': 0 } as CSSProperties}
          aria-current={current === undefined ? 'true' : undefined}
          onClick={() => choose(undefined, deviceName)}
        >
          <span className="grow">
            <span className="profile-row-title">Automatic</span>
            <span className="sub">
              Follows this device&apos;s default. Right now, {deviceName}.
            </span>
          </span>
          {current === undefined ? <RowCheck /> : null}
        </button>
        {desktopLocal ? (
          <button
            type="button"
            className={`profile-row stagger-in${current === THIS_COMPUTER ? ' active' : ''}`}
            style={{ '--i': 1 } as CSSProperties}
            aria-current={current === THIS_COMPUTER ? 'true' : undefined}
            onClick={() => choose(THIS_COMPUTER, 'this computer')}
          >
            <span className="grow">
              <span className="profile-row-title">This computer</span>
              <span className="sub">Its own engine, while OpenShore is open here.</span>
            </span>
            {current === THIS_COMPUTER ? <RowCheck /> : null}
          </button>
        ) : null}
        {hubs.map((hub, i) => {
          const chosen = current === hub.baseUrl;
          const name = hub.name?.trim() || hostOf(hub.baseUrl);
          const answer = reach[hub.baseUrl];
          return (
            <button
              key={hub.baseUrl}
              type="button"
              className={`profile-row stagger-in${chosen ? ' active' : ''}`}
              style={{ '--i': Math.min(i + 2, 8) } as CSSProperties}
              aria-current={chosen ? 'true' : undefined}
              onClick={() => choose(hub.baseUrl, name)}
            >
              <span className="grow">
                <span className="profile-row-title">{name}</span>
                <span className="sub">
                  {kindLine(hub)}
                  {answer === 'no' ? '. Not reachable right now.' : ''}
                </span>
              </span>
              {chosen ? <RowCheck /> : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="linklike press-fb"
        onClick={() => {
          onClose();
          setView('pair');
        }}
      >
        Dock another machine
      </button>
    </Sheet>
  );
}

function RowCheck() {
  return (
    <span className="profile-row-check" aria-hidden="true">
      <CheckGlyph size={18} />
    </span>
  );
}

/** A machine, drawn as a small server box, the mark on the Runs on pill. */
function MachineGlyph() {
  return (
    <Icon size={18}>
      <rect x="4" y="4.5" width="16" height="6" rx="1.6" />
      <rect x="4" y="13.5" width="16" height="6" rx="1.6" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01" />
    </Icon>
  );
}
