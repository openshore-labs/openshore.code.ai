// The repo picker in the chat header, where the model name used to be: a
// quiet pill that opens a repositories sheet in the Claude app's shape
// (founder's reference, 2026-09-03): a title with the count, a "Selected"
// card of what is checked, a "Repositories" card of the rest, owner over
// name with a check on the right, and search pinned at the foot. The paired
// computer's workspaces and every connected platform's repositories (GitHub,
// GitLab, Bitbucket), any number checked. A foot line says plainly where the
// agent works.
//
// Two things make a platform repository usable, not just listed. When GitHub
// shows fewer repositories than the account has (the GitHub App was given a
// few on an organization), a line under the list says so and opens the page
// on GitHub where more are picked. And a selected platform repository that is
// not on the computer yet can be cloned there in one tap (with the connected
// token, so a private one works), which puts it first: where the agent works.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './Sheet.js';
import { CloseGlyph } from './SheetGlyphs.js';
import { useConnectedRepos } from '../hooks/useConnectedRepos.js';
import { useApp } from '../state/store.js';
import { openInAppBrowser } from '../lib/platform.js';
import { cloneOnComputer } from '../lib/repoClone.js';
import { plainError } from '../lib/plainError.js';
import {
  PLATFORM_NAME,
  cloneUrlFor,
  firstWorkspace,
  localCloneFor,
  parseRemoteRepoId,
  repoLabel,
  sameRepo,
  summarizeRepos,
  toggleRepo,
  withClone,
  type RepoOption,
} from '../lib/chatRepos.js';
import { Icon } from './Icon.js';

function RepoGlyph() {
  return (
    <Icon size={13}>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M7 8.2v7.6M17 11.2c0 3-3.5 3.3-6 3.9-1.8.4-3 1-4 2.3" />
    </Icon>
  );
}

function SearchGlyph() {
  return (
    <Icon size={18}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
    </Icon>
  );
}

