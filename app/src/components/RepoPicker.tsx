// The repo dropdown in the chat header, where the model name used to be: a
// multi-select of the repositories connected to the account, the way Claude
// Code's repo picker works. The paired computer's workspaces and the GitHub
// account's repositories, searchable, any number checked. The summary shows
// the first name and a count; a live desktop session's branch rides along.
// Advisory copy at the foot says plainly where the agent works.
import { useRef, useState } from 'react';
import { useDismissable } from '../lib/useDismissable.js';
import { useExitPresence } from '../hooks/useExitPresence.js';
import { useConnectedRepos } from '../hooks/useConnectedRepos.js';
import { hapticTick } from '../lib/haptics.js';
import { summarizeRepos, toggleRepo, type RepoOption } from '../lib/chatRepos.js';

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
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(ref, open, () => setOpen(false));
  const panel = useExitPresence(open, 200);
  const repos = useConnectedRepos(open);

  const q = query.trim().toLowerCase();
  const match = (r: RepoOption) =>
    !q || r.name.toLowerCase().includes(q) || (r.detail ?? '').toLowerCase().includes(q);
  const workspaces = repos.workspaces.filter(match);
  const github = repos.github.filter(match);
  // A selected id that no source lists any more (a clone gone, a token
  // removed) stays visible so it can be unchecked.
  const known = new Set([...repos.workspaces, ...repos.github].map((r) => r.id));
  const orphans = selected.filter((id) => !known.has(id));
  const nothingConnected = !repos.hasComputer && !repos.hasGithub;

  const toggle = (id: string) => {
    hapticTick();
    onChange(toggleRepo(selected, id));
  };

  const row = (r: RepoOption) => (
    <label key={r.id} className="multiselect-row repo-row">
      <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
      <span className="repo-row-text">
        <span className="repo-row-name">
          {r.name}
          {r.private ? <span className="repo-row-lock">private</span> : null}
        </span>
        {r.detail ? <span className="repo-row-detail">{r.detail}</span> : null}
      </span>
    </label>
  );

  return (
    <div className="repo-picker" ref={ref}>
      <button
        type="button"
        className="repo-picker-btn press-fb"
        onClick={() => {
          hapticTick();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
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
      {panel.mounted ? (
        <div className={`repo-panel${panel.closing ? ' closing' : ''}`} role="listbox">
          {nothingConnected ? (
            <div className="repo-panel-empty">
              <p>No repositories connected yet.</p>
              <button
                type="button"
                className="btn primary press-fb"
                onClick={() => {
                  setOpen(false);
                  onOpenRepos();
                }}
              >
                Connect a repository
              </button>
            </div>
          ) : (
            <>
              <input
                className="multiselect-search"
                placeholder="Search repositories"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="multiselect-list repo-list">
                {workspaces.length ? (
                  <>
                    <div className="repo-group">On your computer</div>
                    {workspaces.map(row)}
                  </>
                ) : null}
                {repos.hasGithub ? (
                  <>
                    <div className="repo-group">GitHub</div>
                    {github.length ? (
                      github.map(row)
                    ) : (
                      <p className="hint repo-hint">
                        {repos.loading
                          ? 'Loading your repositories.'
                          : repos.error
                            ? repos.error
                            : q
                              ? 'No match.'
                              : 'No repositories on this token.'}
                      </p>
                    )}
                  </>
                ) : null}
                {orphans.length ? (
                  <>
                    <div className="repo-group">Selected earlier</div>
                    {orphans.map((id) =>
                      row({ id, kind: 'workspace', name: id.split('/').pop() || id, detail: id }),
                    )}
                  </>
                ) : null}
              </div>
              <p className="hint repo-foot">
                The agent works in the first repo on your computer. Every repo here is context for
                the chat.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
