// The full interactive terminal (Phase 2 of the chat-to-terminal bridge): a
// real PTY on the desktop, rendered here with xterm.js and multiplexed over the
// same daemon connection the chat uses. Colors, cursor addressing, sudo, vim:
// the whole shell, driven from the couch, with no Termius and no screenshots.
//
// The PTY lives on the desktop and outlives this screen, so closing and
// reopening reattaches to the same shell. The daemon replays its ring buffer
// from the last byte offset this screen saw, so a reconnect (a blip, or the app
// coming back to the foreground) resumes seamlessly instead of starting blank.
//
// iOS specifics, per the review: keystrokes are batched into stdin POSTs, an
// accessory key row sits above the keyboard for the keys a soft keyboard lacks
// (Esc, Tab, Ctrl, arrows, pipe), and on foreground the stream reopens at the
// last offset.
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { exitLine, terminalTheme } from '../components/terminalTheme.js';
import { useApp, driverFor } from '../state/store.js';
import { computerName, sourceLabel } from '../state/types.js';
import { useCompact } from '../hooks/useCompact.js';
import { Sheet } from '../components/Sheet.js';

// Keys a soft keyboard cannot send. A separate Ctrl toggle arms the next letter
// as its control code. Each sends the raw bytes a terminal expects.
const ACCESSORY_KEYS: Array<{ label: string; send: string; aria?: string }> = [
  { label: 'Esc', send: '\x1b' },
  { label: 'Tab', send: '\t' },
  { label: '|', send: '|' },
  { label: '~', send: '~' },
  { label: '/', send: '/' },
  { label: '↑', send: '\x1b[A', aria: 'Up arrow' },
  { label: '↓', send: '\x1b[B', aria: 'Down arrow' },
  { label: '←', send: '\x1b[D', aria: 'Left arrow' },
  { label: '→', send: '\x1b[C', aria: 'Right arrow' },
];

type Status = 'connecting' | 'ready' | 'unavailable' | 'exited';