function CheckGlyph() {
  return (
    <Icon size={22}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

/** A row's second line: the owner for GitHub (the Claude app's shape), the
 *  owner and the platform for GitLab and Bitbucket, where it lives for a clone. */
function subtitle(r: RepoOption): string {
  if (r.kind === 'workspace') return 'On your computer';
  if (r.kind === 'github') return r.detail ?? 'GitHub';
  return r.detail ? `${r.detail} · ${PLATFORM_NAME[r.kind]}` : PLATFORM_NAME[r.kind];
}

export function RepoPicker({
  selected,
  onChange,
  branch,
  dirty,
  onOpenRepos,
  workingIn,
  onNewChat,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** The live session's branch, shown after the summary. */
  branch?: string;
  dirty?: boolean;
  /** Where to send someone with nothing connected yet. */
  onOpenRepos: () => void;
  /** The folder a started session on the computer works in. The engine cannot
   *  move a session, so a different first folder means a new chat. */
  workingIn?: string;
  /** Start a new chat with these repositories (offered when `workingIn` is
   *  not the first folder picked). */
  onNewChat?: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const repos = useConnectedRepos(open);
  const daemon = useApp((s) => s.settings.daemon);
  const preferRemoteHub = useApp((s) => s.settings.preferRemoteHub);
  const showToast = useApp((s) => s.showToast);
  // The platform repo being cloned right now, and the clones made from this
  // sheet (platform id to folder) before the workspace list catches up.
  const [cloning, setCloning] = useState<string | undefined>();
  const [opened, setOpened] = useState<Record<string, string>>({});
  // A clone can take minutes; it lands on the selection as it is then, not as
  // it was at the tap, so a change made meanwhile is kept.
  const latest = useRef(selected);
  latest.current = selected;

  const all = [...repos.workspaces, ...repos.remote];
  const known = new Map(all.map((r) => [r.id, r]));
  // A selected id no source lists any more (a clone gone, a token removed)
  // stays visible in Selected so it can be unchecked.
  const selectedRows: RepoOption[] = selected.map((id) => {
    const hit = known.get(id);
    if (hit) return hit;
    const parsed = parseRemoteRepoId(id);
    return parsed
      ? {
          id,
          kind: parsed.platform,
          name: repoLabel(id),
          detail: parsed.fullName.slice(0, parsed.fullName.lastIndexOf('/')),
        }
      : { id, kind: 'workspace', name: repoLabel(id), detail: id };
  });
  const q = query.trim().toLowerCase();
  const match = (r: RepoOption) =>
    !q || r.name.toLowerCase().includes(q) || (r.detail ?? '').toLowerCase().includes(q);
  const shownSelected = selectedRows.filter(match);
  const shownRest = all.filter((r) => !selected.includes(r.id)).filter(match);
  const nothingConnected = !repos.hasComputer && !repos.hasPlatform;

  // Selected platform repos the agent cannot work in yet: no selected folder
  // on the computer holds them.
  const onComputer = (remoteId: string) =>
    selected.some((id) => opened[remoteId] === id || sameRepo(known.get(id)?.remoteId, remoteId));
  const needsClone = repos.hasComputer
    ? selectedRows
        .flatMap((r) => {
          const parsed = parseRemoteRepoId(r.id);
          return parsed && !onComputer(r.id) ? [{ r, platform: parsed.platform }] : [];
        })
        .slice(0, 3)
    : [];

  // A started session stays in its folder; picking another first folder is
  // honest only as a new chat.
  const firstPicked = firstWorkspace(selected);
  const moved = Boolean(workingIn && firstPicked && firstPicked !== workingIn);

  const close = () => setOpen(false);
  const toggle = (id: string) => {
    onChange(toggleRepo(selected, id));
  };

  const bringHome = async (r: RepoOption) => {
    const existing = localCloneFor(r.id, repos.workspaces);
    if (existing) {
      onChange(withClone(latest.current, r.id, existing.id));
      return;
    }
    const url = cloneUrlFor(r.id);
    if (!url) return;
    setCloning(r.id);
    try {
      const { cwd } = await cloneOnComputer(url, { daemon, preferRemoteHub });
      setOpened((m) => ({ ...m, [r.id]: cwd }));
      onChange(withClone(latest.current, r.id, cwd));
      showToast(`${r.name} is ready on your computer.`);
      repos.refresh();
    } catch (err) {
      showToast(plainError(err));
    } finally {
      setCloning(undefined);
    }
  };

  const row = (r: RepoOption, checked: boolean) => (
    <button
      key={r.id}
      type="button"
      className="ms-row repo-sheet-row press-fb press-fb--row"
      role="checkbox"
      aria-checked={checked}
      onClick={() => toggle(r.id)}
    >
      <span className="ms-row-text">
        <span className="ms-row-sub">{subtitle(r)}</span>
        <span className="ms-row-main">
          {r.name}
          {r.private ? <span className="repo-row-lock">private</span> : null}
        </span>
      </span>
      {checked ? (
        <span className="repo-check">
          <CheckGlyph />
        </span>
      ) : null}
    </button>
  );

  // The pill lives in the top bar, whose backdrop-filter would make it the
  // containing block for a fixed scrim; the sheet is portaled to the body so
  // it covers the viewport like every other sheet.
  const sheet = (
    <Sheet open={open} onClose={close} className="repo-sheet">
      <div className="mode-head">
        <button className="mode-close press-fb" aria-label="Close" onClick={close}>
          <CloseGlyph />
        </button>
        <h2>Repositories{selected.length ? ` (${selected.length})` : ''}</h2>
      </div>
      <div className="repo-sheet-body">
        {nothingConnected && selected.length === 0 ? (
          <div className="ms-empty repo-sheet-empty">
            <p>No repositories connected yet.</p>
            <button
              type="button"
              className="btn primary press-fb"
              onClick={() => {
                close();
                onOpenRepos();
              }}
            >
              Connect a repository
            </button>
          </div>
        ) : (
          <>
            {shownSelected.length ? (
              <>
                <div className="ms-heading">Selected</div>
                <div className="ms-group">{shownSelected.map((r) => row(r, true))}</div>
              </>
            ) : null}
            {needsClone.map(({ r, platform }) => {
              const busy = cloning === r.id;
              const existing = localCloneFor(r.id, repos.workspaces);
              return (
                <div className="repo-open" key={`open-${r.id}`}>
                  <p className="hint">
                    {existing
                      ? `${r.name} is on your computer too. Work in that copy so the agent can edit it.`
                      : `${r.name} is on ${PLATFORM_NAME[platform]} only. Clone it so the agent can work in it.`}
                  </p>
                  <button
                    type="button"
                    className="btn ghost press-fb"
                    disabled={Boolean(cloning)}
                    onClick={() => void bringHome(r)}
                  >
                    {busy ? 'Cloning…' : existing ? 'Use that copy' : 'Clone to your computer'}
                  </button>
                </div>
              );
            })}
            {moved && firstPicked ? (
              <div className="repo-open">
                <p className="hint">
                  {`This chat works in ${repoLabel(workingIn!)}, the folder it started in. Start a new chat to work in ${repoLabel(firstPicked)}.`}
                </p>
                {onNewChat ? (
                  <button
                    type="button"
                    className="btn ghost press-fb"
                    onClick={() => {
                      close();
                      onNewChat(latest.current);
                    }}
                  >
                    New chat there
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="ms-heading">Repositories</div>
            {repos.error && shownRest.length ? (
              <p className="hint repo-sheet-note">{repos.error}</p>
            ) : null}
            <div className="ms-group">
              {shownRest.length ? (
                shownRest.map((r) => row(r, false))
              ) : (
                <p className="hint repo-sheet-hint">
                  {repos.loading
                    ? 'Loading your repositories.'
                    : repos.error
                      ? repos.error
                      : q
                        ? 'No match.'
                        : all.length
                          ? 'Everything is selected.'
                          : 'No repositories on this account yet.'}
                </p>
              )}
            </div>
            {repos.access ? (
              <p className="hint repo-sheet-note">
                {repos.access.text}{' '}
                <button
                  type="button"
                  className="linklike"
                  onClick={() => openInAppBrowser(repos.access!.url, repos.refresh)}
                >
                  {repos.access.action}
                </button>
                {'. Back here, '}
                <button type="button" className="linklike" onClick={repos.refresh}>
                  refresh the list
                </button>
                .
              </p>
            ) : null}
            <p className="hint repo-sheet-foot">
              {workingIn
                ? `This chat works in ${repoLabel(workingIn)}. Every repository here is context for the chat.`
                : 'The agent works in the first repository on your computer. Every repository here is context for the chat.'}
            </p>
          </>
        )}
      </div>
      <label className="repo-sheet-search">
        <SearchGlyph />
        <input
          type="search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search repositories"
        />
      </label>
    </Sheet>
  );

  return (
    <>
      <button
        type="button"
        className="repo-picker-btn press-fb"
        onClick={() => {
          setOpen(true);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Repositories in this chat"
      >
        <RepoGlyph />
        <span className="repo-picker-summary">{summarizeRepos(selected)}</span>
        {branch ? <span className="repo-picker-branch">{branch}</span> : null}
        {dirty ? (
          <span className="repo-dirty" aria-label="uncommitted changes">
            {'●'}
          </span>
        ) : null}
        <span className="repo-picker-caret" aria-hidden="true">
          {'▾'}
        </span>
      </button>
      {createPortal(sheet, document.body)}
    </>
  );
}
