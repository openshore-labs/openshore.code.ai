// A command on the chat-to-terminal bridge, rendered as a live terminal card:
// the command line, streaming output in a mono block that sticks to the
// bottom while running, a stdin field to answer a prompt, a Stop control, and
// an exit badge when it finishes. The model reads the result on its next
// turn, so there is no screenshot round-trip. The person runs one by tapping
// Run; the agent starts one with startProcess (P1, "run my app"), and its card
// says so. While a program runs and prints where it serves on this computer,
// the desktop offers that address as an Open link.
import { useEffect, useRef, useState } from 'react';
import { localAddresses } from 'os-code/protocol';
import type { ThreadItem } from '../state/types.js';
import { useApp } from '../state/store.js';
import { isDesktop, openExternal } from '../lib/platform.js';

type CommandItem = Extract<ThreadItem, { kind: 'command' }>;

// Strip ANSI escape sequences so the output reads cleanly. Full ANSI rendering
// belongs to the Phase 2 PTY terminal; a command card is plain text.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
function clean(text: string): string {
  return text.replace(ANSI, '');
}

/** The line on a card for a program the agent started, not the person. */
export const STARTED_BY_OPENSHORE = 'Started by OpenShore';

/** The Open link's words for one local address: the address, less its
 *  scheme and a bare trailing slash ("Open localhost:5173"). */
export function openLabel(url: string): string {
  return `Open ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
}

export function CommandCard({ item }: { item: CommandItem }) {
  const killCommand = useApp((s) => s.killCommand);
  const sendCommandStdin = useApp((s) => s.sendCommandStdin);
  const preferRemoteHub = useApp((s) => s.settings.preferRemoteHub);
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

  // A local address names the computer the program runs on. It opens only
  // where that is this machine: the desktop on its own engine. On the phone,
  // or a desktop driving another computer, it stays plain text in the output.
  const onThisComputer = isDesktop() && !preferRemoteHub;
  const links = item.state === 'running' && onThisComputer ? localAddresses(item.output) : [];

  return (
    <div className="command-card">
      {item.source === 'agent' ? <div className="command-by">{STARTED_BY_OPENSHORE}</div> : null}
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
            Stop
          </button>
        ) : null}
      </div>
      {item.output ? (
        <pre ref={bodyRef} className="command-output" onScroll={onScroll}>
          {clean(item.output)}
        </pre>
      ) : null}
      {links.length ? (
        <div className="command-links">
          {links.map((url) => (
            <button
              key={url}
              type="button"
              className="command-open press-fb"
              onClick={() => openExternal(url)}
            >
              {openLabel(url)}
            </button>
          ))}
        </div>
      ) : null}
      {item.truncated ? <div className="command-note">Output truncated.</div> : null}
      {item.state === 'running' ? (
        <div className="command-stdin">
          <input
            type="text"
            aria-label="Reply to the command"
            value={stdin}
            placeholder="Type a reply, then press Enter"
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
