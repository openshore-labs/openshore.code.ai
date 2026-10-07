// Setting up a server to dock to (connect-anywhere, 2026-10-07): the four
// steps, the one command with a Copy button, and the line about renting said
// once. Shown in Computer (the server path) and in Cloud Connections (Your
// server), with the dock form beneath it in both. Copy lives in
// lib/docking.ts.
import { useState } from 'react';
import { copyText } from '../lib/clipboard.js';
import {
  SERVER_INSTALL_COMMAND,
  SERVER_PAIR_COMMAND,
  SERVER_RENTED_LINE,
  SERVER_STEPS,
} from '../lib/docking.js';

function CommandRow({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <div className="dock-command">
      <code className="dock-command-text">{command}</code>
      <button
        type="button"
        className="btn ghost press-fb"
        aria-label={label}
        onClick={async () => {
          const ok = await copyText(command);
          setCopied(ok ? 'done' : 'failed');
          setTimeout(() => setCopied('idle'), 1400);
        }}
      >
        {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
    </div>
  );
}

export function ServerSetup() {
  const [again, setAgain] = useState(false);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Set up a server</h3>
      <ol className="dock-steps">
        {SERVER_STEPS.map((step) => (
          <li key={step.title}>
            <div className="dock-step-title">{step.title}</div>
            <div className="sub">{step.detail}</div>
          </li>
        ))}
      </ol>
      <CommandRow command={SERVER_INSTALL_COMMAND} label="Copy the install command" />
      <p className="hint" style={{ marginTop: 10 }}>
        {SERVER_RENTED_LINE}
      </p>
      <button
        type="button"
        className="linklike press-fb"
        aria-expanded={again}
        onClick={() => setAgain((a) => !a)}
      >
        {again ? 'Hide' : 'Already set up? Get a new code'}
      </button>
      {again ? (
        <div style={{ marginTop: 10 }}>
          <div className="sub" style={{ marginBottom: 8 }}>
            On the server, this prints a fresh code and asks there before any device docks.
          </div>
          <CommandRow command={SERVER_PAIR_COMMAND} label="Copy the code command" />
        </div>
      ) : null}
    </div>
  );
}
