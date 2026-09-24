// A project's own room: everything the coding agent needs, tailored to this
// project. Redesigned 2026-09-15 (founder: "75% of work happens here") from a
// stack of identical config cards into a WORKSPACE. The room now leads with the
// work: a premium cover carries the name, the live counts, and the one action
// that matters (start or resume a chat), then the chats sit first, and the
// context that rides into them (standing instructions, repositories) and the
// team roster follow. Its chats, its standing instructions, the repositories
// (and so the files) it works in, and, for a company account, who on the team
// may read, write, or edit it. Reached by tapping a project on the Projects list.
//
// Honest scope: projects are device-local today, so the team-access controls
// configure who WILL have access once a project is shared with the team (a
// server-backed capability on the roadmap). They never lock the local owner
// out of their own project. Same posture as the Account/Org model.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp, stackAdmin } from '../state/store.js';
import type { Conversation, Project, ProjectAccess, ProjectPermission } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';
import { ProjectCurrents } from '../components/ProjectCurrents.js';
import { Sheet } from '../components/Sheet.js';
import { useConnectedRepos } from '../hooks/useConnectedRepos.js';
import { isGithubRepoId, repoLabel } from '../lib/chatRepos.js';
import {
  PERMISSION_LADDER,
  canEdit,
  canWrite,
  permissionLabel,
  projectPermissionFor,
} from '../lib/projectAccess.js';
import { relativeTime, sourceShort } from './ChatsScreen.js';
import { useTitleHero } from '../lib/heroTitle.js';
import { durationMs } from '../lib/motion.js';
import { Icon } from '../components/Icon.js';

