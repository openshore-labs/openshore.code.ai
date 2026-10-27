// A project's agents (founder, 2026-10-27): every agent from Agents starts
// ticked, the way Choose repositories lists what a project works in, and a
// tick taken off leaves that agent out of this project's chats. Below the
// list, an agent made for this project alone. One rule decides who is in
// (lib/projectAgents.ts); the chat reads the same rule.
import { useState, type CSSProperties } from 'react';
import { useApp } from '../state/store.js';
import type { Project } from '../state/types.js';
import { agentInProject } from '../lib/projectAgents.js';
import { Sheet } from './Sheet.js';
import { SheetHead } from './SheetHead.js';

export function ProjectAgentsSheet({
  project,
  open,
  onClose,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  const { settings, setProjectAgents, addProjectAgent, setView, showToast } = useApp();
  const agents = settings.crew ?? [];
  const inProject = (id: string) => {
    const a = agents.find((x) => x.id === id);
    return Boolean(a && agentInProject(a, project.id, project));
  };
  const [draft, setDraft] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [persona, setPersona] = useState('');
  // Re-seed the ticks each time the sheet opens on a project.
  const [seededFor, setSeededFor] = useState<string | undefined>();
  if (open && seededFor !== project.id) {
    setSeededFor(project.id);
    setDraft(agents.filter((a) => agentInProject(a, project.id, project)).map((a) => a.id));
  }
  if (!open && seededFor !== undefined) setSeededFor(undefined);

  const dirty =
    agents.some((a) => draft.includes(a.id) !== inProject(a.id)) ||
    Boolean(name.trim() && persona.trim());

  const save = async () => {
    await setProjectAgents(project.id, draft);
    if (name.trim() && persona.trim()) {
      await addProjectAgent(project.id, { name, persona });
      setName('');
      setPersona('');
    }
    showToast('Agents saved.');
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHead title="Agents" onClose={onClose} />
      <p className="sheet-sub">
        The agents that work in this project. Every agent from Agents starts here; untick one to
        leave it out of this project&apos;s chats.
      </p>
      {agents.length ? (
        <div className="check-list">
          {agents.map((a, i) => {
            const on = draft.includes(a.id);
            const own = a.projectIds.length === 1 && a.projectIds[0] === project.id;
            return (
              <label
                key={a.id}
                className="multiselect-row stagger-in"
                style={{ '--i': Math.min(i, 8) } as CSSProperties}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setDraft(on ? draft.filter((x) => x !== a.id) : [...draft, a.id])}
                />
                <span>
                  {a.name}
                  {own ? <span className="hint"> · this project only</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="hint">No agents yet. Make one below, or in Agents.</p>
      )}

      <div className="field project-agent-new">
        <label htmlFor="project-agent-name">An agent for this project</label>
        <input
          id="project-agent-name"
          maxLength={60}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="project-agent-persona" className="visually-hidden">
          Who it is
        </label>
        <textarea
          id="project-agent-persona"
          rows={3}
          placeholder="Who it is and how it works, in a few lines."
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
      </div>

      <div className="sheet-actions">
        <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
        <button
          className="btn quiet"
          onClick={() => {
            onClose();
            setView('crew');
          }}
        >
          Open Agents
        </button>
      </div>
    </Sheet>
  );
}
