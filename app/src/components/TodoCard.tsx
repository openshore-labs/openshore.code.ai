// The agent's task list, pinned above the composer while a job runs: the
// plan as a checklist, one item in progress at a time, a progress count. It
// folds to one line once everything is done, and disappears with the next
// task. The rows animate with the house tokens, never with layout.
import { useState } from 'react';
import type { TodoRow } from '../state/types.js';

export function TodoCard({ todos }: { todos: TodoRow[] }) {
  const done = todos.filter((t) => t.status === 'completed').length;
  const allDone = done === todos.length;
  const [open, setOpen] = useState(true);
  const expanded = open && !(allDone && !open);
  return (
    <div className={`todo-card${allDone ? ' done' : ''}`}>
      <button
        type="button"
        className="todo-head press-fb press-fb--row"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
      >
        <span className="todo-title">{allDone ? 'All done' : 'Tasks'}</span>
        <span className="todo-progress">
          {done} of {todos.length}
        </span>
        <span className="todo-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${todos.length ? done / todos.length : 0})` }} />
        </span>
        <span className="todo-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
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
      ) : null}
    </div>
  );
}
