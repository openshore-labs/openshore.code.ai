// The end-of-turn record: which files changed and by how much, each row a
// tap-through to the tool card that holds its diff. The glance Claude Code
// gives at the end of a job, so the person never has to scroll back to
// reconstruct what happened.
//
// With a checkpoint from the engine (v1 Phase 1) it is also the undo: "Undo"
// in the head puts back every file the task changed, each row can put back
// just its own file, and once everything is back the head offers "Redo". No
// "are you sure": undo is itself reversible, and it runs on the computer the
// chat runs on, so a paired phone undoes the same way the desktop does.
import type { ChangedFile } from '../state/types.js';
import { hapticCommit } from '../lib/haptics.js';

/** Plain words for what the task did to a file, when there are no line
 *  counts (a file a command wrote, or one the task created or removed). */
function statusWord(status: ChangedFile['status']): string {
  return status === 'added' ? 'new' : status === 'deleted' ? 'removed' : 'edited';
}

export function ChangedFilesCard({
  files,
  checkpointId,
  undone = [],
  restoring = false,
  error,
  ranCommands = false,
  onRestore,
}: {
  files: ChangedFile[];
  checkpointId?: string;
  undone?: string[];
  restoring?: boolean;
  error?: string;
  ranCommands?: boolean;
  onRestore?: (direction: 'undo' | 'redo', path?: string) => void;
}) {
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const counted = added > 0 || removed > 0;
  const canUndo = Boolean(checkpointId && onRestore);
  const back = new Set(undone);
  const allBack = canUndo && files.length > 0 && files.every((f) => back.has(f.path));
  const jump = (id?: string) => {
    if (!id) return;
    const el = document.getElementById(`tool-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('tool-card-flash');
    setTimeout(() => el?.classList.remove('tool-card-flash'), 900);
  };
  const restore = (direction: 'undo' | 'redo', path?: string) => {
    if (!onRestore || restoring) return;
    hapticCommit();
    onRestore(direction, path);
  };
  return (
    <div className={`changed-card${allBack ? ' undone' : ''}`}>
      <div className="changed-head">
        <span className="changed-title">
          {allBack ? 'Undone' : `Changed ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
        </span>
        <span className="changed-head-end">
          {counted && !allBack ? (
            <span className="changed-stats">
              <span className="diff-add">+{added}</span>{' '}
              <span className="diff-del">-{removed}</span>
            </span>
          ) : null}
          {canUndo ? (
            <button
              type="button"
              className="changed-undo press-fb"
              disabled={restoring}
              onClick={() => restore(allBack ? 'redo' : 'undo')}
            >
              {restoring ? 'Putting back' : allBack ? 'Redo' : 'Undo'}
            </button>
          ) : null}
        </span>
      </div>
      {allBack ? (
        <p className="changed-sub">
          {ranCommands
            ? 'Files are back. Anything a command installed stays installed.'
            : 'Files are back the way they were.'}
        </p>
      ) : null}
      {error ? <div className="msg-note changed-error">{error}</div> : null}
      <ul className="changed-list">
        {files.map((f) => {
          const isBack = back.has(f.path);
          return (
            <li key={f.path} className={`changed-item${isBack ? ' undone' : ''}`}>
              <button
                type="button"
                className="changed-row press-fb press-fb--row"
                onClick={() => jump(f.toolItemId)}
              >
                <span className="changed-path">{f.path}</span>
                <span className="changed-row-stats">
                  {f.added || f.removed ? (
                    <>
                      <span className="diff-add">+{f.added}</span>{' '}
                      <span className="diff-del">-{f.removed}</span>
                    </>
                  ) : (
                    <span className="changed-status">{statusWord(f.status)}</span>
                  )}
                </span>
              </button>
              {canUndo && files.length > 1 ? (
                <button
                  type="button"
                  className="changed-row-undo press-fb"
                  disabled={restoring}
                  aria-label={`${isBack ? 'Redo' : 'Undo'} ${f.path}`}
                  onClick={() => restore(isBack ? 'redo' : 'undo', f.path)}
                >
                  {isBack ? 'Redo' : 'Undo'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
