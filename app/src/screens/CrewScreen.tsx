// My Crew: your own roster of agents. Give each one a name, a persona, and a
// rule for how and when it is called. An Activity Level decides that: it can
// review every build before it ships, let the Reasoning LLM bring it in on its
// own, or stay dormant until you ask for it by name. Scope each to specific
// projects, or let it work across all of them.
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from '../components/BackBar.js';
import { ProjectMultiSelect } from '../components/ProjectMultiSelect.js';
import type { CrewActivityLevel, CrewAgent } from '../state/types.js';

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
  const { settings, createCrewAgent, updateCrewAgent, deleteCrewAgent, showToast } = useApp();
  const crew = settings.crew ?? [];
  const projects = settings.projects ?? [];

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

  return (
    <div className="screen">
      <BackBar title="My Crew" />
      <div className="screen-inner">
        <h1>My Crew</h1>
        <p className="lead">
          Build your own agents. Each has a name, a persona, and a rule for how and when it is
          called. Point them at specific projects, or let them work across all of them.
        </p>

        <button
          className="btn primary"
          style={{ width: '100%' }}
          onClick={() => setDraft(emptyDraft())}
        >
          + New crew member
        </button>

        {crew.length === 0 ? (
          <p className="hint" style={{ marginTop: 14 }}>
            No crew yet. Add a reviewer that checks every build, a specialist the Reasoning LLM can
            call on its own, or an expert that waits until you ask.
          </p>
        ) : (
          crew.map((a) => (
            <div className="card" key={a.id} style={{ marginTop: 12 }}>
              <div className="card-row">
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
              <div className="suggestion-row" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
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
      {draft ? (
        <div className="sheet-scrim" onClick={() => setDraft(undefined)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="sheet-scrim" onClick={() => setConfirmDelete(undefined)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
