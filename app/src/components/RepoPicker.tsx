// The repo picker in the chat header, where the model name used to be: a
// quiet pill that opens a repositories sheet in the Claude app's shape
// (founder's reference, 2026-09-03): a title with the count, a "Selected"
// card of what is checked, a "Repositories" card of the rest, owner over
// name with a check on the right, and search pinned at the foot. The paired
// computer's workspaces and the GitHub account's repositories, any number
// checked. A foot line says plainly where the agent works.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './Sheet.js';
import { useConnectedRepos } from '../hooks/useConnectedRepos.js';
import { hapticTick } from '../lib/haptics.js';
import { repoLabel, summarizeRepos, toggleRepo, type RepoOption } from '../lib/chatRepos.js';

function RepoGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M7 8.2v7.6M17 11.2c0 3-3.5 3.3-6 3.9-1.8.4-3 1-4 2.3" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** A row's second line: the owner for GitHub, where it lives for a clone. */
function subtitle(r: RepoOption): string {
  return r.kind === 'github' ? (r.detail ?? 'GitHub') : 'On your computer';
}

export function RepoPicker({
  selected,
  onChange,
  branch,
  dirty,
  onOpenRepos,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** The live session's branch, shown after the summary. */
  branch?: string;
  dirty?: boolean;
  /** Where to send someone with nothing connected yet. */
  onOpenRepos: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const repos = useConnectedRepos(open);

  const all = [...repos.workspaces, ...repos.github];
  const known = new Map(all.map((r) => [r.id, r]));
  // A selected id no source lists any more (a clone gone, a token removed)
  // stays visible in Selected so it can be unchecked.
  const selectedRows: RepoOption[] = selected.map(
    (id) =>
      known.get(id) ?? {
        id,
        kind: id.startsWith('github:') ? 'github' : 'workspace',
        name: repoLabel(id),
        detail: id.startsWith('github:') ? id.slice(7).split('/')[0] : id,
      },
  );
  const q = query.trim().toLowerCase();
  const match = (r: RepoOption) =>
    !q || r.name.toLowerCase().includes(q) || (r.detail ?? '').toLowerCase().includes(q);
  const shownSelected = selectedRows.filter(match);
  const shownRest = all.filter((r) => !selected.includes(r.id)).filter(match);
  const nothingConnected = !repos.hasComputer && !repos.hasGithub;

  const close = () => setOpen(false);
  const toggle = (id: string) => {
    hapticTick();
    onChange(toggleRepo(selected, id));
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
          {'×'}
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
            <div className="ms-heading">Repositories</div>
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
            <p className="hint repo-sheet-foot">
              The agent works in the first repo on your computer. Every repo here is context for the
              chat.
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
          hapticTick();
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
