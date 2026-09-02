// The model's reasoning, folded to one quiet line ("Thought for 12s") the
// way Claude Code shows it, expandable to the full text in muted italic.
// Never load-bearing: the answer stands on its own without it.
import { useState } from 'react';
import { Markdown } from './Markdown.js';

export function ThinkingBlock({
  text,
  streaming,
  startedAt,
  endedAt,
}: {
  text: string;
  streaming: boolean;
  startedAt: number;
  endedAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const seconds = Math.max(1, Math.round(((endedAt ?? Date.now()) - startedAt) / 1000));
  return (
    <div className={`thinking${open ? ' open' : ''}`}>
      <button
        type="button"
        className="thinking-head press-fb press-fb--row"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`thinking-glyph${streaming ? ' live' : ''}`} aria-hidden="true" />
        <span className="thinking-label">{streaming ? 'Thinking' : `Thought for ${seconds}s`}</span>
        <span className="thinking-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="thinking-body">
          <Markdown text={text} streaming={streaming} />
        </div>
      ) : null}
    </div>
  );
}
