// A project's own room, in the shape of the Claude app's (maintainer,
// 2026-10-02): the name, a pair of pill doors (what the project works in,
// what rides into every chat), then this room's own components at the top
// (the pinned notes, and in later tiers the currents and the team roster),
// then the project's chats as one flat list, and a floating New chat pill. What
// the room does to the project itself (make active, rename, share, delete)
// sits behind the "..." in the bar. Reached by tapping a project on the
// Projects list.
//
// Honest scope: projects are device-local today, so the team-access controls
// configure who WILL have access once a project is shared with the team (a
// server-backed capability on the roadmap). They never lock the local owner
// out of their own project. Same posture as the Account/Org model.
import { featureOn } from '../lib/focus.js';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp, stackAdmin, whereContextOf } from '../state/store.js';
import type { Conversation, Project, ProjectAccess, ProjectPermission } from '../state/types.js';
import { BackBar } from '../components/BackBar.js';
import { ProjectCurrents } from '../components/ProjectCurrents.js';
import { ProjectVaultPins } from '../components/ProjectVaultPins.js';
import { RunsOnPill, RunsOnSheet } from '../components/ProjectRunsOn.js';
import { projectWhere } from '../lib/runsOn.js';
import { Sheet } from '../components/Sheet.js';
import { SheetHead } from '../components/SheetHead.js';
import { useConnectedRepos } from '../hooks/useConnectedRepos.js';
import { PLATFORM_NAME, isGithubRepoId, isRemoteRepoId, repoLabel } from '../lib/chatRepos.js';
import { openInAppBrowser } from '../lib/platform.js';
import {
  PERMISSION_LADDER,
  canEdit,
  canWrite,
  permissionLabel,
  projectPermissionFor,
} from '../lib/projectAccess.js';
import { ReachDot, chatReach, relativeTime } from './ChatsScreen.js';
import { useTitleHero } from '../lib/heroTitle.js';
import { durationMs } from '../lib/motion.js';
import { Icon } from '../components/Icon.js';
import { MoreGlyph, PlusGlyph } from '../components/SheetGlyphs.js';
import { useCompact } from '../hooks/useCompact.js';
import { RoomGlyph } from '../components/Sidebar.js';

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
  // Teams are v4 (docs/release-tiers.md): a Personal build shows no roster,
  // no sharing, and no team counts, whatever account an earlier build saved.
  const teams = featureOn('teams');
  const isCommercial = teams && account?.type === 'commercial';
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

  // The sheets this room opens: the "..." menu, the name, the standing
  // instructions (drafted, saved on demand), the repositories, and the
  // delete confirm.
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | undefined>();
  const [instructions, setInstructions] = useState<string | undefined>();
  const [showRepos, setShowRepos] = useState(false);
  const [manageRepos, setManageRepos] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [runsOnOpen, setRunsOnOpen] = useState(false);

  // The project name flies up from the tapped row into this title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useTitleHero(titleRef);
  // On the desktop New chat sits in the bar, where Projects puts New project
  // (D11 carried one room deeper); the phone keeps its dock.
  const compact = useCompact();

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

  const repoCount = project.repoIds.length;
  const hasInstructions = Boolean(project.instructions?.trim());
  // Save earns its emphasis only once the draft actually differs, so an
  // untouched editor never dangles a live-looking button.
  const instructionsDirty =
    instructions !== undefined && instructions !== (project.instructions ?? '');

  const saveInstructions = async () => {
    if (instructions === undefined) return;
    await updateProject(project.id, { instructions });
    setInstructions(undefined);
    showToast('Instructions saved.');
  };
  const saveName = async () => {
    if (renaming === undefined) return;
    await updateProject(project.id, { name: renaming.trim() || 'Untitled project' });
    setRenaming(undefined);
  };
  // A menu row closes the menu first, so only one sheet is ever up.
  const fromMenu = (run: () => void) => () => {
    setMenu(false);
    run();
  };

  const more = (
    <button
      type="button"
      className="icon-btn press-fb"
      aria-label="Project options"
      title="Project options"
      onClick={() => setMenu(true)}
    >
      <MoreGlyph />
    </button>
  );

  // The desktop's New chat: the same bar button as Projects' New project,
  // beside the options.
  const barNew =
    mayWrite && !compact ? (
      <button
        type="button"
        className="btn primary sm projects-bar-new"
        onClick={() => startProjectChat(project.id)}
      >
        <PlusGlyph size={16} />
        New chat
      </button>
    ) : null;

  return (
    <div className="screen project-room-screen">
      <BackBar
        title={project.name}
        action={
          <>
            {barNew}
            {more}
          </>
        }
        titleHiddenUntil={titleRef}
      />
      <div className="screen-inner project-room">
        <h1 ref={titleRef} className="project-hero-title project-room-title">
          {project.name}
        </h1>
        {isActive || (teams && project.shared) || (project.shared && !mayEdit && myLevel) ? (
          <div className="project-room-tags">
            {isActive ? <span className="pill ink">Active</span> : null}
            {teams && project.shared ? <span className="pill muted">Shared</span> : null}
            {project.shared && !mayEdit && myLevel ? (
              <span className="pill muted">You {permissionLabel(myLevel).toLowerCase()}</span>
            ) : null}
          </div>
        ) : null}

        {/* The two doors under the title, the Claude app's pair: what the
            project works in, and what rides into every chat. */}
        <div className="project-pills project-section" style={{ '--i': 0 } as CSSProperties}>
          <button
            type="button"
            className="project-pill press-fb"
            onClick={() => (repoCount || !mayEdit ? setShowRepos(true) : setManageRepos(true))}
          >
            <RoomGlyph name="repos" size={18} />
            <span>
              {repoCount
                ? `${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'}`
                : 'Add repositories'}
            </span>
          </button>
          <button
            type="button"
            className="project-pill press-fb"
            disabled={!mayEdit && !hasInstructions}
            onClick={() => setInstructions(project.instructions ?? '')}
          >
            <InstructionsGlyph />
            <span>{hasInstructions ? 'Instructions' : 'Add instructions'}</span>
          </button>
          {/* Where its chats run (2026-10-12): a choice of this
              device's, so a reader of a shared project still cannot start
              one there. */}
          <RunsOnPill project={project} disabled={!mayWrite} onOpen={() => setRunsOnOpen(true)} />
        </div>

        {/* This room's own components, at the top above the chats. Currents
            chosen for this project: the workflow's cheap decision method
            (Harness) and its agent modality (Agentic), per project so
            different projects run different currents at once. Editors only. */}
        {mayEdit && featureOn('currents') ? (
          <ProjectCurrents projectId={project.id} index={1} />
        ) : null}

        {/* Vault notes pinned to this project's context (Vault M5): placed by
            the person, so they ride every chat here. Device local. Editors
            only, on the currents' pattern. */}
        {mayEdit ? <ProjectVaultPins projectId={project.id} index={3} /> : null}

        {/* Enterprise: who on the team can read, write, or edit. */}
        {isCommercial ? (
          <TeamAccess
            index={4}
            project={project}
            canManage={canManageAccess}
            myLevel={myLevel}
            selfEmail={account?.selfEmail}
            onChange={(access) => void setProjectAccess(project.id, access)}
          />
        ) : null}

        {/* The work: this project's chats, newest first. */}
        <section className="project-chats project-section" style={{ '--i': 5 } as CSSProperties}>
          <h2 className="project-chats-head">Chats</h2>
          {chats.length ? (
            <div className="project-chat-list">
              {chats.map((conv, i) => (
                <button
                  key={conv.id}
                  type="button"
                  className={`project-chat-row press-fb press-fb--row${conv.id === activeId ? ' active' : ''}`}
                  style={{ '--i': Math.min(i, 8) } as CSSProperties}
                  onClick={() => openConversation(conv.id)}
                >
                  <span className="project-chat-icon" aria-hidden="true">
                    <ChatGlyph />
                  </span>
                  <span className="project-chat-text">
                    <span className="project-chat-title">
                      {conv.thread.busy ? (
                        <span className="chat-row-live" aria-label="working" />
                      ) : null}
                      {conv.title}
                    </span>
                    {/* Teal stayed on the device, amber reached the cloud (tenet
                        4): a trust signal, so it stays (UX review, 2026-10-02). */}
                    <span className="project-chat-sub">
                      <ReachDot reach={chatReach(conv)} />
                      {relativeTime(conv.updatedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="project-chats-empty">
              {mayWrite
                ? 'No chats yet. Start one and it stays with this project.'
                : 'No chats yet. You have read access, so you can see this project but not start chats in it.'}
            </p>
          )}
        </section>
      </div>

      {mayWrite && compact ? (
        <div className="project-room-dock">
          <button
            type="button"
            className="projects-dock-new press-fb"
            onClick={() => startProjectChat(project.id)}
          >
            <Icon size={18}>
              <path d="M12 5v14M5 12h14" />
            </Icon>
            New chat
          </button>
        </div>
      ) : null}

      {/* The "..." menu: what the room does to the project itself. */}
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <SheetHead title={project.name} onClose={() => setMenu(false)} />
        <div className="project-options">
          {!isActive ? (
            <button
              type="button"
              className="project-options-row press-fb press-fb--row"
              onClick={fromMenu(() => {
                setActiveProject(project.id);
                showToast(`${project.name} is your active project.`);
              })}
            >
              Make active
              <span className="project-options-sub">New chats are saved here.</span>
            </button>
          ) : null}
          {mayEdit ? (
            <button
              type="button"
              className="project-options-row press-fb press-fb--row"
              onClick={fromMenu(() => setRenaming(project.name))}
            >
              Rename
            </button>
          ) : null}
          {repoCount ? (
            <button
              type="button"
              className="project-options-row press-fb press-fb--row"
              onClick={fromMenu(() => openProjectMemory(project.id))}
            >
              What it has learned
            </button>
          ) : null}
          {canShare ? (
            <button
              type="button"
              className="project-options-row press-fb press-fb--row"
              onClick={fromMenu(() => void shareProject(project.id))}
            >
              Share with team
            </button>
          ) : null}
          {teams && project.shared && mayEdit ? (
            <button
              type="button"
              className="project-options-row press-fb press-fb--row"
              onClick={fromMenu(() => void unshareProject(project.id))}
            >
              Stop sharing
            </button>
          ) : null}
          {mayEdit ? (
            <button
              type="button"
              className="project-options-row project-delete press-fb press-fb--row"
              onClick={fromMenu(() => setConfirmDelete(true))}
            >
              Delete project
            </button>
          ) : null}
        </div>
      </Sheet>

      {/* Standing instructions: they ride into every chat here. */}
      <Sheet open={instructions !== undefined} onClose={() => setInstructions(undefined)}>
        <SheetHead title="Instructions" onClose={() => setInstructions(undefined)} />
        {mayEdit ? (
          <>
            <div className="field">
              <label htmlFor="project-instructions">
                Every chat in this project starts with these
              </label>
              <textarea
                id="project-instructions"
                rows={7}
                placeholder="Context and rules every chat in this project should follow."
                value={instructions ?? ''}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
            <div className="sheet-actions">
              <button
                className={instructionsDirty ? 'btn primary' : 'btn quiet'}
                disabled={!instructionsDirty}
                onClick={() => void saveInstructions()}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <p className="project-instructions">{project.instructions?.trim()}</p>
        )}
      </Sheet>

      <Sheet open={renaming !== undefined} onClose={() => setRenaming(undefined)}>
        <SheetHead title="Rename project" onClose={() => setRenaming(undefined)} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <div className="field">
            <label htmlFor="project-name">Name</label>
            <input
              id="project-name"
              autoFocus
              maxLength={80}
              value={renaming ?? ''}
              onChange={(e) => setRenaming(e.target.value)}
            />
          </div>
          <div className="sheet-actions">
            <button type="submit" className="btn primary" disabled={!renaming?.trim()}>
              Save
            </button>
          </div>
        </form>
      </Sheet>

      {/* What this project works in: its repositories, which every new chat
          here starts with. */}
      <Sheet open={showRepos} onClose={() => setShowRepos(false)}>
        <SheetHead title="Repositories" onClose={() => setShowRepos(false)} />
        {repoCount ? (
          <div className="repo-chips">
            {project.repoIds.map((id) => (
              <span key={id} className={`repo-chip${isRemoteRepoId(id) ? '' : ' local'}`}>
                {isGithubRepoId(id) ? (
                  <GithubGlyph />
                ) : isRemoteRepoId(id) ? (
                  <BranchGlyph />
                ) : (
                  <FolderGlyph />
                )}
                <span className="repo-chip-name">{repoLabel(id)}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="hint">No repositories yet.</p>
        )}
        {repoCount ? (
          <button
            type="button"
            className="project-memory-link press-fb press-fb--row"
            onClick={() => {
              setShowRepos(false);
              openProjectMemory(project.id);
            }}
          >
            <MemoryGlyph />
            <span className="grow">What it has learned</span>
            <span className="disclosure-chevron" aria-hidden="true" />
          </button>
        ) : null}
        {mayEdit ? (
          <div className="sheet-actions">
            <button
              className="btn primary"
              onClick={() => {
                setShowRepos(false);
                setManageRepos(true);
              }}
            >
              Choose repositories
            </button>
          </div>
        ) : null}
      </Sheet>

      {/* Choose repositories: the same combined list the chat header offers. */}
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

      <RunsOnSheet project={project} open={runsOnOpen} onClose={() => setRunsOnOpen(false)} />

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} variant="confirm">
        <h3>Delete this project?</h3>
        <p>
          {project.shared
            ? 'This removes the project for your whole team. Each person keeps their own chats; they just stop belonging to a project. This cannot be undone.'
            : 'Its chats stay in Chats, outside any project. This cannot be undone.'}
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
            <label htmlFor="project-add-teammate">Add a teammate by email</label>
            <input
              id="project-add-teammate"
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
            className="btn primary block"
            style={{ marginTop: 10 }}
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
              style={{ cursor: 'default', '--i': Math.min(i, 8) } as CSSProperties}
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

/** The Choose repositories sheet: toggle the project's attached repos from the
 *  connected computer's workspaces and the GitHub, GitLab and Bitbucket repos. */
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
  // The project's own machine (lib/runsOn.ts): its folders are the ones its
  // chats can open.
  const settings = useApp((s) => s.settings);
  const repos = useConnectedRepos(open, projectWhere(project, whereContextOf(settings)));
  const repoOptions = [...repos.workspaces, ...repos.remote];
  const [draft, setDraft] = useState<string[]>(project.repoIds);
  // Re-seed the draft each time the sheet opens on a project.
  const [seededFor, setSeededFor] = useState<string | undefined>();
  if (open && seededFor !== project.id) {
    setSeededFor(project.id);
    setDraft(project.repoIds);
  }
  if (!open && seededFor !== undefined) setSeededFor(undefined);
  const nothingToChoose = !repos.loading && repoOptions.length === 0;

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHead title="Choose repositories" onClose={onClose} />
      <p className="sheet-sub">
        The repositories this project works in. Every new chat here starts with them attached.
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
                  {r.kind !== 'workspace' && r.detail ? (
                    <span className="hint">
                      {' '}
                      · {r.detail} on {PLATFORM_NAME[r.kind]}
                    </span>
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
            : (repos.error ??
              'Connect your computer, GitHub, GitLab, or Bitbucket to attach repositories.')}
        </p>
      )}
      {repos.access ? (
        <p className="hint">
          {repos.access.text}{' '}
          <button
            type="button"
            className="linklike"
            onClick={() =>
              repos.access!.url && !repos.access!.reconnect
                ? openInAppBrowser(repos.access!.url, repos.refresh)
                : onOpenRepos()
            }
          >
            {repos.access.action}
          </button>
          .
        </p>
      ) : null}
      <div className="sheet-actions">
        {nothingToChoose ? (
          <button className="btn primary" onClick={onOpenRepos}>
            Open Repositories
          </button>
        ) : (
          <>
            <button className="btn primary" onClick={() => void onSave(draft)}>
              Save
            </button>
            <button className="btn quiet" onClick={onOpenRepos}>
              Open Repositories
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** A chat, drawn as a speech bubble, the mark before each chat row. */
function ChatGlyph() {
  return (
    <Icon size={18}>
      <path d="M12 4.5c4.4 0 8 2.9 8 6.6s-3.6 6.6-8 6.6c-.9 0-1.8-.1-2.6-.3L5 19.5l1.2-3.3C4.8 15 4 13.2 4 11.1 4 7.4 7.6 4.5 12 4.5Z" />
    </Icon>
  );
}

/** Three lines of text: the instructions every chat here starts with. */
function InstructionsGlyph() {
  return (
    <Icon size={18}>
      <path d="M5 7h14M5 12h14M5 17h9" />
    </Icon>
  );
}

function BranchGlyph() {
  return (
    <Icon size={14}>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M7 8.2v7.6M17 11.2c0 3-3.5 3.3-6 3.9-1.8.4-3 1-4 2.3" />
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
