// The addresses on this computer a started program says it serves at ("run
// my app", build 2026-09-29, P1): a dev server prints `http://localhost:5173/`
// or `http://127.0.0.1:8000/` once it listens. The engine reads one as the
// sign a program it started is ready, and the desktop turns one into an Open
// link on the command card. Pure (no imports), so the app reaches it through
// `os-code/protocol`.

// ANSI colour and cursor sequences: a server that colours its banner splits
// the address with them (`http://localhost:\x1b[1m5173\x1b[22m/`).
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// http(s) on a loopback host (localhost, 127.x.x.x, [::1]) or a wildcard bind
// (0.0.0.0, [::]), which listens on loopback too; an optional port and path.
// The host must end there (`localhost.example.com` is another machine), though
// a sentence may end right after it.
const LOCAL_URL =
  /\bhttps?:\/\/(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\])(?![\w-]|\.[\w-])(:\d{1,5})?(\/[^\s"'`<>()[\]{}]*)?/gi;

/** Punctuation that ends a sentence around an address, never part of it. */
const TRAILING = /[.,;:!?]+$/;

/** Output as plain text: colour and cursor codes removed. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * The distinct local addresses in a program's output, in the order they
 * first appear, ready to open in this computer's browser: a wildcard bind
 * reads as localhost (a browser on Windows cannot open 0.0.0.0). At most
 * `max` (default 3).
 */
export function localAddresses(output: string, max = 3): string[] {
  const text = stripAnsi(output);
  const out: string[] = [];
  for (const match of text.matchAll(LOCAL_URL)) {
    const host = match[1]!.toLowerCase();
    const opens = host === '0.0.0.0' || host === '[::]' ? 'localhost' : host;
    const scheme = match[0].slice(0, match[0].indexOf(':')).toLowerCase();
    const path = (match[3] ?? '').replace(TRAILING, '');
    const url = `${scheme}://${opens}${match[2] ?? ''}${path}`;
    if (!out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}
