// Crew command: the room where the crew's unattended work is organized and
// watched. One glance answers "who is working, who needs me, what is waiting
// for me", the way a bot roster with presence does, except every bot here is
// a crew member running on the person's own computer and models.
//
// The room is a sub-page of My Crew. Its parts, top to bottom: the live
// headline and counts; anything waiting on the person; the roster with each
// member's presence; the routines themselves (the clock, the access, the
// switch); and the results inbox, newest first, each opening a result sheet
// with the transcript one tap away. Copy stays honest: "while your computer
// is on", never "always on"; "works, then asks", never "unsupervised".
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from '../components/BackBar.js';
import { Sheet } from '../components/Sheet.js';
import { SwipeRow } from '../components/SwipeRow.js';
import { Markdown } from '../components/Markdown.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonWorkspaces } from '../drivers/remoteDriver.js';
import type { CrewAgent } from '../state/types.js';
import {
  PRESET,
  accessLabel,
  agentPresenceLine,
  busiestFirst,
  controlBlurb,
  controlLabel,
  crewControl,
  crewHeadline,
  customRoutinesUnlocked,
  presenceLabel,
  presenceTone,
  routinesForAgent,
  runStateLabel,
  runWhen,
  scheduleLabel,
  workspaceName,
  type PresenceTone,
  type RoutineInput,
  type RoutineRun,
  type RoutineView,
} from '../lib/routines.js';
import { ROUTINE_LIMITS } from 'os-code/protocol';

/** How often the room re-asks the computer while it is open. */
const REFRESH_MS = 5000;

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MINUTE_STEPS = [0, 15, 30, 45];
const MINUTE_CHOICES = [5, 10, 15, 20, 30, 45, 60];

interface Draft {
  id?: string;
  name: string;
  /** `id:<crewId>` for an existing member, `new:<name>` to add one on save. */
  agentKey: string;
  task: string;
  cwd: string;
  hour: number;
  minute: number;
  days: number[];
  access: 'read-only' | 'edit';
  maxMinutes: number;
  enabled: boolean;
}

