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
  // Mount the body on first open and keep it, so the reveal plays both ways on
  // grid rows (the ToolCard pattern), never a snap mount or unmount. The first
  // open lands a frame after the mount so the rows have a closed state to
  // grow from.
  const [everOpen, setEverOpen] = useState(false);
  const toggle = () => {
    if (!everOpen) {
      setEverOpen(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
      return;
    }
    setOpen((o) => !o);
  };
  const seconds = Math.max(1, Math.round(((endedAt ?? Date.now()) - startedAt) / 1000));
  return (
    <div className={`thinking${open ? ' open' : ''}`}>
      <button
        type="button"
        className="thinking-head press-fb press-fb--row"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className={`thinking-glyph${streaming ? ' live' : ''}`} aria-hidden="true" />
        <span className="thinking-label">{streaming ? 'Thinking' : `Thought for ${seconds}s`}</span>
        <span className="thinking-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {everOpen ? (
        <div className={`reveal${open ? ' open' : ''}`} aria-hidden={!open}>
          <div className="reveal-inner">
            <div className="thinking-body">
              <Markdown text={text} streaming={streaming} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
