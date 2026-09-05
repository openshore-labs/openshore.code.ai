// My Crew: your own roster of agents. Give each one a name, a persona, and a
// rule for how and when it is called. An Activity Level decides that: it can
// review every build before it ships, let the Reasoning LLM bring it in on its
// own, or stay dormant until you ask for it by name. Scope each to specific
// projects, or let it work across all of them.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from '../components/BackBar.js';
import { ProjectMultiSelect } from '../components/ProjectMultiSelect.js';
import type { CrewActivityLevel, CrewAgent } from '../state/types.js';
import { ADVISOR_TEAM } from '../lib/crewPresets.js';
import { Sheet } from '../components/Sheet.js';
import {
  agentPresenceLine,
  busiestFirst,
  crewControl,
  crewHeadline,
  presenceTone,
  routinesForAgent,
} from '../lib/routines.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';

const LEVELS: Array<{ id: CrewActivityLevel; label: string; hint: string }> = [
  {
    id: 'review',
    label: 'Reviews builds',
    hint: 'Runs automatically every time a feature is about to deploy, like a standing reviewer.',
  },
  {
    id: 'auto',
    label: 'Auto-reasoning',
    hint: 'The Reasoning LLM can bring this member in on its own when a decision needs its view. Slower, more hands-off.',
  },
  {
    id: 'request',
    label: 'Request only',
    hint: 'Stays dormant until you ask for it by name in a chat.',
  },
];

type Draft = Omit<CrewAgent, 'id' | 'createdAt'> & { id?: string };

function emptyDraft(): Draft {
  return { name: '', persona: '', whenCalled: '', activityLevel: 'request', projectIds: [] };
}

function levelLabel(level: CrewActivityLevel): string {
  return LEVELS.find((l) => l.id === level)?.label ?? level;
}

