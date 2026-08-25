// One tool call as a card: name, live spinner or outcome, tap to expand the
// diff. The approval moment lives in ApprovalSheet; this is the record.
import { useState } from 'react';
import type { ThreadItem } from '../state/types.js';

type ToolItem = Extract<ThreadItem, { kind: 'tool' }>;

function diffClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-del';
  if (line.startsWith('@@')) return 'diff-hunk';
  return 'diff-ctx';
}

export function DiffBlock({ text }: { text: string }) {
  return (
    <div className="tool-card-detail">
      {text.split('\n').map((line, i) => (
        <div key={i} className={diffClass(line)}>
          {line || ' '}
        </div>
      ))}
    </div>
  );
}

// Plain tool output (a shell command's stdout/stderr, a read result): verbatim
// in a mono block, with no diff colorizing. A command line that starts with +
// or - is data, not an addition or deletion.
export function OutputBlock({ text }: { text: string }) {
  return (
    <div className="tool-card-detail">
      {text.split('\n').map((line, i) => (
        <div key={i} className="diff-ctx">
          {line || ' '}
        </div>
      ))}
    </div>
  );
}

export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const stateGlyph =
    item.state === 'running' ? (
      <span className="spinner" aria-label="running" />
    ) : item.state === 'ok' ? (
      <span className={`tool-state ok`}>
        {/* CR1: the checkmark SVG is aria-hidden, so name the outcome for SR. */}
        <span className="visually-hidden">done</span>
        <svg
          className="icon-inline"
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 12.5 9.5 18 20 6.5" />
        </svg>
        {item.durationMs !== undefined ? ` ${(item.durationMs / 1000).toFixed(1)}s` : ''}
      </span>
    ) : item.state === 'denied' ? (
      <span className="tool-state denied">skipped</span>
    ) : (
      <span className="tool-state fail">
        {/* CR1: the cross SVG is aria-hidden, so name the outcome for SR. */}
        <span className="visually-hidden">failed</span>
        <svg
          className="icon-inline"
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </span>
    );

  return (
    <div className="tool-card">
      <button
        className="tool-card-head"
        onClick={() => item.detail && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="tool-name">{item.name}</span>
        <span className="tool-summary">{item.summary}</span>
        {stateGlyph}
      </button>
      {open && item.detail ? (
        item.detailKind === 'output' ? (
          <OutputBlock text={item.detail} />
        ) : (
          <DiffBlock text={item.detail} />
        )
      ) : null}
    </div>
  );
}
