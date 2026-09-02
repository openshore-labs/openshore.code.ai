// The agent's task list, pinned above the composer while a job runs: the
// plan as a checklist, one item in progress at a time, a progress count. It
// folds itself to one line a beat after the last item completes (so the eye
// sees the final check land first), reopens on a tap, and disappears with
// the next task. The rows animate with the house tokens, never with layout.
import { useEffect, useState } from 'react';
import type { TodoRow } from '../state/types.js';

/** How long the finished list stays open before folding itself. */
const SELF_FOLD_MS = 600;

export function TodoCard({ todos }: { todos: TodoRow[] }) {
  const done = todos.filter((t) => t.status === 'completed').length;
  const allDone = todos.length > 0 && done === todos.length;
  const [open, setOpen] = useState(true);
  // Fold once everything is done; a new item reopens the list.
  useEffect(() => {
    if (!allDone) {
      setOpen(true);
      return;
    }
    const t = setTimeout(() => setOpen(false), SELF_FOLD_MS);
    return () => clearTimeout(t);
  }, [allDone]);
  return (
    <div className={`todo-card${allDone ? ' done' : ''}`}>
      <button
        type="button"
        className="todo-head press-fb press-fb--row"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="todo-title">{allDone ? 'All done' : 'Tasks'}</span>
        <span className="todo-progress">
          {done} of {todos.length}
        </span>
        <span className="todo-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${todos.length ? done / todos.length : 0})` }} />
        </span>
        <span className="todo-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      <div className={`todo-reveal${open ? ' open' : ''}`}>
        <div className="todo-reveal-inner">
          <ul className="todo-list">
            {todos.map((t, i) => (
              <li key={`${i}-${t.content}`} className={`todo-row ${t.status}`}>
                <span className="todo-mark" aria-hidden="true">
                  {t.status === 'completed' ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 12.5 9.5 18 20 6.5" />
                    </svg>
                  ) : t.status === 'in_progress' ? (
                    <i className="todo-pulse" />
                  ) : null}
                </span>
                <span className="todo-text">{t.content}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
