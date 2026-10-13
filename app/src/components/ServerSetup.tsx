// Setting up a server to dock to (connect-anywhere, 2026-10-07): the four
// steps, the one command with a Copy button, and the line about renting said
// once. Shown in Computer (the server paths) and in Cloud Connections (Your
// server), with the dock form beneath it in both. A server at home skips the
// renting line; a rented one adds what each size can do and, for setting up
// several, the cloud-init to paste when creating one (many machines,
// 2026-10-12). Copy lives in lib/docking.ts.
import { useState } from 'react';
import { copyText } from '../lib/clipboard.js';
import {
  SERVER_CLOUD_INIT,
  SERVER_CLOUD_INIT_LINE,
  SERVER_INSTALL_COMMAND,
  SERVER_PAIR_COMMAND,
  SERVER_RENTED_LINE,
  SERVER_SIZES,
  serverSteps,
  type DockPlace,
} from '../lib/docking.js';

/** One command to run on a server, with a Copy button (the key notes in
 *  components/ServerKeys.tsx use it too). */
export function CommandRow({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <div className="dock-command">
      <code className="dock-command-text">{command}</code>
      <button
        type="button"
        className="btn ghost sm press-fb"
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

export function ServerSetup({ place = 'rented' }: { place?: DockPlace }) {
  const [again, setAgain] = useState(false);
  const [several, setSeveral] = useState(false);
  const [sizes, setSizes] = useState(false);
  const rented = place === 'rented';
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        {rented ? 'Set up a rented server' : 'Set up a server at home'}
      </h3>
      <ol className="dock-steps">
        {serverSteps(place).map((step) => (
          <li key={step.title}>
            <div className="dock-step-title">{step.title}</div>
            <div className="sub">{step.detail}</div>
          </li>
        ))}
      </ol>
      <CommandRow command={SERVER_INSTALL_COMMAND} label="Copy the install command" />
      {rented ? (
        <>
          <p className="hint" style={{ marginTop: 10 }}>
            {SERVER_RENTED_LINE}
          </p>
          {/* What each size can do, folded: detail for the person choosing
              a plan, not the first read (2026-10-13). */}
          <button
            type="button"
            className="linklike press-fb dock-several"
            aria-expanded={sizes}
            onClick={() => setSizes((v) => !v)}
          >
            {sizes ? 'Hide sizes' : 'Which size do I need?'}
          </button>
          {sizes ? (
            <dl className="dock-sizes">
              {SERVER_SIZES.map((row) => (
                <div key={row.size} className="dock-size">
                  <dt className="dock-step-title">{row.size}</dt>
                  <dd className="sub">{row.detail}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : null}
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
      {rented ? (
        <>
          <button
            type="button"
            className="linklike press-fb dock-several"
            aria-expanded={several}
            onClick={() => setSeveral((v) => !v)}
          >
            {several ? 'Hide' : 'Setting up more than one?'}
          </button>
          {several ? (
            <div style={{ marginTop: 10 }}>
              <div className="sub" style={{ marginBottom: 8 }}>
                {SERVER_CLOUD_INIT_LINE}
              </div>
              <CommandRow command={SERVER_CLOUD_INIT} label="Copy the cloud-init" />
              <div style={{ marginTop: 8 }}>
                <CommandRow command={SERVER_PAIR_COMMAND} label="Copy the code command" />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
