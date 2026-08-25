// Projects, organized the way Claude's projects are: the room opens on a plain
// list of your projects, and tapping one drops you inside it, where its chats,
// its repositories, and its standing instructions live together. The "..." menu
// at the top edits the project's details; the repositories row attaches repos
// straight from the Repositories section. Every chat you start here inherits the
// project's repositories by default, so a project keeps touching the same repos
// until you start another one.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store.js';
import { bridge } from '../lib/electronBridge.js';
import { isDesktop } from '../lib/platform.js';
import { daemonWorkspaces } from '../drivers/remoteDriver.js';
import { useDismissable } from '../lib/useDismissable.js';
import { availableRepos, repoRefLabel } from '../lib/availableRepos.js';
import { RepoPickerSheet } from '../components/RepoPickerSheet.js';
import { BackBar } from '../components/BackBar.js';
import type { Project } from '../state/types.js';

export function ProjectsScreen() {
  const { settings, conversations, order, createProject } = useApp();

  const projects = settings.projects ?? [];
  const activeId = settings.activeProjectId ?? projects[0]?.id;

  const [newName, setNewName] = useState('');
  // Which project's detail is open. Undefined shows the list. Seeded once from
  // the one-shot nav hint (set when you tap the project chip in a chat), then
  // the hint is cleared so a later nav-in lands on the list.
  const [openId, setOpenId] = useState<string | undefined>(
    () => useApp.getState().pendingProjectDetailId,
  );
  useEffect(() => {
    if (useApp.getState().pendingProjectDetailId) {
      useApp.setState({ pendingProjectDetailId: undefined });
    }
  }, []);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const id = await createProject(name);
    setNewName('');
    setOpenId(id);
  };

  // Falls back to the list on its own when the open project no longer exists
  // (deleted from its detail view, which also calls onBack).
  const openProject = projects.find((p) => p.id === openId);

  if (openProject) {
    return (
      <ProjectDetail
        project={openProject}
        isActive={openProject.id === activeId}
        onBack={() => setOpenId(undefined)}
      />
    );
  }

  return (
    <div className="screen projects-list-screen">
      <BackBar title="Projects" />
      <div className="screen-inner">
        <h1>Projects</h1>
        <p className="lead">
          A project keeps its chats, its repositories, and its standing instructions together. Open
          one to work inside it.
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
          projects.map((p) => {
            const chatCount = order.filter(
              (id) => conversations[id] && !conversations[id]!.ephemeral && conversations[id]!.projectId === p.id,
            ).length;
            return (
              <button
                key={p.id}
                className="card project-card"
                onClick={() => setOpenId(p.id)}
              >
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
                    {chatCount ? `${chatCount} chat${chatCount > 1 ? 's' : ''}` : 'No chats yet'}
                    {p.repoIds.length
                      ? ` · ${p.repoIds.length} repo${p.repoIds.length > 1 ? 's' : ''}`
                      : ''}
                    {p.instructions?.trim() ? ' · instructions set' : ''}
                  </div>
                </div>
                <span className="disclosure-chevron" aria-hidden="true" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// Inside one project: its repositories, its instructions, and its chats. The
// header carries the "..." overflow menu (edit, activate, delete).
function ProjectDetail({
  project,
  isActive,
  onBack,
}: {
  project: Project;
  isActive: boolean;
  onBack: () => void;
}) {
  const {
    settings,
    conversations,
    order,
    updateProject,
    deleteProject,
    setActiveProject,
    openConversation,
    startNewChat,
    showToast,
  } = useApp();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissable(menuRef, menuOpen, () => setMenuOpen(false));

  const [editing, setEditing] = useState<{ name: string; instructions: string } | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [repoPicker, setRepoPicker] = useState(false);
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

  const roster = availableRepos({
    gitosResources: settings.gitosResources,
    homeRepo: settings.repo?.homeRepo,
    workspaces,
  });

  const toggleRepo = (id: string) => {
    const on = project.repoIds.includes(id);
    void updateProject(project.id, {
      repoIds: on ? project.repoIds.filter((x) => x !== id) : [...project.repoIds, id],
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    await updateProject(project.id, {
      name: editing.name.trim() || 'Untitled project',
      instructions: editing.instructions,
    });
    setEditing(undefined);
  };

  const chats = order
    .map((id) => conversations[id])
    .filter((c): c is NonNullable<typeof c> => Boolean(c) && !c!.ephemeral && c!.projectId === project.id);

  return (
    <div className="screen project-detail-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back to projects">
          {'‹'}
        </button>
        <div className="topbar-title">
          {project.name}
          {isActive ? <span className="pill local" style={{ marginLeft: 8 }}>active</span> : null}
        </div>
        <div className="project-menu-wrap" ref={menuRef}>
          <button
            className="icon-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Project options"
            aria-expanded={menuOpen}
          >
            {'⋯'}
          </button>
          {menuOpen ? (
            <div className="overflow-menu">
              <button
                className="overflow-item"
                onClick={() => {
                  setMenuOpen(false);
                  setEditing({ name: project.name, instructions: project.instructions ?? '' });
                }}
              >
                Edit details
              </button>
              {isActive ? null : (
                <button
                  className="overflow-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setActiveProject(project.id);
                    showToast(`${project.name} is now active.`);
                  }}
                >
                  Make active
                </button>
              )}
              <button
                className="overflow-item danger"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              >
                Delete project
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="screen-inner">
        {/* Repositories: attached straight from the Repositories section. Every
            chat in this project rides these unless it sets its own. */}
        <div className="section-head">
          <h3>Repositories</h3>
        </div>
        <div className="repo-pill-row">
          {project.repoIds.map((id) => (
            <span key={id} className="repo-pill">
              {repoRefLabel(id, roster)}
              <button
                className="repo-pill-x"
                aria-label={`Remove ${repoRefLabel(id, roster)}`}
                onClick={() => toggleRepo(id)}
              >
                {'×'}
              </button>
            </span>
          ))}
          <button className="repo-pill add" onClick={() => setRepoPicker(true)}>
            {'+ Repositories'}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 2 }}>
          {project.repoIds.length
            ? 'Every chat here runs on these by default. A chat can pick its own.'
            : 'Attach the repositories this project works on. New chats inherit them.'}
        </p>

        {/* Standing instructions: the context every chat in the project carries. */}
        <div className="section-head" style={{ marginTop: 20 }}>
          <h3>Project instructions</h3>
          <button
            className="section-action"
            onClick={() => setEditing({ name: project.name, instructions: project.instructions ?? '' })}
          >
            {project.instructions?.trim() ? 'Edit' : 'Add'}
          </button>
        </div>
        <div className="card">
          {project.instructions?.trim() ? (
            <div className="instructions-body">{project.instructions.trim()}</div>
          ) : (
            <div className="sub">
              No standing instructions yet. Add the context and rules every chat in this project
              should follow.
            </div>
          )}
        </div>

        {/* Chats in this project. */}
        <div className="section-head" style={{ marginTop: 20 }}>
          <h3>Chats</h3>
          <button
            className="section-action"
            onClick={() => {
              setActiveProject(project.id);
              startNewChat();
            }}
          >
            + New chat
          </button>
        </div>
        {chats.length === 0 ? (
          <p className="hint">No chats yet. Start one and it stays with this project.</p>
        ) : (
          chats.map((c) => (
            <button key={c!.id} className="card project-card" onClick={() => openConversation(c!.id)}>
              <div className="grow">
                <h3>{c!.title}</h3>
                <div className="sub">
                  {c!.repoIds
                    ? `${c!.repoIds.length} repo${c!.repoIds.length === 1 ? '' : 's'} (this chat)`
                    : 'Project repositories'}
                </div>
              </div>
              <span className="disclosure-chevron" aria-hidden="true" />
            </button>
          ))
        )}
      </div>

      {repoPicker ? (
        <RepoPickerSheet
          title="Project repositories"
          subtitle="Pick from the repositories you connected in Repositories. New chats inherit these."
          selected={project.repoIds}
          onToggle={toggleRepo}
          onClose={() => setRepoPicker(false)}
        />
      ) : null}

      {editing ? (
        <div className="sheet-scrim" onClick={() => setEditing(undefined)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
                rows={5}
                placeholder="Context and rules every chat in this project should follow."
                value={editing.instructions}
                onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
              />
            </div>
            <div className="sheet-actions">
              <button className="btn primary" onClick={() => void saveEdit()}>
                Save
              </button>
              <button className="btn quiet" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="sheet-scrim" onClick={() => setConfirmDelete(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Delete this project?</h2>
            <p className="sheet-sub">
              Its chats are kept. They just stop belonging to a project. This cannot be undone.
            </p>
            <div className="sheet-actions">
              <button
                className="btn primary"
                onClick={async () => {
                  setConfirmDelete(false);
                  await deleteProject(project.id);
                  showToast('Project deleted.');
                  onBack();
                }}
              >
                Delete project
              </button>
              <button className="btn quiet" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
