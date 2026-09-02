// The end-of-turn record: which files changed and by how much, each row a
// tap-through to the tool card that holds its diff. The glance Claude Code
// gives at the end of a job, so the person never has to scroll back to
// reconstruct what happened.
import type { ChangedFile } from '../state/types.js';
import { hapticTick } from '../lib/haptics.js';

export function ChangedFilesCard({ files }: { files: ChangedFile[] }) {
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const jump = (id?: string) => {
    if (!id) return;
    hapticTick();
    const el = document.getElementById(`tool-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('tool-card-flash');
    setTimeout(() => el?.classList.remove('tool-card-flash'), 900);
  };
  return (
    <div className="changed-card">
      <div className="changed-head">
        <span className="changed-title">
          Changed {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="changed-stats">
          <span className="diff-add">+{added}</span> <span className="diff-del">-{removed}</span>
        </span>
      </div>
      <ul className="changed-list">
        {files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className="changed-row press-fb press-fb--row"
              onClick={() => jump(f.toolItemId)}
            >
              <span className="changed-path">{f.path}</span>
              <span className="changed-row-stats">
                <span className="diff-add">+{f.added}</span>{' '}
                <span className="diff-del">-{f.removed}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
