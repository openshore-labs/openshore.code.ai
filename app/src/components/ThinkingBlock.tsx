// The model's reasoning, shown the way Claude shows it (Chain of Thought, off
// by default in Settings): open and streaming while the model thinks, then
// folded to one quiet line ("Thought for 12s") the moment the answer starts,
// expandable again to the full text in muted italic. Never load-bearing: the
// answer stands on its own without it.
import { useEffect, useRef, useState } from 'react';
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
  // Once the person taps the head, the block is theirs: it no longer folds or
  // opens on its own.
  const touched = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  // An auto-opened (live) thought reads in a capped window, and keeps the cap
  // through its fold so the collapse never jumps; a tap reopens it in full.
  const [capped, setCapped] = useState(false);

  const reveal = () => {
    setEverOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  };

  // Live, then fold: a thought that arrives streaming opens itself, and folds
  // once the model moves on to its answer (streaming ends).
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (streaming && !wasStreaming.current && !touched.current) {
      setCapped(true);
      reveal();
    }
    if (!streaming && wasStreaming.current && !touched.current) setOpen(false);
    wasStreaming.current = streaming;
  }, [streaming]);

  // While live, keep the newest line in view inside the capped body.
  useEffect(() => {
    if (streaming && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, streaming]);

  const toggle = () => {
    touched.current = true;
    setCapped(false);
    if (!everOpen) {
      reveal();
      return;
    }
    setOpen((o) => !o);
  };
  const seconds = Math.max(1, Math.round(((endedAt ?? Date.now()) - startedAt) / 1000));
  return (
    <div className={`thinking${open ? ' open' : ''}${capped ? ' capped' : ''}`}>
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
            <div className="thinking-body" ref={body}>
              <Markdown text={text} streaming={streaming} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
