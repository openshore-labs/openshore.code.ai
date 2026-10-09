// Shared helpers for command-line wizards: questions, secret input, and a
// numbered picker that works over any SSH connection.
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { GLYPHS, t } from '../brand/theme.js';

export function out(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function header(title: string): void {
  out();
  out(t.bold(t.local(title)));
}

export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(t.text(`${question} `), (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

/** Yes/no with a default; Enter takes the default. */
export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`${question} ${t.muted(hint)}`)).toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

/** Secret input: characters are not echoed. */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(t.text(`${question} `));
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const onData = (chunk: Buffer) => {
      const ch = chunk.toString('utf8');
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.off('data', onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value.trim());
      } else if (ch === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** Where `readSecret` reads and writes; the process's own by default. */
export interface SecretIo {
  stdin: NodeJS.ReadableStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => unknown;
  };
  stdout: { write(text: string): unknown };
}

/** The person pressed Ctrl-C at a secret prompt. */
export class SecretCancelled extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'SecretCancelled';
  }
}

/** An editing key at a secret prompt. The prompt shows nothing, so an arrow
 *  pressed to fix a typo would store a different key without a word; the
 *  line is refused instead, and nothing is saved. */
export const SECRET_EDIT_KEYS =
  'Arrow keys, Escape and the other editing keys do not work at this prompt, so nothing was saved. Run it again, paste the key, and press Enter.';

/** The bracketed-paste markers (ESC [200~ and ESC [201~), the one escape
 *  sequence a secret prompt skips: the paste between them is the key. */
const PASTE_MARKERS: ReadonlySet<string> = new Set(['200~', '201~']);

/**
 * One secret line, read without echo, from a terminal or a pipe (keys on your
 * server, 2026-10-09). On a terminal the characters are not shown, a paste
 * arrives whole, Backspace works and Ctrl-C cancels. From a pipe
 * (`printf '%s' "$KEY" | osc key add groq`) it is the first line, or all of
 * it when there is no newline: askSecret waits for an Enter a pipe never
 * sends. A secret never comes from the command line, where ps and the shell
 * history would keep it. An escape sequence other than the paste markers (an
 * arrow, Home, End, Delete, a lone Escape) refuses the line (SECRET_EDIT_KEYS).
 */
export function readSecret(
  question: string,
  io: SecretIo = { stdin: process.stdin, stdout: process.stdout },
  maxChars = 16 * 1024,
): Promise<string> {
  const { stdin, stdout } = io;
  const tty = stdin.isTTY === true && typeof stdin.setRawMode === 'function';
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    const wasRaw = stdin.isRaw ?? false;
    let value = '';
    let settled = false;
    // An escape sequence under way: '' just after ESC, then '[' and the
    // sequence's parameter bytes; undefined outside one.
    let pending: string | undefined;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      if (tty) {
        stdin.setRawMode!(wasRaw);
        stdout.write('\n');
      }
      stdin.pause();
      if (err) reject(err);
      else resolve(value.trim());
    };
    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
      for (const ch of text) {
        if (pending !== undefined) {
          if (pending === '') {
            // Only a CSI sequence (ESC [) can be a paste marker.
            if (ch !== '[') return finish(new Error(SECRET_EDIT_KEYS));
            pending = '[';
            continue;
          }
          // Parameter and intermediate bytes, then one final byte.
          if (ch >= ' ' && ch <= '?' && pending.length < 16) {
            pending += ch;
            continue;
          }
          if (ch >= '@' && ch <= '~' && PASTE_MARKERS.has(`${pending.slice(1)}${ch}`)) {
            pending = undefined;
            continue;
          }
          return finish(new Error(SECRET_EDIT_KEYS));
        }
        if (ch === '\u001b') {
          pending = '';
          continue;
        }
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish();
        if (tty && ch === '\u0003') return finish(new SecretCancelled());
        if (tty && (ch === '\u007f' || ch === '\b')) {
          value = value.slice(0, -1);
          continue;
        }
        // Other control characters (a tab, a stray Ctrl key) are never part
        // of a key.
        if (ch < ' ' || ch === '\u007f') continue;
        value += ch;
        if (value.length > maxChars) return finish(new Error('That is too long to be a key.'));
      }
    };
    const onEnd = (): void =>
      finish(pending !== undefined ? new Error(SECRET_EDIT_KEYS) : undefined);
    const onError = (err: Error): void => finish(err);
    if (tty) {
      stdout.write(t.text(`${question} `));
      stdin.setRawMode!(true);
    }
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
    stdin.resume();
  });
}

export interface PickOption {
  label: string;
  detail?: string;
  disabled?: string; // reason, when not selectable
  recommended?: boolean;
}

/** Numbered picker: prints the options, reads a number. Reliable everywhere. */
export async function pick(
  title: string,
  options: PickOption[],
  defaultIndex = 0,
): Promise<number> {
  header(title);
  options.forEach((option, i) => {
    const number = t.local(`${i + 1}.`);
    const label = option.disabled ? t.muted(option.label) : t.text(option.label);
    const marks = [
      option.recommended ? t.ok(' (recommended)') : '',
      option.disabled ? t.muted(` (${option.disabled})`) : '',
    ].join('');
    out(`  ${number} ${label}${marks}`);
    if (option.detail) out(`     ${t.muted(option.detail)}`);
  });
  for (;;) {
    const answer = await ask(
      `Pick 1-${options.length} ${t.muted(`(Enter = ${defaultIndex + 1})`)}`,
    );
    const index = answer === '' ? defaultIndex : Number(answer) - 1;
    if (Number.isInteger(index) && index >= 0 && index < options.length) {
      if (options[index]!.disabled) {
        out(t.warn(`That one is not available: ${options[index]!.disabled}`));
        continue;
      }
      return index;
    }
    out(t.warn(`A number between 1 and ${options.length}, please.`));
  }
}

export function okLine(text: string): void {
  out(`  ${t.ok(GLYPHS.ok)} ${t.text(text)}`);
}

export function failLine(text: string, fix?: string): void {
  out(`  ${t.danger(GLYPHS.fail)} ${t.text(text)}`);
  if (fix) out(`    ${t.muted('fix:')} ${t.local(fix)}`);
}

export function warnLine(text: string, fix?: string): void {
  out(`  ${t.warn('!')} ${t.text(text)}`);
  if (fix) out(`    ${t.muted('fix:')} ${t.local(fix)}`);
}

export function skipLine(text: string): void {
  out(`  ${t.muted(GLYPHS.skip)} ${t.muted(text)}`);
}

/** The bar glyphs only, no color: filled blocks then light shade, for tests. */
export function progressBarPlain(percent: number, width = 24): string {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

/** A colored progress bar with its percentage and an optional trailing label. */
export function progressBar(percent: number, width = 24, label?: string): string {
  const bar = progressBarPlain(percent, width);
  const pct = `${Math.max(0, Math.min(100, percent)).toFixed(0)}%`.padStart(4);
  return `${t.local(bar)} ${t.text(pct)}${label ? ` ${t.muted(label)}` : ''}`;
}

/** Human byte size, e.g. 4.7 GB. Base-1000 to match how downloads are quoted. */
export function fmtBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u += 1;
  }
  return `${n.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}
