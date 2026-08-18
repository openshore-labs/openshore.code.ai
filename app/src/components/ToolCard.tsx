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

export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const stateGlyph =
    item.state === 'running' ? (
      <span className="spinner" aria-label="running" />
    ) : item.state === 'ok' ? (
      <span className={`tool-state ok`}>
        {'✓'}
        {item.durationMs !== undefined ? ` ${(item.durationMs / 1000).toFixed(1)}s` : ''}
      </span>
    ) : item.state === 'denied' ? (
      <span className="tool-state denied">skipped</span>
    ) : (
      <span className="tool-state fail">{'✗'}</span>
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
      {open && item.detail ? <DiffBlock text={item.detail} /> : null}
    </div>
  );
}
