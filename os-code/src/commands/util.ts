// Shared helpers for command-line wizards: questions, secret input, and a
// numbered picker that works over any SSH connection.
import { createInterface } from 'node:readline';
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
