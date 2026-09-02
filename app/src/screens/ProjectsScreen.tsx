// Projects: the buckets that hold your work. A project keeps its chats and
// their context together, carries standing instructions into every chat, and
// can share repositories with other projects. Create one to start saving
// chats; switch the active one from here or the sidebar.
import { useEffect, useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonWorkspaces } from '../drivers/remoteDriver.js';
import { BackBar } from '../components/BackBar.js';
import type { Project } from '../state/types.js';
import { Sheet } from '../components/Sheet.js';

export function ProjectsScreen() {
  const {
    settings,
    createProject,
    updateProject,
    deleteProject,
    setActiveProject,
    setView,
    showToast,
  } = useApp();

  const projects = settings.projects ?? [];
  const activeId = settings.activeProjectId ?? projects[0]?.id;

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Project | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const [workspaces, setWorkspaces] = useState<Array<{ cwd: string; name: string }>>([]);

  useEffect(() => {
    void (async () => {
      try {
        if (isDesktop() && bridge()) setWorkspaces(await bridge()!.recentWorkspaces());
        else if (settings.daemon) setWorkspaces(await daemonWorkspaces(settings.daemon));
      } catch {
        setWorkspaces([]);
      }
    })();
  }, [settings.daemon]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    await createProject(name);
    setNewName('');
    showToast(`${name} is your active project.`);
  };

  const saveEdit = async () => {
    if (!editing) return;
    await updateProject(editing.id, {
      name: editing.name.trim() || 'Untitled project',
      instructions: editing.instructions,
      repoIds: editing.repoIds,
    });
    setEditing(undefined);
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
            <div className="card" key={p.id}>
              <div className="card-row">
                <div className="grow">
                  <h3>
                    {p.name}
                    {p.id === activeId ? (
                      <span className="pill local" style={{ marginLeft: 8 }}>
                        active
                      </span>
                    ) : null}
                  </h3>
                  <div className="sub">
                    {p.instructions?.trim()
                      ? p.instructions.trim().slice(0, 80)
                      : 'No standing instructions yet.'}
                    {p.repoIds.length
                      ? ` · ${p.repoIds.length} repo${p.repoIds.length > 1 ? 's' : ''}`
                      : ''}
                  </div>
                </div>
              </div>
              <div
                className="suggestion-row"
                style={{ justifyContent: 'flex-start', marginTop: 4 }}
              >
                {p.id === activeId ? null : (
                  <button
                    className="suggestion"
                    onClick={() => {
                      setActiveProject(p.id);
                      showToast(`${p.name} is now active.`);
                    }}
                  >
                    Make active
                  </button>
                )}
                <button
                  className="suggestion"
                  onClick={() => {
                    setActiveProject(p.id);
                    setView('chat');
                    useApp.setState({ activeId: undefined });
                  }}
                >
                  Open a chat
                </button>
                <button className="suggestion" onClick={() => setEditing({ ...p })}>
                  Edit
                </button>
                <button className="suggestion" onClick={() => setConfirmDelete(p.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit sheet: name, standing instructions, shared repos. */}
      <Sheet open={Boolean(editing)} onClose={() => setEditing(undefined)}>
        {editing ? (
          <>
            <h2>Edit project</h2>
            <div className="field">
              <label>Name</label>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Standing instructions (optional)</label>
              <textarea
                rows={4}
                placeholder="Context and rules every chat in this project should follow."
                value={editing.instructions ?? ''}
                onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
              />
            </div>

            {workspaces.length ? (
              <div className="field">
                <label>Repositories (shareable across projects)</label>
                <div className="check-list">
                  {workspaces.map((ws) => {
                    const on = editing.repoIds.includes(ws.cwd);
                    return (
                      <label key={ws.cwd} className="multiselect-row">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setEditing({
                              ...editing,
                              repoIds: on
                                ? editing.repoIds.filter((x) => x !== ws.cwd)
                                : [...editing.repoIds, ws.cwd],
                            })
                          }
                        />
                        <span>{ws.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="hint">Connect your desktop to attach repositories to this project.</p>
            )}

            <div className="sheet-actions">
              <button className="btn primary" onClick={() => void saveEdit()}>
                Save
              </button>
              <button className="btn quiet" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </Sheet>

      {/* Delete confirmation. Chats survive; they just lose the project link. */}
      <Sheet open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(undefined)}>
        {confirmDelete ? (
          <>
            <h2>Delete this project?</h2>
            <p className="sheet-sub">
              Its chats are kept. They just stop belonging to a project. This cannot be undone.
            </p>
            <div className="sheet-actions">
              <button
                className="btn primary"
                onClick={async () => {
                  const id = confirmDelete;
                  setConfirmDelete(undefined);
                  await deleteProject(id);
                  showToast('Project deleted.');
                }}
              >
                Delete project
              </button>
              <button className="btn quiet" onClick={() => setConfirmDelete(undefined)}>
                Keep it
              </button>
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