export function CrewScreen() {
  const {
    settings,
    connectivity,
    createCrewAgent,
    updateCrewAgent,
    deleteCrewAgent,
    showToast,
    routines: routinesState,
    refreshRoutines,
    openCrewCommand,
  } = useApp();
  const control = crewControl({
    onDesktop: isDesktop() && Boolean(bridge()),
    hasDaemon: Boolean(settings.daemon),
    homeReachable: connectivity.homeReachable,
    preferRemoteHub: settings.preferRemoteHub,
  });
  const crew = settings.crew ?? [];
  const projects = settings.projects ?? [];
  const routines = routinesState.routines;

  // The roster shows each member's presence, so the room asks the computer
  // once on arrival (the command center keeps it live).
  useEffect(() => {
    void refreshRoutines();
  }, [refreshRoutines]);

  const [draft, setDraft] = useState<Draft | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();

  const scopeLabel = (a: CrewAgent) => {
    if (a.projectIds.length === 0) return 'All projects';
    const names = projects.filter((p) => a.projectIds.includes(p.id)).map((p) => p.name);
    return names.length ? names.join(', ') : 'All projects';
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const persona = draft.persona.trim();
    if (!name || !persona) {
      showToast('A crew member needs a name and a persona.');
      return;
    }
    const payload = {
      name,
      persona,
      whenCalled: draft.whenCalled?.trim() || undefined,
      activityLevel: draft.activityLevel,
      projectIds: draft.projectIds,
    };
    if (draft.id) await updateCrewAgent(draft.id, payload);
    else await createCrewAgent(payload);
    setDraft(undefined);
    showToast(draft.id ? 'Crew member updated.' : `${name} joined your crew.`);
  };

  // The founder's advisory org, as a crew: eight named perspectives the
  // Reasoning LLM can bring in. Adds only the ones not already here, so the
  // tap is safe to repeat and never duplicates a member someone customized.
  const missingAdvisors = ADVISOR_TEAM.filter((p) => !crew.some((a) => a.name === p.name));
  const addAdvisorTeam = async () => {
    for (const p of missingAdvisors) {
      await createCrewAgent({
        name: p.name,
        persona: p.persona,
        whenCalled: p.whenCalled,
        activityLevel: p.activityLevel,
        projectIds: [],
      });
    }
    showToast(
      missingAdvisors.length
        ? `${missingAdvisors.length} advisors joined your crew. The CTO reviews every build.`
        : 'Your advisor team is already here.',
    );
  };

  return (
    <div className="screen">
      <BackBar title="My Crew" />
      <div className="screen-inner">
        <h1>My Crew</h1>
        <p className="lead">
          Build your own agents. Each has a name, a persona, and a rule for how and when it is
          called. Point them at specific projects, or let them work across all of them.
        </p>

        {/* The door to the command center: the crew's unattended work, with
            a live line so the roster reads as a team, not a list. */}
        <button
          type="button"
          className="crew-command-door press-fb press-fb--row"
          onClick={openCrewCommand}
        >
          <span className="crew-command-door-body">
            <span className="crew-command-door-kicker">
              Crew command
              {control.where === 'away' ? ' · View only' : control.can ? ' · In control' : ''}
            </span>
            <span className="crew-command-door-title">
              {routines.length ? 'Your crew at work' : 'Put your crew to work'}
            </span>
            <span className="crew-command-door-sub">
              {control.where === 'unpaired'
                ? 'Pair your machine, then routines run while you are away.'
                : control.where === 'away'
                  ? 'Away from your machine. Watch here, reconnect to take control.'
                  : crewHeadline(routines, routinesState.runs)}
            </span>
          </span>
          <span className="cc-row-chevron" aria-hidden="true" />
        </button>

        <button
          className="btn primary"
          style={{ width: '100%' }}
          onClick={() => setDraft(emptyDraft())}
        >
          + New crew member
        </button>
        {missingAdvisors.length ? (
          <button
            className="btn ghost press-fb"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => void addAdvisorTeam()}
          >
            Add the advisor team ({missingAdvisors.length})
          </button>
        ) : null}
        <p className="hint" style={{ marginTop: 8 }}>
          The advisor team is a CTO who reviews every build, a CMO, CFO, and Creative Studio that
          step in when a decision needs them, and a CX lead, Chief of Staff, Board, and Strategist
          who answer when asked. All advisory. You decide.
        </p>

        {crew.length === 0 ? (
          <p className="hint" style={{ marginTop: 14 }}>
            No crew yet. Add a reviewer that checks every build, a specialist the Reasoning LLM can
            call on its own, or an expert that waits until you ask.
          </p>
        ) : (
          crew.map((a) => (
            <div className="card" key={a.id} style={{ marginTop: 12 }}>
              <div className="card-row">
                <span className={`crew-monogram ${a.activityLevel}`} aria-hidden="true">
                  {(a.name.trim()[0] ?? '?').toUpperCase()}
                </span>
                <div className="grow">
                  <h3>{a.name}</h3>
                  <div className="sub">
                    {levelLabel(a.activityLevel)} · {scopeLabel(a)}
                  </div>
                </div>
              </div>
              <p className="sub" style={{ marginTop: 6 }}>
                {a.persona.length > 120 ? `${a.persona.slice(0, 120)}...` : a.persona}
              </p>
              {(() => {
                const mine = routinesForAgent(routines, a);
                const line = agentPresenceLine(mine);
                if (!line) return null;
                const busiest = busiestFirst(mine)[0]!;
                return (
                  <div className="crew-presence">
                    <span
                      className={`cc-dot ${presenceTone(busiest.presence)}`}
                      aria-hidden="true"
                    />
                    {line}
                  </div>
                );
              })()}
              <div
                className="suggestion-row"
                style={{ justifyContent: 'flex-start', marginTop: 4 }}
              >
                <button className="suggestion" onClick={() => setDraft({ ...a })}>
                  Edit
                </button>
                <button className="suggestion" onClick={() => setConfirmDelete(a.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Editor sheet: identity, persona, call rule, activity level, projects. */}
      <Sheet open={Boolean(draft)} onClose={() => setDraft(undefined)}>
        {draft ? (
          <>
            <h2>{draft.id ? 'Edit crew member' : 'New crew member'}</h2>

            <div className="field">
              <label>Name</label>
              <input
                placeholder="e.g. Security Reviewer, Ghostwriter, Contrarian"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Persona</label>
              <textarea
                rows={4}
                placeholder="Who this agent is, how it thinks, and how it should speak."
                value={draft.persona}
                onChange={(e) => setDraft({ ...draft, persona: e.target.value })}
              />
            </div>

            <div className="field">
              <label>How and when it is called (optional)</label>
              <input
                placeholder="e.g. anything touching auth or payments"
                value={draft.whenCalled ?? ''}
                onChange={(e) => setDraft({ ...draft, whenCalled: e.target.value })}
              />
            </div>

            <div className="field">
              <label>Activity level</label>
              <select
                className="select"
                value={draft.activityLevel}
                onChange={(e) =>
                  setDraft({ ...draft, activityLevel: e.target.value as CrewActivityLevel })
                }
              >
                {LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <p className="hint" style={{ marginTop: 6 }}>
                {LEVELS.find((l) => l.id === draft.activityLevel)?.hint}
              </p>
            </div>

            <div className="field">
              <label>Projects</label>
              <ProjectMultiSelect
                projects={projects}
                selected={draft.projectIds}
                onChange={(ids) => setDraft({ ...draft, projectIds: ids })}
              />
            </div>

            <div className="sheet-actions">
              <button
                className="btn primary"
                disabled={!draft.name.trim() || !draft.persona.trim()}
                onClick={() => void save()}
              >
                {draft.id ? 'Save' : 'Add to crew'}
              </button>
              <button className="btn quiet" onClick={() => setDraft(undefined)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      <Sheet open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(undefined)}>
        {confirmDelete ? (
          <>
            <h2>Remove this crew member?</h2>
            <p className="sheet-sub">This cannot be undone.</p>
            <div className="sheet-actions">
              <button
                className="btn primary"
                onClick={async () => {
                  const id = confirmDelete;
                  setConfirmDelete(undefined);
                  await deleteCrewAgent(id);
                  showToast('Crew member removed.');
                }}
              >
                Remove
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
