// One tool call as a card: what it did in plain words, a live elapsed
// counter while it runs, the outcome, and a tap to expand the diff or the
// output. Long output is folded to its head and tail with a control to show
// it all, so a 24k-character grep never mounts thousands of rows at once.
// The approval moment lives in ApprovalSheet; this is the record.
import { useEffect, useState } from 'react';
import type { ThreadItem } from '../state/types.js';

type ToolItem = Extract<ThreadItem, { kind: 'tool' }>;

/** Folded view: this many lines from the top and the bottom. */
const HEAD_LINES = 20;
const TAIL_LINES = 10;
/** Never render more than this many rows, even expanded. */
const HARD_CAP = 2000;

function diffClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-del';
  if (line.startsWith('@@')) return 'diff-hunk';
  return 'diff-ctx';
}

/** A unified diff with a line-number gutter: the new file's line for context
 *  and additions, the old file's for deletions, blank for headers. */
export function DiffBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  let oldLine = 0;
  let newLine = 0;
  const rows = lines.slice(0, HARD_CAP).map((line, i) => {
    let gutter = '';
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
    } else if (line.startsWith('+++') || line.startsWith('---')) {
      // file headers
    } else if (line.startsWith('+')) {
      gutter = String(newLine++);
    } else if (line.startsWith('-')) {
      gutter = String(oldLine++);
    } else if (oldLine || newLine) {
      gutter = String(newLine++);
      oldLine++;
    }
    return (
      <div key={i} className={`diff-line ${diffClass(line)}`}>
        <span className="diff-gutter" aria-hidden="true">
          {gutter}
        </span>
        <span className="diff-text">{line || ' '}</span>
      </div>
    );
  });
  return (
    <div className="tool-card-detail diff">
      {rows}
      {lines.length > HARD_CAP ? (
        <div className="diff-line diff-ctx">
          <span className="diff-gutter" />
          <span className="diff-text">{`… ${lines.length - HARD_CAP} more lines`}</span>
        </div>
      ) : null}
    </div>
  );
}

// Plain tool output (a shell command's stdout/stderr, a read result): verbatim
// in a mono block, with no diff colorizing. A command line that starts with +
// or - is data, not an addition or deletion. Folded to head and tail when long.
export function OutputBlock({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const lines = text.split('\n');
  const folded = !all && lines.length > HEAD_LINES + TAIL_LINES + 4;
  const shown = folded
    ? [...lines.slice(0, HEAD_LINES), null, ...lines.slice(-TAIL_LINES)]
    : lines.slice(0, HARD_CAP);
  return (
    <div className="tool-card-detail">
      {shown.map((line, i) =>
        line === null ? (
          <button
            key="fold"
            type="button"
            className="output-fold press-fb"
            onClick={() => setAll(true)}
          >
            Show all {lines.length.toLocaleString()} lines
          </button>
        ) : (
          <div key={i} className="diff-ctx">
            {line || ' '}
          </div>
        ),
      )}
      {!folded && lines.length > HARD_CAP ? (
        <div className="diff-ctx">{`… ${lines.length - HARD_CAP} more lines`}</div>
      ) : null}
    </div>
  );
}

function Elapsed({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.floor((now - since) / 1000);
  if (s < 1) return null;
  return (
    <span className="tool-elapsed">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>
  );
}

export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const stateGlyph =
    item.state === 'running' ? (
      <span className="tool-state running">
        <span className="spinner" aria-label="running" />
        <Elapsed since={item.startedAt} />
      </span>
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
    <div className="tool-card" id={`tool-${item.id}`}>
      <button
        className="tool-card-head press-fb press-fb--row"
        onClick={() => item.detail && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="tool-summary">{item.summary}</span>
        {item.stats ? (
          <span
            className="tool-stats"
            aria-label={`${item.stats.added} added, ${item.stats.removed} removed`}
          >
            <span className="diff-add">+{item.stats.added}</span>{' '}
            <span className="diff-del">-{item.stats.removed}</span>
          </span>
        ) : null}
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
