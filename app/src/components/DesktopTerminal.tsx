// The interactive terminal, as a component the Terminal room mounts against
// whatever host the active session runs on. A real PTY on the desktop, rendered
// with xterm.js over the driver the chat already uses. Colors, cursor, sudo,
// vim: the whole shell.
//
// This shares its shape with screens/TerminalScreen.tsx (the from-a-chat
// takeover) on purpose. The takeover is a shipped, working foundation; rather
// than refactor it blind (it cannot be device-tested from here), the room gets
// this sibling and the takeover is left untouched. The streaming contract is
// the same: the PTY outlives the view, and a reconnect replays the ring buffer
// from the last byte offset so a blip or a foreground resume continues instead
// of clearing the screen.
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { exitLine, terminalTheme } from './terminalTheme.js';
import type { ChatDriver } from '../drivers/types.js';

// Keys a soft keyboard cannot send. A separate Ctrl toggle arms the next letter
// as its control code. Each sends the raw bytes a terminal expects.
const ACCESSORY_KEYS: Array<{ label: string; send: string }> = [
  { label: 'Esc', send: '\x1b' },
  { label: 'Tab', send: '\t' },
  { label: '|', send: '|' },
  { label: '~', send: '~' },
  { label: '/', send: '/' },
  { label: 'up', send: '\x1b[A' },
  { label: 'down', send: '\x1b[B' },
  { label: 'left', send: '\x1b[D' },
  { label: 'right', send: '\x1b[C' },
];

type Status = 'connecting' | 'ready' | 'unavailable' | 'exited';

export function DesktopTerminal({ driver }: { driver: ChatDriver }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const termIdRef = useRef<string>('');
  const ctrlRef = useRef(false);
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState('');
  const [ctrlArmed, setCtrlArmed] = useState(false);

  useEffect(() => {
    ctrlRef.current = ctrlArmed;
  }, [ctrlArmed]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !driver.openTerminal) {
      setStatus('unavailable');
      setMessage('This session has no terminal. It is not backed by a desktop.');
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
      // Send anything typed in the last few ms before the batch timer fired, so
      // a fast keystroke right before leaving is not dropped.
      if (flushTimer) clearTimeout(flushTimer);
      flush();
      streamAbort?.abort();
      // Leave the PTY alive on the desktop (the tmux property): only tear down
      // the local view, so returning to the room reattaches to the same shell.
      term.dispose();
      termRef.current = null;
      termIdRef.current = '';
    };
    // The room remounts this via key when the session changes, so the effect
    // captures its driver once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendKeys = (data: string): void => {
    const termId = termIdRef.current;
    if (driver.terminalStdin && termId) driver.terminalStdin(termId, data);
    termRef.current?.focus();
  };

  if (status === 'unavailable') {
    return <div className="terminal-message">{message}</div>;
  }

  return (
    <>
      {status === 'connecting' ? (
        <div className="terminal-message">Connecting to your terminal...</div>
      ) : status === 'exited' ? (
        <div className="terminal-message">{message}</div>
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
              onClick={() => sendKeys(k.send)}
            >
              {k.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
