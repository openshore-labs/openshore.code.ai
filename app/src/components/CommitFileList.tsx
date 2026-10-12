// What a commit would record, on its approval card (D3, UX review 7): every file it
// would stage, each with a tick. A file that may hold a secret wears the
// "May hold a secret" pill with its reason and starts unticked, since a key
// that gets pushed cannot be taken back while a file skipped by mistake costs
// one tap. Ticking one says what that means. Every line is from
// lib/securityCopy.ts.
import type { CommitStage } from 'os-code/protocol';
import { SECRET_PILL, SECRET_REASON, flaggedLine, tickedWarning } from '../lib/securityCopy.js';

/** The files a commit card starts with ticked: every file but the flagged. */
export function defaultTicked(commit: CommitStage): Set<string> {
  return new Set(commit.files.filter((f) => !f.secret).map((f) => f.path));
}

export function CommitFileList({
  commit,
  ticked,
  onToggle,
}: {
  commit: CommitStage;
  ticked: ReadonlySet<string>;
  onToggle: (path: string) => void;
}) {
  const flagged = commit.files.filter((f) => f.secret).length;
  return (
    <div className="commit-files">
      {flagged ? <p className="commit-files-flagged">{flaggedLine(flagged)}</p> : null}
      <ul className="commit-files-list">
        {commit.files.map((file) => {
          const on = ticked.has(file.path);
          return (
            <li key={file.path} className={`commit-file${file.secret ? ' secret' : ''}`}>
              <label className="commit-file-row press-fb">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(file.path)}
                  aria-describedby={file.secret ? `why-${file.path}` : undefined}
                />
                <span className="commit-file-path">{file.path}</span>
                {file.secret ? <span className="commit-file-pill">{SECRET_PILL}</span> : null}
              </label>
              {file.secret ? (
                <p id={`why-${file.path}`} className="commit-file-why">
                  {SECRET_REASON[file.secret]}
                </p>
              ) : null}
              {file.secret && on ? (
                <p className="commit-file-warn">{tickedWarning(commit.pushesTo)}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
