// A command the user ran through the chat-to-terminal bridge, rendered as a
// live terminal card: the command line, streaming output in a mono block that
// sticks to the bottom while running, a stdin field to answer a prompt, a Kill
// control, and an exit badge when it finishes. The model reads the result on
// its next turn, so there is no screenshot round-trip.
import { useEffect, useRef, useState } from 'react';
import type { ThreadItem } from '../state/types.js';
import { useApp } from '../state/store.js';

type CommandItem = Extract<ThreadItem, { kind: 'command' }>;

// Strip ANSI escape sequences so the output reads cleanly. Full ANSI rendering
// belongs to the Phase 2 PTY terminal; a command card is plain text.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
function clean(text: string): string {
  return text.replace(ANSI, '');
}

export function CommandCard({ item }: { item: CommandItem }) {
  const killCommand = useApp((s) => s.killCommand);
  const sendCommandStdin = useApp((s) => s.sendCommandStdin);
  const [stdin, setStdin] = useState('');
  const bodyRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  // Auto-stick to the bottom while running, unless the user scrolled up.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [item.output]);

  const onScroll = (): void => {
    const el = bodyRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const submitStdin = (): void => {
    if (!stdin) return;
    sendCommandStdin(item.runId, `${stdin}\n`);
    setStdin('');
  };

  const badge =
    item.state === 'running' ? (
      <span className="spinner" aria-label="running" />
    ) : item.state === 'killed' ? (
      <span className="tool-state denied">stopped</span>
    ) : (
      <span className={`tool-state ${item.exitCode === 0 ? 'ok' : 'fail'}`}>
        exit {item.exitCode ?? '?'}
        {item.durationMs !== undefined ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ''}
      </span>
    );

  return (
    <div className="command-card">
      <div className="command-card-head">
        <span className="command-prompt" aria-hidden="true">
          $
        </span>
        <span className="command-line">{item.command}</span>
        {badge}
        {item.state === 'running' ? (
          <button
            type="button"
            className="command-kill press-fb"
            onClick={() => {
              killCommand(item.runId);
            }}
          >
            Kill
          </button>
        ) : null}
      </div>
      {item.output ? (
        <pre ref={bodyRef} className="command-output" onScroll={onScroll}>
          {clean(item.output)}
        </pre>
      ) : null}
      {item.truncated ? <div className="command-note">Output truncated.</div> : null}
      {item.state === 'running' ? (
        <div className="command-stdin">
          <input
            type="text"
            value={stdin}
            placeholder="type to answer a prompt, then Enter"
            onChange={(e) => setStdin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitStdin();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
