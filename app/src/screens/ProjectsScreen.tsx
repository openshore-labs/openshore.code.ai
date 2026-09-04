// Projects: the buckets that hold your work. A project keeps its chats and
// their context together, carries standing instructions into every chat, and
// can share repositories with other projects. Create one to start saving
// chats; tap a project to open its own room (chats, instructions, repos, and,
// for a company account, who on the team may read, write, or edit it).
import { useState } from 'react';
import { useApp } from '../state/store.js';
import { BackBar } from '../components/BackBar.js';
import { captureTitleHero } from '../lib/heroTitle.js';

export function ProjectsScreen() {
  const { settings, createProject, openProject, showToast } = useApp();

  const projects = settings.projects ?? [];
  const activeId = settings.activeProjectId ?? projects[0]?.id;

  const [newName, setNewName] = useState('');

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const id = await createProject(name);
    setNewName('');
    showToast(`${name} is your active project.`);
    openProject(id);
  };

  /** The one-line summary under a project's name. */
  const summary = (instructions: string | undefined, repoCount: number): string => {
    const head = instructions?.trim()
      ? instructions.trim().slice(0, 80)
      : 'No standing instructions yet.';
    return repoCount ? `${head} · ${repoCount} repo${repoCount > 1 ? 's' : ''}` : head;
  };

  return (
    <div className="screen">
      <BackBar title="Projects" />
      <div className="screen-inner">
        <h1>Projects</h1>
        <p className="lead">
          A project keeps its chats and their context together. Standing instructions ride into
          every chat in the project, and repositories can be shared across projects.
        </p>

        <div className="card">
          <h3>New project</h3>
          <div className="field" style={{ marginTop: 10 }}>
            <input
              placeholder="e.g. Uki Audio, Homepage, Weekend hacks"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
          </div>
          <button
            className="btn primary"
            style={{ width: '100%' }}
            disabled={!newName.trim()}
            onClick={() => void create()}
          >
            Create project
          </button>
        </div>

        {projects.length === 0 ? (
          <p className="hint" style={{ marginTop: 14 }}>
            No projects yet. Create one above, then every new chat is saved inside it.
          </p>
        ) : (
          projects.map((p) => (
            <button
              type="button"
              className="card press-fb press-fb--row"
              key={p.id}
              style={{ width: '100%', textAlign: 'left', display: 'block' }}
              onClick={(e) => {
                // Hand the tapped name to the detail room, so it flies up into
                // the room's large title (a shared-element move).
                captureTitleHero(e.currentTarget.querySelector('.project-card-name'));
                openProject(p.id);
              }}
            >
              <div className="card-row">
                <div className="grow">
                  <h3>
                    <span className="project-card-name">{p.name}</span>
                    {p.id === activeId ? (
                      <span className="pill local" style={{ marginLeft: 8 }}>
                        active
                      </span>
                    ) : null}
                  </h3>
                  <div className="sub">{summary(p.instructions, p.repoIds.length)}</div>
                </div>
                <span
                  className="disclosure-chevron"
                  aria-hidden="true"
                  style={{ alignSelf: 'center' }}
                />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