function PresenceDot({ tone }: { tone: PresenceTone }) {
  return <span className={`cc-dot ${tone}`} aria-hidden="true" />;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function CrewCommandScreen() {
  const {
    settings,
    connectivity,
    routines: state,
    refreshRoutines,
    refreshConnectivity,
    createRoutine,
    updateRoutine,
    deleteRoutine,
    runRoutineNow,
    stopRoutine,
    readRoutineNote,
    openRoutineRun,
    createCrewAgent,
    startGuideChat,
    setView,
    showToast,
  } = useApp();
  const crewList = settings.crew;
  const crew = useMemo(() => crewList ?? [], [crewList]);
  const { routines, runs } = state;

  // The control distinction (founder, 2026-09-05): set up and control only
  // while docked to the machine (or on it); view always. Computed live from
  // connectivity so a reconnect flips the room from view-only to in-control
  // without a reload.
  const control = crewControl({
    onDesktop: isDesktop() && Boolean(bridge()),
    hasDaemon: Boolean(settings.daemon),
    homeReachable: connectivity.homeReachable,
    preferRemoteHub: settings.preferRemoteHub,
  });
  const canControl = control.can;
  const where = control.where;

  const [draft, setDraft] = useState<Draft | undefined>();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoutineView | undefined>();
  const [detail, setDetail] = useState<RoutineRun | undefined>();
  const [note, setNote] = useState<{ path: string; markdown: string } | null | undefined>();
  const [workspaces, setWorkspaces] = useState<Array<{ cwd: string; name: string }>>([]);

  // Live while open: the first answer lands at once, then a calm poll. Also
  // re-probe home reachability so an away room flips to in-control the moment
  // Tailscale reconnects, without waiting for the app-wide 20s tick.
  useEffect(() => {
    void refreshConnectivity();
    void refreshRoutines();
    const timer = window.setInterval(() => {
      void refreshConnectivity();
      void refreshRoutines();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshRoutines, refreshConnectivity]);

  // The workspaces a routine may run in, from the computer that runs them.
  const daemon = settings.daemon;
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        if (isDesktop() && bridge() && !settings.preferRemoteHub) {
          const rows = await bridge()!.recentWorkspaces();
          if (live) setWorkspaces(rows);
        } else if (daemon) {
          const rows = await daemonWorkspaces(daemon);
          if (live) setWorkspaces(rows);
        }
      } catch {
        if (live) setWorkspaces([]);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [daemon, settings.preferRemoteHub]);

  // When a result opens, fetch its note (the transcript stays a tap away).
  useEffect(() => {
    if (!detail) {
      setNote(undefined);
      return;
    }
    let live = true;
    setNote(undefined);
    void readRoutineNote(detail.id).then((n) => {
      if (live) setNote(n);
    });
    return () => {
      live = false;
    };
  }, [detail, readRoutineNote]);

  const now = Date.now();
  const headline = crewHeadline(routines, runs, now);
  const working = routines.filter((r) => r.presence === 'working');
  const waiting = routines.filter((r) => r.presence === 'waiting');
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const doneToday = runs.filter(
    (r) => r.state === 'done' && Date.parse(r.finishedAt ?? r.startedAt) >= startOfDay.getTime(),
  ).length;
  const nextRun = routines
    .map((r) => r.nextRunAt)
    .filter((x): x is string => Boolean(x))
    .sort()[0];
  const unlocked = customRoutinesUnlocked(runs);
  const hasPreset = routines.some((r) => r.name === PRESET.name);
  const machine = where === 'desktop' ? 'this computer' : (daemon?.name ?? 'your main machine');

  // The roster: every crew member, plus a member a routine names that is not
  // on the crew any more (a deleted card must not hide a live routine).
  const roster = useMemo(() => {
    const rows: Array<{ key: string; agent: { id: string; name: string }; level?: string }> =
      crew.map((a: CrewAgent) => ({
        key: a.id,
        agent: { id: a.id, name: a.name },
        level: a.activityLevel,
      }));
    for (const r of routines) {
      const known = rows.some((row) =>
        r.agentId ? row.agent.id === r.agentId : row.agent.name === r.agentName,
      );
      if (!known)
        rows.push({ key: `r:${r.id}`, agent: { id: r.agentId ?? '', name: r.agentName } });
    }
    return rows;
  }, [crew, routines]);

  const orderedRoutines = useMemo(() => busiestFirst(routines), [routines]);

  const recentRuns = useMemo(() => runs.slice(0, 20), [runs]);
  const routineById = (id: string) => routines.find((r) => r.id === id);

  // ---- the editor ------------------------------------------------------------

  const presetAgent = crew.find((a) => a.name === PRESET.agentName);
  const beginPreset = () => {
    setDraft({
      name: PRESET.name,
      agentKey: presetAgent ? `id:${presetAgent.id}` : `new:${PRESET.agentName}`,
      task: PRESET.task,
      cwd: workspaces[0]?.cwd ?? '',
      hour: PRESET.schedule.hour,
      minute: PRESET.schedule.minute,
      days: [...PRESET.schedule.days],
      access: PRESET.access,
      maxMinutes: PRESET.maxMinutes,
      enabled: true,
    });
  };

  const beginNew = () => {
    setDraft({
      name: '',
      agentKey: crew[0] ? `id:${crew[0].id}` : `new:${PRESET.agentName}`,
      task: '',
      cwd: workspaces[0]?.cwd ?? '',
      hour: 6,
      minute: 0,
      days: [1, 2, 3, 4, 5],
      access: 'read-only',
      maxMinutes: ROUTINE_LIMITS.defaultMinutes,
      enabled: true,
    });
  };

  const beginEdit = (r: RoutineView) => {
    const member = r.agentId ? crew.find((a) => a.id === r.agentId) : undefined;
    setDraft({
      id: r.id,
      name: r.name,
      agentKey: member ? `id:${member.id}` : `new:${r.agentName}`,
      task: r.task,
      cwd: r.cwd,
      hour: r.schedule.hour,
      minute: r.schedule.minute,
      days: [...r.schedule.days],
      access: r.access,
      maxMinutes: r.maxMinutes,
      enabled: r.enabled,
    });
  };

  const draftValid =
    Boolean(draft) &&
    Boolean(draft!.name.trim()) &&
    Boolean(draft!.task.trim()) &&
    Boolean(draft!.cwd);

  const save = async () => {
    if (!draft || !draftValid) return;
    setSaving(true);
    try {
      let agent: { id?: string; name: string; persona: string };
      if (draft.agentKey.startsWith('id:')) {
        const member = crew.find((a) => a.id === draft.agentKey.slice(3));
        if (!member) {
          showToast('That crew member is gone. Pick another.');
          return;
        }
        agent = { id: member.id, name: member.name, persona: member.persona };
      } else {
        // A member the preset introduces joins the crew for real, so the
        // roster and the routine agree on who did the work.
        const name = draft.agentKey.slice(4);
        const existing = crew.find((a) => a.name === name);
        if (existing) agent = { id: existing.id, name: existing.name, persona: existing.persona };
        else {
          const id = await createCrewAgent({
            name,
            persona: PRESET.persona,
            whenCalled: 'On its routine, and whenever you ask for a review.',
            activityLevel: 'request',
            projectIds: [],
          });
          agent = { id, name, persona: PRESET.persona };
        }
      }
      const input: RoutineInput = {
        name: draft.name.trim(),
        agentId: agent.id,
        agentName: agent.name,
        persona: agent.persona,
        task: draft.task.trim(),
        cwd: draft.cwd,
        schedule: { hour: draft.hour, minute: draft.minute, days: [...draft.days].sort() },
        access: draft.access,
        maxMinutes: draft.maxMinutes,
        enabled: draft.enabled,
      };
      if (draft.id) {
        await updateRoutine(draft.id, input);
        setDraft(undefined);
        showToast('Routine updated.');
      } else {
        const created = await createRoutine(input);
        if (created) {
          setDraft(undefined);
          showToast(
            `${created.name} is set. ${created.agentName} works ${scheduleLabel(created.schedule).toLowerCase()}.`,
          );
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const setupPreset = hasPreset ? undefined : beginPreset;

  // ---- render ------------------------------------------------------------------
  // Three states, one distinction: docked or on the machine is IN CONTROL;
  // paired but away is VIEW ONLY (cached dashboards, a reconnect prompt); never
  // paired is NOT SET UP (dormant capabilities plus the way in).
  const unpaired = where === 'unpaired';
  const away = where === 'away';

  return (
    <div className="screen crew-command">
      <BackBar title="Crew command" />
      <div className="screen-inner">
        <section className={`cc-hero ${where}`} aria-label="Crew status">
          <div className="cc-hero-top">
            <div className="cc-kicker">Crew command · {machine}</div>
            <span className={`cc-control-badge ${where}`}>
              <span className="cc-control-dot" aria-hidden="true" />
              {controlLabel(where)}
            </span>
          </div>
          <h1 className="cc-headline">{unpaired ? 'Put your crew to work.' : headline}</h1>
          {!unpaired ? (
            <div className="cc-stats" role="list">
              <div className={`cc-stat${working.length ? ' live' : ''}`} role="listitem">
                <span className="cc-stat-num">{working.length}</span>
                <span className="cc-stat-label">Working</span>
              </div>
              <div className={`cc-stat${waiting.length ? ' needs' : ''}`} role="listitem">
                <span className="cc-stat-num">{waiting.length}</span>
                <span className="cc-stat-label">Needs you</span>
              </div>
              <div className="cc-stat" role="listitem">
                <span className="cc-stat-num">{doneToday}</span>
                <span className="cc-stat-label">Done today</span>
              </div>
              <div className="cc-stat" role="listitem">
                <span className="cc-stat-num small">
                  {nextRun
                    ? presenceLabel(
                        { presence: 'idle', nextRunAt: nextRun } as RoutineView,
                        now,
                      ).replace(/^Next /, '')
                    : 'None'}
                </span>
                <span className="cc-stat-label">Next run</span>
              </div>
            </div>
          ) : null}
          <p className="cc-hero-note">
            {canControl
              ? 'Every routine runs on your own models, while your computer is on. It works, then asks: anything risky waits for you.'
              : controlBlurb(where, machine)}
          </p>
          {away ? (
            <button
              className="btn primary press-fb"
              onClick={() => {
                void refreshConnectivity();
                void refreshRoutines();
              }}
            >
              Reconnect over Tailscale
            </button>
          ) : null}
          {unpaired ? (
            <div className="cc-hero-actions">
              <button className="btn primary press-fb" onClick={() => setView('pair')}>
                Pair your machine
              </button>
              <button
                className="btn ghost press-fb"
                onClick={() => void startGuideChat('set-up-crew')}
              >
                Walk me through it
              </button>
            </div>
          ) : null}
        </section>

        {unpaired ? (
          <section className="cc-section" aria-label="What your crew can do">
            <h2>What your crew can do</h2>
            <p className="lead" style={{ marginBottom: 14 }}>
              These run on your own computer, on the models you hold. You set them up while
              connected to your machine. After that you can watch and steer them from here,
              anywhere, and take control whenever you are back in reach over Tailscale.
            </p>
            <div className="cc-dormant">
              <div className="cc-dormant-item">
                <span className="cc-dot muted" aria-hidden="true" />
                <div>
                  <div className="cc-dormant-title">Scheduled routines</div>
                  <div className="cc-dormant-sub">
                    A crew member works a task on a clock, like a review every weekday morning.
                  </div>
                </div>
              </div>
              <div className="cc-dormant-item">
                <span className="cc-dot muted" aria-hidden="true" />
                <div>
                  <div className="cc-dormant-title">Results waiting for you</div>
                  <div className="cc-dormant-sub">
                    Each run leaves a note in your vault, with the full transcript a tap away.
                  </div>
                </div>
              </div>
              <div className="cc-dormant-item">
                <span className="cc-dot muted" aria-hidden="true" />
                <div>
                  <div className="cc-dormant-title">Works, then asks</div>
                  <div className="cc-dormant-sub">
                    Nothing risky happens unwatched. Anything that needs you waits, and pings you.
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {away ? (
          <p className="hint cc-away-note">
            Showing the last picture from {machine}. Reconnect to load live and take control.
          </p>
        ) : null}
        {state.error && canControl ? <p className="hint cc-error">{state.error}</p> : null}

        {waiting.length ? (
          <section className="cc-section" aria-label="Waiting for you">
            <h2>Waiting for you</h2>
            {waiting.map((r) => (
              <button
                key={r.id}
                type="button"
                className="cc-row cc-row-needs press-fb press-fb--row"
                onClick={() => {
                  if (r.lastRun) void openRoutineRun(r.lastRun);
                }}
              >
                <PresenceDot tone="waiting" />
                <span className="cc-row-main">
                  <span className="cc-row-title">{r.name}</span>
                  <span className="cc-row-sub">
                    {r.agentName} is waiting on an approval. Open the transcript and answer.
                  </span>
                </span>
                <span className="cc-row-chevron" aria-hidden="true" />
              </button>
            ))}
          </section>
        ) : null}

        {!unpaired ? (
          <section className="cc-section" aria-label="Crew">
            <div className="cc-section-head">
              <h2>Crew</h2>
              <button className="cc-link press-fb" onClick={() => setView('crew')}>
                Manage
              </button>
            </div>
            {roster.length === 0 ? (
              <p className="hint">
                No crew yet. The first routine adds a Reviewer to your crew for you.
              </p>
            ) : (
              <div className="cc-roster">
                {roster.map((row) => {
                  const mine = routinesForAgent(routines, row.agent);
                  const top = busiestFirst(mine)[0];
                  const tone: PresenceTone = top ? presenceTone(top.presence) : 'muted';
                  return (
                    <div key={row.key} className={`cc-member ${tone}`}>
                      <span
                        className={`crew-monogram ${row.level ?? 'request'}`}
                        aria-hidden="true"
                      >
                        {(row.agent.name.trim()[0] ?? '?').toUpperCase()}
                      </span>
                      <div className="cc-member-body">
                        <div className="cc-member-name">{row.agent.name}</div>
                        <div className="cc-member-line">
                          <PresenceDot tone={tone} />
                          {agentPresenceLine(mine, now) ??
                            (mine.length ? 'Idle' : 'No routine yet')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        {!unpaired ? (
          <section className="cc-section" aria-label="Routines">
            <div className="cc-section-head">
              <h2>Routines</h2>
              {canControl ? (
                unlocked ? (
                  <button className="cc-link press-fb" onClick={beginNew}>
                    + New routine
                  </button>
                ) : (
                  <span className="pill muted" title="Unlocks after the first routine finishes">
                    More after the first run
                  </span>
                )
              ) : null}
            </div>

            {setupPreset && canControl ? (
              <div className="cc-preset">
                <div className="cc-preset-kicker">Start here</div>
                <h3>{PRESET.name}</h3>
                <p className="sub">
                  Weekday mornings at 06:00, a Reviewer reads what changed in a repository overnight
                  and leaves a checklist for you. Read-only, so it never needs an approval. Its
                  report is waiting when you wake up.
                </p>
                {workspaces.length ? (
                  <button className="btn primary press-fb" onClick={setupPreset}>
                    Set up {PRESET.name}
                  </button>
                ) : (
                  <>
                    <p className="hint">A routine needs a repository on {machine} first.</p>
                    <button className="btn ghost press-fb" onClick={() => setView('repos')}>
                      Open Repositories
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {orderedRoutines.map((r) => {
              const tone = presenceTone(r.presence);
              const busy = r.presence === 'working' || r.presence === 'waiting';
              const card = (
                <div className={`card cc-routine ${tone}${canControl ? '' : ' view-only'}`}>
                  <div className="cc-routine-head">
                    <div className="cc-routine-title">
                      <PresenceDot tone={tone} />
                      <h3>{r.name}</h3>
                    </div>
                    <span className={`pill cc-presence ${tone}`}>{presenceLabel(r, now)}</span>
                  </div>
                  <div className="cc-routine-meta">
                    {r.agentName} · {scheduleLabel(r.schedule)} · {accessLabel(r.access)} ·{' '}
                    {workspaceName(r.cwd)}
                  </div>
                  {r.lastRun?.summary ? (
                    <p className="cc-routine-last">{r.lastRun.summary}</p>
                  ) : null}
                  {canControl ? (
                    <div className="cc-routine-actions">
                      {busy ? (
                        <button
                          className="suggestion press-fb"
                          onClick={() => void stopRoutine(r.id)}
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          className="suggestion suggestion-preferred press-fb"
                          onClick={() => {
                            void runRoutineNow(r.id);
                          }}
                        >
                          Run now
                        </button>
                      )}
                      <button className="suggestion press-fb" onClick={() => beginEdit(r)}>
                        Edit
                      </button>
                      <label className="cc-switch-row">
                        <span className="cc-switch-label">{r.enabled ? 'On' : 'Paused'}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={r.enabled}
                          aria-label={r.enabled ? `Pause ${r.name}` : `Resume ${r.name}`}
                          className={`switch${r.enabled ? ' on' : ''}`}
                          onClick={() => {
                            void updateRoutine(r.id, { enabled: !r.enabled });
                          }}
                        >
                          <span className="switch-knob" />
                        </button>
                      </label>
                    </div>
                  ) : r.lastRun?.sessionId ? (
                    <button
                      className="suggestion press-fb"
                      style={{ marginTop: 10 }}
                      onClick={() => r.lastRun && void openRoutineRun(r.lastRun)}
                    >
                      View last result
                    </button>
                  ) : null}
                </div>
              );
              // Swipe-to-delete only where control is allowed; away, the card
              // is a read-only tile.
              return canControl ? (
                <SwipeRow
                  key={r.id}
                  variant="danger"
                  label="Delete"
                  className="cc-routine-swipe"
                  onTap={() => {}}
                  onToggle={() => setConfirmDelete(r)}
                >
                  {card}
                </SwipeRow>
              ) : (
                <div key={r.id} className="cc-routine-swipe">
                  {card}
                </div>
              );
            })}
          </section>
        ) : null}

        {!unpaired && recentRuns.length ? (
          <section className="cc-section" aria-label="Results">
            <h2>Results</h2>
            <div className="cc-inbox">
              {recentRuns.map((run, index) => {
                const r = routineById(run.routineId);
                const tone: PresenceTone =
                  run.state === 'running'
                    ? 'working'
                    : run.state === 'waiting'
                      ? 'waiting'
                      : run.state === 'done'
                        ? 'ok'
                        : run.state === 'failed'
                          ? 'failed'
                          : 'muted';
                return (
                  <button
                    key={run.id}
                    type="button"
                    className="cc-row cc-row-arrive press-fb press-fb--row"
                    style={{ '--i': index } as CSSProperties}
                    onClick={() => setDetail(run)}
                  >
                    <PresenceDot tone={tone} />
                    <span className="cc-row-main">
                      <span className="cc-row-title">
                        {r?.name ?? 'Routine'}
                        <span className="cc-row-when"> · {runWhen(run, now)}</span>
                      </span>
                      <span className="cc-row-sub">
                        {runStateLabel(run.state)}
                        {run.summary ? ` · ${run.summary}` : ''}
                      </span>
                    </span>
                    <span className="cc-row-chevron" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      {/* The editor: name, crew member, task, workspace, clock, access, cap. */}
      <Sheet open={Boolean(draft)} onClose={() => setDraft(undefined)}>
        {draft ? (
          <>
            <h2 className="cc-sheet-title" key={draft.id ?? 'new'}>
              {draft.id ? 'Edit routine' : draft.name === PRESET.name ? PRESET.name : 'New routine'}
            </h2>
            <p className="sheet-sub">
              Runs on {machine} while it is on, on your own models. It works, then asks.
            </p>

            <div className="field">
              <label>Name</label>
              <input
                placeholder="e.g. Morning review, Nightly test run"
                value={draft.name}
                maxLength={ROUTINE_LIMITS.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Crew member</label>
              <select
                className="select"
                value={draft.agentKey}
                onChange={(e) => setDraft({ ...draft, agentKey: e.target.value })}
              >
                {crew.map((a) => (
                  <option key={a.id} value={`id:${a.id}`}>
                    {a.name}
                  </option>
                ))}
                {!crew.some((a) => a.name === PRESET.agentName) ? (
                  <option value={`new:${PRESET.agentName}`}>
                    {PRESET.agentName} (joins your crew)
                  </option>
                ) : null}
                {draft.agentKey.startsWith('new:') &&
                draft.agentKey !== `new:${PRESET.agentName}` ? (
                  <option value={draft.agentKey}>{draft.agentKey.slice(4)}</option>
                ) : null}
              </select>
            </div>

            <div className="field">
              <label>Task</label>
              <textarea
                rows={4}
                placeholder="What should they do each time, in your words."
                value={draft.task}
                maxLength={ROUTINE_LIMITS.task}
                onChange={(e) => setDraft({ ...draft, task: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Workspace</label>
              {workspaces.length || draft.cwd ? (
                <select
                  className="select"
                  value={draft.cwd}
                  onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
                >
                  {!workspaces.some((w) => w.cwd === draft.cwd) && draft.cwd ? (
                    <option value={draft.cwd}>{workspaceName(draft.cwd)}</option>
                  ) : null}
                  {workspaces.map((w) => (
                    <option key={w.cwd} value={w.cwd}>
                      {w.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="hint">Clone a repository on {machine} first (Repositories).</p>
              )}
              <p className="hint" style={{ marginTop: 6 }}>
                A routine runs only in a repository on {machine}, never an arbitrary folder.
              </p>
            </div>

            <div className="field">
              <label>Days</label>
              <div className="cc-days" role="group" aria-label="Days of the week">
                {DAY_ORDER.map((d) => {
                  const on = draft.days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`cc-day press-fb${on ? ' on' : ''}`}
                      aria-pressed={on}
                      aria-label={DAY_LONG[d]}
                      onClick={() => {
                        setDraft({
                          ...draft,
                          days: on ? draft.days.filter((x) => x !== d) : [...draft.days, d],
                        });
                      }}
                    >
                      {DAY_SHORT[d]}
                    </button>
                  );
                })}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                {draft.days.length === 0
                  ? 'Every day.'
                  : scheduleLabel({
                      hour: draft.hour,
                      minute: draft.minute,
                      days: [...draft.days].sort(),
                    })}
              </p>
            </div>

            <div className="cc-field-row">
              <div className="field">
                <label>Time</label>
                <div className="cc-time">
                  <select
                    className="select"
                    aria-label="Hour"
                    value={draft.hour}
                    onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {pad(h)}
                      </option>
                    ))}
                  </select>
                  <span className="cc-time-colon" aria-hidden="true">
                    :
                  </span>
                  <select
                    className="select"
                    aria-label="Minute"
                    value={draft.minute}
                    onChange={(e) => setDraft({ ...draft, minute: Number(e.target.value) })}
                  >
                    {(MINUTE_STEPS.includes(draft.minute)
                      ? MINUTE_STEPS
                      : [...MINUTE_STEPS, draft.minute].sort((a, b) => a - b)
                    ).map((m) => (
                      <option key={m} value={m}>
                        {pad(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Time cap</label>
                <select
                  className="select"
                  value={draft.maxMinutes}
                  onChange={(e) => setDraft({ ...draft, maxMinutes: Number(e.target.value) })}
                >
                  {MINUTE_CHOICES.map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Access</label>
              <div className="cc-segment" role="radiogroup" aria-label="Access">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.access === 'read-only'}
                  className={`cc-segment-btn press-fb${draft.access === 'read-only' ? ' on' : ''}`}
                  onClick={() => setDraft({ ...draft, access: 'read-only' })}
                >
                  Read-only
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.access === 'edit'}
                  className={`cc-segment-btn press-fb${draft.access === 'edit' ? ' on' : ''}`}
                  onClick={() => setDraft({ ...draft, access: 'edit' })}
                >
                  May edit files
                </button>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                {draft.access === 'read-only'
                  ? 'Reads, searches, and reports. It can never change a file, so it never needs an approval.'
                  : 'Edits inside the workspace flow. A shell command waits for your approval; if nobody answers within 15 minutes it is declined.'}
              </p>
            </div>

            <div className="sheet-actions">
              <button
                className="btn primary"
                disabled={!draftValid || saving}
                onClick={() => void save()}
              >
                {saving ? 'Saving' : draft.id ? 'Save' : 'Set up routine'}
              </button>
              <button className="btn quiet" onClick={() => setDraft(undefined)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      {/* A result: the note the run left, and the transcript behind it. */}
      <Sheet open={Boolean(detail)} onClose={() => setDetail(undefined)}>
        {detail ? (
          <>
            <h2 className="cc-sheet-title" key={detail.id}>
              {routineById(detail.routineId)?.name ?? 'Routine'}
            </h2>
            <p className="sheet-sub">
              {runStateLabel(detail.state)} · {runWhen(detail, now)}
              {detail.steps ? ` · ${detail.steps} ${detail.steps === 1 ? 'step' : 'steps'}` : ''}
            </p>
            <div className="cc-note">
              {note === undefined ? (
                <p className="hint">Loading the report.</p>
              ) : note ? (
                <Markdown text={note.markdown} />
              ) : (
                <p className="sub">{detail.summary ?? 'No report was written for this run.'}</p>
              )}
            </div>
            <div className="sheet-actions">
              {detail.sessionId ? (
                <button
                  className="btn primary"
                  onClick={() => {
                    const run = detail;
                    setDetail(undefined);
                    void openRoutineRun(run);
                  }}
                >
                  Open transcript
                </button>
              ) : null}
              <button className="btn quiet" onClick={() => setDetail(undefined)}>
                Close
              </button>
            </div>
            {note?.path ? (
              <p className="hint cc-note-path">Saved in your vault: {note.path}</p>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(undefined)}
        variant="confirm"
      >
        {confirmDelete ? (
          <>
            <h2>Delete {confirmDelete.name}?</h2>
            <p className="sheet-sub">
              Its results stay in your vault. A run in flight is stopped. This cannot be undone.
            </p>
            <div className="sheet-actions">
              <button
                className="btn primary"
                onClick={async () => {
                  const r = confirmDelete;
                  setConfirmDelete(undefined);
                  await deleteRoutine(r.id);
                  showToast('Routine deleted.');
                }}
              >
                Delete
              </button>
              <button className="btn quiet" onClick={() => setConfirmDelete(undefined)}>
                Keep
              </button>
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