export function ProjectDetailScreen() {
  const {
    settings,
    viewProjectId,
    conversations,
    order,
    activeId,
    setActiveProject,
    updateProject,
    deleteProject,
    setProjectAccess,
    shareProject,
    unshareProject,
    openConversation,
    startProjectChat,
    openProjectMemory,
    setView,
    showToast,
  } = useApp();

  const project = settings.projects?.find((p) => p.id === viewProjectId);
  const account = settings.account;
  const isActive = (settings.activeProjectId ?? settings.projects?.[0]?.id) === project?.id;
  const isCommercial = account?.type === 'commercial';
  // The signed-in person's level on this project. A local project is fully the
  // owner's ('edit'); a shared project trusts the server-resolved level, so a
  // read/write teammate sees it but cannot change its content or roster.
  const myLevel = projectPermissionFor(project ?? {});
  const mayEdit = canEdit(myLevel);
  const mayWrite = canWrite(myLevel);
  // Who can change the roster: an editor on a shared project; a company admin on
  // a local draft (which ships when the project is shared).
  const canManageAccess = project?.shared ? mayEdit : isCommercial && stackAdmin(account);
  // Only a company admin can lift a local project onto the org server.
  const canShare = Boolean(project && !project.shared && isCommercial && stackAdmin(account));

  // Details editor (name + standing instructions), saved on demand.
  const [details, setDetails] = useState<{ name: string; instructions: string } | undefined>();
  const editingDetails = details !== undefined;
  const [manageRepos, setManageRepos] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The project name flies up from the tapped card into this title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useTitleHero(titleRef);

  // Save earns its emphasis only once the draft actually differs, so an
  // untouched editor never dangles a live-looking button.
  const detailsDirty =
    details !== undefined &&
    (details.name.trim() !== project?.name ||
      details.instructions !== (project?.instructions ?? ''));

  const chats = useMemo(
    () =>
      order
        .map((id) => conversations[id])
        .filter((c): c is Conversation => Boolean(c) && c!.projectId === project?.id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [order, conversations, project?.id],
  );

  if (!project) {
    // The project was deleted out from under the room; the store routes back to
    // the list, but guard the render in case this paints first.
    return (
      <div className="screen">
        <BackBar title="Project" />
        <div className="screen-inner">
          <p className="hint">This project is no longer here.</p>
        </div>
      </div>
    );
  }

  const startDetails = () =>
    setDetails({ name: project.name, instructions: project.instructions ?? '' });

  const saveDetails = async () => {
    if (!details) return;
    await updateProject(project.id, {
      name: details.name.trim() || 'Untitled project',
      instructions: details.instructions,
    });
    setDetails(undefined);
    showToast('Project updated.');
  };

  // The single highest-value action for a returning person: pick up the chat
  // they were last in. Absent on a fresh project, where "New chat" leads.
  const resume = chats[0];
  const repoCount = project.repoIds.length;

  const newChat = mayWrite ? (
    <button
      type="button"
      className="icon-btn press-fb"
      aria-label="New chat in this project"
      title="New chat in this project"
      onClick={() => {
        startProjectChat(project.id);
      }}
    >
      <ComposeIcon />
    </button>
  ) : undefined;

  return (
    <div className="screen">
      <BackBar title={project.name} action={newChat} />
      <div className="screen-inner project-room">
        {/* The cover: identity, live counts, and the action that matters. */}
        <header className="project-cover">
          <div className="project-cover-wash" aria-hidden="true" />
          <div className="project-cover-body">
            <div className="project-cover-top">
              <span className="project-kicker">Project</span>
              {isActive ? (
                <span className="pill local">active</span>
              ) : (
                <button
                  className="suggestion project-activate"
                  onClick={() => {
                    setActiveProject(project.id);
                    showToast(`${project.name} is now active.`);
                  }}
                >
                  Make active
                </button>
              )}
              {project.shared ? <span className="pill muted">Shared</span> : null}
              {project.shared && !mayEdit && myLevel ? (
                <span className="pill muted">You {permissionLabel(myLevel).toLowerCase()}</span>
              ) : null}
            </div>

            <h1 ref={titleRef} className="project-hero-title">
              {project.name}
            </h1>
            <p className="project-cover-lead">
              Everything for this project in one place. Its instructions and repositories ride into
              every chat here.
            </p>

            <div className="project-stats" role="list">
              <div className="project-stat" role="listitem">
                <span className="project-stat-num">{chats.length}</span>
                <span className="project-stat-label">{chats.length === 1 ? 'chat' : 'chats'}</span>
              </div>
              <div className="project-stat" role="listitem">
                <span className="project-stat-num">{repoCount}</span>
                <span className="project-stat-label">{repoCount === 1 ? 'repo' : 'repos'}</span>
              </div>
              {isCommercial ? (
                <div className="project-stat" role="listitem">
                  <span className="project-stat-num">{project.access?.length ?? 0}</span>
                  <span className="project-stat-label">on the team</span>
                </div>
              ) : null}
            </div>

            <div className="project-cover-actions">
              {mayWrite ? (
                <button className="btn primary" onClick={() => startProjectChat(project.id)}>
                  New chat
                </button>
              ) : null}
              {resume ? (
                <button className="btn ghost" onClick={() => openConversation(resume.id)}>
                  {mayWrite ? 'Resume last chat' : 'Open last chat'}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {/* Work first: the chats in this project. */}
        <section className="card project-section" style={{ '--i': 0 } as CSSProperties}>
          <div className="card-row">
            <h3 className="grow">Chats</h3>
            {chats.length ? <span className="hint">{chats.length}</span> : null}
          </div>

          {resume ? (
            <button
              type="button"
              className="resume-card press-fb press-fb--row"
              onClick={() => openConversation(resume.id)}
            >
              <div className="resume-card-body">
                <span className="resume-eyebrow">
                  {resume.thread.busy ? (
                    <span className="chat-row-live" aria-label="working" />
                  ) : null}
                  {mayWrite ? 'Pick up where you left off' : 'Most recent'}
                </span>
                <span className="resume-title">{resume.title}</span>
                <span className="resume-sub">
                  {relativeTime(resume.updatedAt)} · {sourceShort(resume)}
                </span>
              </div>
              <span className="disclosure-chevron" aria-hidden="true" />
            </button>
          ) : null}

          <div className="chat-list" style={{ marginTop: resume ? 12 : 4 }}>
            {mayWrite ? (
              <button
                type="button"
                className="chat-row chat-row-new press-fb press-fb--row"
                onClick={() => {
                  startProjectChat(project.id);
                }}
              >
                <span className="chat-row-title">
                  <span className="chat-new-plus" aria-hidden="true">
                    +
                  </span>
                  New chat
                </span>
              </button>
            ) : null}
            {chats.slice(resume ? 1 : 0).map((conv, i) => {
              const style = { '--stagger': `${Math.min(i, 8) * 22}ms` } as CSSProperties;
              return (
                <button
                  key={conv.id}
                  type="button"
                  className={`chat-row press-fb press-fb--row${conv.id === activeId ? ' active' : ''}`}
                  style={style}
                  onClick={() => openConversation(conv.id)}
                >
                  <span className="chat-row-title">
                    {conv.thread.busy ? (
                      <span className="chat-row-live" aria-label="working" />
                    ) : null}
                    {conv.title}
                  </span>
                  <span className="chat-row-sub">
                    {relativeTime(conv.updatedAt)} · {sourceShort(conv)}
                  </span>
                </button>
              );
            })}
          </div>
          {chats.length === 0 ? (
            <p className="hint" style={{ marginTop: 6 }}>
              {mayWrite
                ? 'No chats yet. Start one and it stays with this project.'
                : 'No chats yet. You have read access, so you can see this project but not start chats in it.'}
            </p>
          ) : null}
        </section>

        {/* Context that rides into every chat: standing instructions. */}
        <section className="card project-section" style={{ '--i': 1 } as CSSProperties}>
          <div className="card-row">
            <div className="grow">
              <span className="project-eyebrow">Rides into every chat</span>
              <h3>Standing instructions</h3>
            </div>
            {!editingDetails && mayEdit ? (
              <button className="suggestion" onClick={startDetails}>
                Edit
              </button>
            ) : null}
          </div>
          {editingDetails ? (
            <>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Name</label>
                <input
                  value={details.name}
                  onChange={(e) => setDetails({ ...details, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Standing instructions (optional)</label>
                <textarea
                  rows={5}
                  placeholder="Context and rules every chat in this project should follow."
                  value={details.instructions}
                  onChange={(e) => setDetails({ ...details, instructions: e.target.value })}
                />
              </div>
              <div className="sheet-actions">
                <button
                  className={detailsDirty ? 'btn primary' : 'btn quiet'}
                  disabled={!detailsDirty}
                  onClick={() => void saveDetails()}
                >
                  Save
                </button>
                <button className="btn quiet" onClick={() => setDetails(undefined)}>
                  {detailsDirty ? 'Cancel' : 'Done'}
                </button>
              </div>
            </>
          ) : project.instructions?.trim() ? (
            <p className="project-instructions">{project.instructions.trim()}</p>
          ) : (
            <p className="hint" style={{ marginTop: 6 }}>
              {mayEdit
                ? 'None yet. Add context and rules every chat here should follow.'
                : 'No standing instructions yet.'}
            </p>
          )}
        </section>

        {/* Currents chosen for this project: the workflow's cheap decision
            method (Harness) and its agent modality (Agentic). Per project so
            different projects run different currents at once. Connecting one is
            device-local, reached from its row. Editors only. */}
        {mayEdit ? <ProjectCurrents projectId={project.id} index={2} /> : null}

        {/* Context that rides into every chat: repositories and their files. */}
        <section className="card project-section" style={{ '--i': 2 } as CSSProperties}>
          <div className="card-row">
            <div className="grow">
              <span className="project-eyebrow">Rides into every chat</span>
              <h3>Repositories and files</h3>
            </div>
            {mayEdit ? (
              <button className="suggestion" onClick={() => setManageRepos(true)}>
                Manage
              </button>
            ) : null}
          </div>
          {repoCount ? (
            <>
              <div className="repo-chips">
                {project.repoIds.map((id) => (
                  <span key={id} className={`repo-chip${isGithubRepoId(id) ? '' : ' local'}`}>
                    {isGithubRepoId(id) ? <GithubGlyph /> : <FolderGlyph />}
                    <span className="repo-chip-name">{repoLabel(id)}</span>
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="project-memory-link press-fb press-fb--row"
                onClick={() => openProjectMemory(project.id)}
              >
                <MemoryGlyph />
                <span className="grow">What the agent has learned here</span>
                <span className="disclosure-chevron" aria-hidden="true" />
              </button>
            </>
          ) : (
            <p className="hint" style={{ marginTop: 6 }}>
              No repositories yet.{' '}
              {mayEdit ? 'Attach one so the agent has the project’s files in context.' : ''}
            </p>
          )}
        </section>

        {/* Enterprise: who on the team can read, write, or edit. */}
        {isCommercial ? (
          <TeamAccess
            index={3}
            project={project}
            canManage={canManageAccess}
            myLevel={myLevel}
            selfEmail={account?.selfEmail}
            onChange={(access) => void setProjectAccess(project.id, access)}
          />
        ) : null}

        <div className="suggestion-row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
          {canShare ? (
            <button className="suggestion" onClick={() => void shareProject(project.id)}>
              Share with team
            </button>
          ) : null}
          {project.shared && mayEdit ? (
            <button className="suggestion" onClick={() => void unshareProject(project.id)}>
              Stop sharing
            </button>
          ) : null}
          {mayEdit ? (
            <button className="suggestion project-delete" onClick={() => setConfirmDelete(true)}>
              Delete project
            </button>
          ) : null}
        </div>
      </div>

      {/* Manage repositories: the same combined list the chat header offers. */}
      <ManageReposSheet
        open={manageRepos}
        project={project}
        onClose={() => setManageRepos(false)}
        onSave={async (repoIds) => {
          await updateProject(project.id, { repoIds });
          setManageRepos(false);
        }}
        onOpenRepos={() => {
          setManageRepos(false);
          setView('repos');
        }}
      />

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} variant="confirm">
        <h3>Delete this project?</h3>
        <p>
          {project.shared
            ? 'This removes the project for your whole team. Each person keeps their own chats; they just stop belonging to a project. This cannot be undone.'
            : 'Its chats are kept. They just stop belonging to a project. This cannot be undone.'}
        </p>
        <div className="confirm-row">
          <button className="btn ghost" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              setConfirmDelete(false);
              await deleteProject(project.id);
              showToast('Project deleted.');
            }}
          >
            Delete
          </button>
        </div>
      </Sheet>
    </div>
  );
}

/** The team-access card: who can read, write, or edit, by email. Admins add and
 *  change grants; members see the roster read-only. */
function TeamAccess({
  index,
  project,
  canManage,
  myLevel,
  selfEmail,
  onChange,
}: {
  index: number;
  project: Project;
  canManage: boolean;
  myLevel: ProjectPermission | undefined;
  selfEmail?: string;
  onChange: (access: ProjectAccess[]) => void;
}) {
  const access = project.access ?? [];
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<ProjectPermission>('write');
  // A removed row plays its exit before the data drops it, the way a deleted
  // chat leaves its list. accessRef keeps the freshest list so two quick
  // removes never clobber each other's mutation.
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const accessRef = useRef(access);
  accessRef.current = access;
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const rowOutMs = durationMs('--dur-3', 220);

  const add = () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes('@')) return;
    const next = access.filter((a) => a.email.trim().toLowerCase() !== e);
    next.push({ email: e, level, grantedAt: new Date().toISOString() });
    onChange(next);
    setEmail('');
  };
  const setGrantLevel = (targetEmail: string, l: ProjectPermission) =>
    onChange(access.map((a) => (a.email === targetEmail ? { ...a, level: l } : a)));
  const remove = (targetEmail: string) => {
    setLeaving((s) => new Set(s).add(targetEmail));
    const t = window.setTimeout(() => {
      onChange(accessRef.current.filter((a) => a.email !== targetEmail));
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(targetEmail);
        return n;
      });
    }, rowOutMs);
    timers.current.push(t);
  };

  return (
    <section className="card project-section" style={{ '--i': index } as CSSProperties}>
      <div className="card-row">
        <div className="grow">
          <h3>Team access</h3>
          <div className="sub">
            {project.shared
              ? 'Who on your team can read, write, or edit this project. Changes apply right away and are enforced on the server.'
              : 'Draft who can read, write, or edit. It applies the moment you share this project with your team.'}
          </div>
        </div>
      </div>

      {!canManage ? (
        <p className="hint" style={{ marginTop: 6 }}>
          {myLevel ? `Your access: ${permissionLabel(myLevel).toLowerCase()}. ` : ''}
          Only an editor can change who has access.
        </p>
      ) : (
        <>
          <div className="field" style={{ marginTop: 8 }}>
            <label>Add a teammate by email</label>
            <input
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <div className="segmented" role="tablist" aria-label="Access level">
            {PERMISSION_LADDER.map((l) => (
              <button
                key={l}
                role="tab"
                aria-selected={level === l}
                className={`seg press-fb${level === l ? ' active' : ''}`}
                onClick={() => setLevel(l)}
              >
                {permissionLabel(l)}
              </button>
            ))}
          </div>
          <button
            className="btn primary"
            style={{ width: '100%', marginTop: 10 }}
            disabled={!email.trim().includes('@')}
            onClick={add}
          >
            Add
          </button>
        </>
      )}

      {access.length ? (
        <div className="check-list" style={{ marginTop: 12 }}>
          {access.map((a, i) => (
            <div
              key={a.email}
              className={`multiselect-row access-row${leaving.has(a.email) ? ' leaving' : ''}`}
              style={
                { cursor: 'default', '--stagger': `${Math.min(i, 8) * 22}ms` } as CSSProperties
              }
            >
              <span className="grow">
                {a.email}
                {selfEmail && a.email.toLowerCase() === selfEmail.toLowerCase() ? (
                  <span className="hint"> · you</span>
                ) : null}
              </span>
              {canManage ? (
                <>
                  <div className="segmented" role="tablist" aria-label={`Access for ${a.email}`}>
                    {PERMISSION_LADDER.map((l) => (
                      <button
                        key={l}
                        role="tab"
                        aria-selected={a.level === l}
                        className={`seg press-fb${a.level === l ? ' active' : ''}`}
                        onClick={() => setGrantLevel(a.email, l)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <button
                    className="suggestion"
                    aria-label={`Remove ${a.email}`}
                    onClick={() => remove(a.email)}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="pill">{a.level}</span>
              )}
            </div>
          ))}
        </div>
      ) : canManage ? (
        <p className="hint" style={{ marginTop: 10 }}>
          No one added yet. You always have full access as an admin.
        </p>
      ) : null}
    </section>
  );
}

/** The manage-repositories sheet: toggle the project's attached repos from the
 *  connected computer workspaces and GitHub repos. */
function ManageReposSheet({
  open,
  project,
  onClose,
  onSave,
  onOpenRepos,
}: {
  open: boolean;
  project: Project;
  onClose: () => void;
  onSave: (repoIds: string[]) => void | Promise<void>;
  onOpenRepos: () => void;
}) {
  const repos = useConnectedRepos(open);
  const repoOptions = [...repos.workspaces, ...repos.github];
  const [draft, setDraft] = useState<string[]>(project.repoIds);
  // Re-seed the draft each time the sheet opens on a project.
  const [seededFor, setSeededFor] = useState<string | undefined>();
  if (open && seededFor !== project.id) {
    setSeededFor(project.id);
    setDraft(project.repoIds);
  }
  if (!open && seededFor !== undefined) setSeededFor(undefined);

  return (
    <Sheet open={open} onClose={onClose}>
      <h2>Repositories</h2>
      <p className="sheet-sub">
        The codebases this project works in, shareable across projects. Their files ride into every
        chat here as context.
      </p>
      {repoOptions.length ? (
        <div className="check-list">
          {repoOptions.map((r) => {
            const on = draft.includes(r.id);
            return (
              <label key={r.id} className="multiselect-row">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setDraft(on ? draft.filter((x) => x !== r.id) : [...draft, r.id])}
                />
                <span>
                  {r.name}
                  {r.kind === 'github' && r.detail ? (
                    <span className="hint"> · {r.detail} on GitHub</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="hint">
          {repos.loading
            ? 'Loading your repositories.'
            : 'Connect your computer or GitHub to attach repositories.'}
        </p>
      )}
      <div className="sheet-actions">
        <button className="btn primary" onClick={() => void onSave(draft)}>
          Save
        </button>
        <button className="btn quiet" onClick={onOpenRepos}>
          Manage repositories
        </button>
      </div>
    </Sheet>
  );
}

function ComposeIcon() {
  return (
    <Icon size={22}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </Icon>
  );
}

function FolderGlyph() {
  return (
    <Icon size={14}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Icon>
  );
}

function GithubGlyph() {
  return (
    <Icon size={14} variant="fill">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.22-3.37-1.22-.46-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.57 2.35 1.11 2.92.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </Icon>
  );
}

function MemoryGlyph() {
  return (
    <Icon size={16}>
      <path d="M12 3a4 4 0 0 0-4 4v.5A3.5 3.5 0 0 0 6 14a3 3 0 0 0 3 3 3 3 0 0 0 3 1 3 3 0 0 0 3-1 3 3 0 0 0 3-3 3.5 3.5 0 0 0-2-6.5V7a4 4 0 0 0-4-4Z" />
      <path d="M12 3v18" />
    </Icon>
  );
}