export function TerminalScreen() {
  const activeId = useApp((s) => s.activeId);
  const conv = useApp((s) => (s.activeId ? s.conversations[s.activeId] : undefined));
  const setView = useApp((s) => s.setView);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const termIdRef = useRef<string>('');
  const ctrlRef = useRef(false);
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState('');
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const compact = useCompact();
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    ctrlRef.current = ctrlArmed;
  }, [ctrlArmed]);

  useEffect(() => {
    const el = containerRef.current;
    const driver = activeId ? driverFor(activeId) : undefined;
    if (!el || !driver?.openTerminal) {
      setStatus('unavailable');
      setMessage(
        'This conversation has no terminal. Open a repository on your computer to use one.',
      );
      return;
    }

    let disposed = false;
    let lastOffset = 0;
    let streamAbort: AbortController | undefined;
    let exited = false;
    // Batch keystrokes into stdin POSTs so a fast typist does not fire one
    // request per character over the tailnet.
    let pending = '';
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    const term = new Terminal({
      fontSize: 13,
      convertEol: false,
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", "Roboto Mono", monospace',
      theme: terminalTheme(),
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      fit.fit();
    } catch {}

    // The shell's end (DAE-5): stop reattaching, say so in the terminal, and
    // let the header offer the way out.
    const markExited = (code: number): void => {
      if (exited) return;
      exited = true;
      termIdRef.current = '';
      streamAbort?.abort();
      term.write(`\r\n\x1b[2m${exitLine(code)}\x1b[0m\r\n`);
      setMessage(exitLine(code));
      setStatus('exited');
    };
    const flush = (): void => {
      const termId = termIdRef.current;
      if (!termId || !pending) return;
      const data = pending;
      pending = '';
      const res = driver.terminalStdin?.(termId, data);
      // A hub answers whether the bytes landed; a 409 means the shell is over.
      if (res && typeof res === 'object' && 'then' in res) {
        void res.then((r) => {
          if (!r.ok && r.exited) markExited(0);
        });
      }
    };
    term.onData((data) => {
      let out = data;
      // A one-shot Ctrl: convert a single letter to its control code.
      if (ctrlRef.current && data.length === 1) {
        const code = data.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) out = String.fromCharCode(code & 0x1f);
        setCtrlArmed(false);
      }
      pending += out;
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = undefined;
          flush();
        }, 25);
      }
    });

    // Reconnecting stream loop: resume from the last byte offset, so a blip or a
    // foreground resume continues instead of clearing the screen.
    const runStream = async (): Promise<void> => {
      while (!disposed && termIdRef.current) {
        const ac = new AbortController();
        streamAbort = ac;
        try {
          await driver.terminalStream?.(
            termIdRef.current,
            lastOffset,
            (bytes, endOffset) => {
              term.write(bytes);
              lastOffset = Math.max(lastOffset, endOffset);
            },
            ac.signal,
            (info) => markExited(info.exit),
          );
        } catch {}
        if (disposed) break;
        await new Promise((r) => setTimeout(r, 600));
      }
    };

    void (async () => {
      const opened = await driver.openTerminal!({ cols: term.cols, rows: term.rows });
      if (disposed) return;
      if ('unavailable' in opened) {
        setStatus('unavailable');
        setMessage(opened.error);
        return;
      }
      termIdRef.current = opened.termId;
      setStatus('ready');
      driver.terminalResize?.(opened.termId, term.cols, term.rows);
      void runStream();
    })();

    // Refit and tell the PTY on container resize and rotation.
    const onResize = (): void => {
      try {
        fit.fit();
      } catch {}
      const termId = termIdRef.current;
      if (termId) driver.terminalResize?.(termId, term.cols, term.rows);
    };
    window.addEventListener('resize', onResize);

    // On foreground, iOS may have frozen the stream socket. Force a fresh stream
    // from the last offset so output resumes.
    let removeAppListener: (() => void) | undefined;
    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) streamAbort?.abort();
        });
        removeAppListener = () => void handle.remove();
      } catch {}
    })();

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      removeAppListener?.();
      // Send anything typed in the last few ms before the batch timer fired,
      // so a `y` right before Back is not dropped (UI-12).
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      streamAbort?.abort();
      // Leave the PTY alive on the desktop (the tmux property): only tear down
      // the local view. The End button kills the remote PTY explicitly.
      term.dispose();
      termRef.current = null;
      termIdRef.current = '';
    };
    // Rebuild only when the conversation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const sendKeys = (data: string): void => {
    const driver = activeId ? driverFor(activeId) : undefined;
    const termId = termIdRef.current;
    if (driver?.terminalStdin && termId) driver.terminalStdin(termId, data);
    termRef.current?.focus();
  };

  const endTerminal = (): void => {
    const driver = activeId ? driverFor(activeId) : undefined;
    const termId = termIdRef.current;
    if (driver?.terminalKill && termId) driver.terminalKill(termId);
    setView('chat');
  };

  return (
    <div className="shell-main terminal-screen">
      <header className="topbar">
        <button
          type="button"
          className="icon-btn back-btn press-fb"
          onClick={() => setView('chat')}
          aria-label="Back to Chat"
          title="Back to Chat"
        >
          <span className="back-chevron" aria-hidden="true" />
          {!compact ? <span className="back-label">Chat</span> : null}
        </button>
        <div className="topbar-title">
          Terminal
          <div className="topbar-sub">{conv ? sourceLabel(conv.source) : computerName()}</div>
        </div>
        {status === 'ready' ? (
          <button
            type="button"
            className="btn quiet sm press-fb"
            onClick={() => setEnding(true)}
            aria-label="End terminal"
          >
            End
          </button>
        ) : status === 'exited' ? (
          <button
            type="button"
            className="btn quiet sm press-fb"
            onClick={endTerminal}
            aria-label="Close terminal"
          >
            Close
          </button>
        ) : (
          <div className="topbar-spacer" />
        )}
      </header>

      {status === 'unavailable' ? (
        <div className="terminal-message">{message}</div>
      ) : (
        <>
          {status === 'connecting' ? (
            <div className="terminal-message">Connecting to the terminal on your computer...</div>
          ) : status === 'exited' ? (
            <div className="terminal-message">{message} Close to go back to the chat.</div>
          ) : null}
          <div className="terminal-host" ref={containerRef} />
          {status === 'ready' ? (
            <div className="terminal-accessory">
              <button
                type="button"
                className={`accessory-key press-fb${ctrlArmed ? ' armed' : ''}`}
                onClick={() => setCtrlArmed((v) => !v)}
              >
                Ctrl
              </button>
              {ACCESSORY_KEYS.map((k) => (
                <button
                  key={k.label}
                  type="button"
                  className="accessory-key press-fb"
                  aria-label={k.aria}
                  onClick={() => sendKeys(k.send)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      <Sheet open={ending} onClose={() => setEnding(false)} variant="confirm">
        <h3>End this terminal?</h3>
        <p>Anything running in it stops.</p>
        <div className="confirm-row">
          <button type="button" className="btn ghost press-fb" onClick={() => setEnding(false)}>
            Keep
          </button>
          <button
            type="button"
            className="btn danger press-fb"
            onClick={() => {
              setEnding(false);
              endTerminal();
            }}
          >
            End
          </button>
        </div>
      </Sheet>
    </div>
  );
}
