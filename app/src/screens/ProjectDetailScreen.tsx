// A project's own room: everything the coding agent needs, tailored to this
// project. Its chats, its standing instructions, the repositories (and so the
// files) it works in, and, for a company account, who on the team may read,
// write, or edit it. Reached by tapping a project on the Projects list.
//
// Honest scope: projects are device-local today, so the team-access controls
// configure who WILL have access once a project is shared with the team (a
// server-backed capability on the roadmap). They never lock the local owner
// out of their own project. Same posture as the Account/Org model.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp, stackAdmin } from '../state/store.js';
import type { Conversation, Project, ProjectAccess, ProjectPermission } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';
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

/** A short, live summary line for the header: chats · repos · access. */
function summaryLine(project: Project, chatCount: number, showAccess: boolean): string {
  const parts = [`${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}`];
  if (project.repoIds.length)
    parts.push(`${project.repoIds.length} ${project.repoIds.length === 1 ? 'repo' : 'repos'}`);
  if (showAccess && project.access?.length) parts.push(`${project.access.length} on the team`);
  return parts.join(' · ');
}

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
      <div className="screen-inner">
        <h1 ref={titleRef} className="project-hero-title">
          {project.name}
        </h1>
        <p className="lead">
          Everything for this project in one place. Standing instructions and its repositories ride
          into every chat here, so the coding agent works the way this project needs.
        </p>
        <div className="suggestion-row" style={{ justifyContent: 'flex-start', marginTop: 2 }}>
          {isActive ? (
            <span className="pill local">active</span>
          ) : (
            <button
              className="suggestion"
              onClick={() => {
                setActiveProject(project.id);
                showToast(`${project.name} is now active.`);
              }}
            >
              Make active
            </button>
          )}
          {project.shared ? <span className="pill">Shared</span> : null}
          {project.shared && !mayEdit && myLevel ? (
            <span className="pill">You {permissionLabel(myLevel).toLowerCase()}</span>
          ) : null}
          <span className="sub" style={{ alignSelf: 'center' }}>
            {summaryLine(project, chats.length, isCommercial)}
          </span>
        </div>

        {/* Standing instructions + name. */}
        <div className="card project-section" style={{ '--i': 0 } as CSSProperties}>
          <div className="card-row">
            <h3 className="grow">Standing instructions</h3>
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
          ) : (
            <p className="sub" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {project.instructions?.trim()
                ? project.instructions.trim()
                : 'No standing instructions yet.'}
            </p>
          )}
        </div>

        {/* Repositories and their files. */}
        <div className="card project-section" style={{ '--i': 1 } as CSSProperties}>
          <div className="card-row">
            <div className="grow">
              <h3>Repositories and files</h3>
              <div className="sub">
                The codebases this project works in. Their files ride into every chat here.
              </div>
            </div>
            {mayEdit ? (
              <button className="suggestion" onClick={() => setManageRepos(true)}>
                Manage
              </button>
            ) : null}
          </div>
          {project.repoIds.length ? (
            <div className="check-list" style={{ marginTop: 8 }}>
              {project.repoIds.map((id) => (
                <div key={id} className="multiselect-row" style={{ cursor: 'default' }}>
                  <span>
                    {repoLabel(id)}
                    {isGithubRepoId(id) ? <span className="hint"> · on GitHub</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint" style={{ marginTop: 6 }}>
              No repositories yet. Attach one so the agent has the project's files in context.
            </p>
          )}
        </div>

        {/* Chats in this project. */}
        <div className="card project-section" style={{ '--i': 2 } as CSSProperties}>
          <div className="card-row">
            <h3 className="grow">Chats</h3>
          </div>
          <div className="chat-list" style={{ marginTop: 4 }}>
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
            {chats.map((conv, i) => {
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
        </div>

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
            <button className="suggestion" onClick={() => setConfirmDelete(true)}>
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
    <div className="card project-section" style={{ '--i': index } as CSSProperties}>
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
    </div>
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
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}
