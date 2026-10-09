// osc key (keys on your server, 2026-10-09): the key is read from a hidden
// terminal prompt or from a pipe, never from the command line, and never
// printed back. askSecret waits for an Enter that a pipe never sends, so the
// reader here takes both.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretCancelled, readSecret, type SecretIo } from '../src/commands/util.js';
import { keyAddCommand, keyListCommand, keyRemoveCommand } from '../src/commands/key.js';
import { _setFakeKeychain, getCredential } from '../src/auth/store.js';
import { setColorEnabled } from '../src/brand/theme.js';

const KEY = 'gsk_cli_key_0123456789abcdef';

let home: string;
let printed: string;

function pipe(text: string, chunks = 1): SecretIo & { stdin: PassThrough } {
  const stdin = new PassThrough();
  const step = Math.ceil(text.length / chunks);
  setImmediate(() => {
    for (let i = 0; i < text.length; i += step) stdin.write(text.slice(i, i + step));
    stdin.end();
  });
  return { stdin, stdout: { write: (s: string) => (printed += s) } };
}

function terminal(): SecretIo & { stdin: PassThrough; raw: boolean[] } {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: (m: boolean) => void;
  };
  const raw: boolean[] = [];
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (m: boolean) => {
    raw.push(m);
    stdin.isRaw = m;
  };
  return { stdin, raw, stdout: { write: (s: string) => (printed += s) } };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'oschome-keycli-'));
  process.env.OSC_HOME = home;
  _setFakeKeychain({});
  setColorEnabled(false);
  printed = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
    printed += String(s);
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  _setFakeKeychain(undefined);
  delete process.env.OSC_HOME;
  process.exitCode = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe('reading a key', () => {
  it('from a pipe: the first line, a line with no newline, a line in pieces', async () => {
    expect(await readSecret('API key:', pipe(`${KEY}\n`))).toBe(KEY);
    expect(await readSecret('API key:', pipe(KEY))).toBe(KEY);
    expect(await readSecret('API key:', pipe(`${KEY}\r\nignored\n`, 5))).toBe(KEY);
    expect(await readSecret('API key:', pipe(''))).toBe('');
    // A pipe gets no prompt, and nothing is echoed.
    expect(printed).toBe('');
  });

  it('from a terminal: hidden, a paste arrives whole, Backspace works, raw mode is put back', async () => {
    const io = terminal();
    const read = readSecret('API key:', io);
    io.stdin.write(`${KEY}x`);
    io.stdin.write('\u007f');
    io.stdin.write('\r');
    expect(await read).toBe(KEY);
    expect(io.raw).toEqual([true, false]);
    expect(printed).toContain('API key:');
    expect(printed).not.toContain(KEY);
  });

  it('Ctrl-C at a terminal cancels', async () => {
    const io = terminal();
    const read = readSecret('API key:', io);
    io.stdin.write('abc\u0003');
    await expect(read).rejects.toBeInstanceOf(SecretCancelled);
    expect(io.raw).toEqual([true, false]);
  });
});

describe('osc key', () => {
  it('add reads the key from a pipe, stores it, and never prints it', async () => {
    await keyAddCommand('groq', {}, pipe(`${KEY}\n`));
    expect(process.exitCode).toBeUndefined();
    expect(getCredential('provider-key:groq')).toBe(KEY);
    expect(printed).toContain('The Groq key is stored on this machine');
    expect(printed).toContain('osc stack use <model> groq');
    expect(printed).not.toContain(KEY);
    const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    expect(config.providers.groq.apiKeyRef).toBe('provider-key:groq');
  });

  it('add asks for --base-url before reading anything, for a provider it does not know', async () => {
    const io = pipe(`${KEY}\n`);
    await keyAddCommand('fireworks', {}, io);
    expect(process.exitCode).toBe(1);
    expect(printed).toMatch(/--base-url/);
    expect(getCredential('provider-key:fireworks')).toBeUndefined();
    await keyAddCommand(
      'fireworks',
      { baseUrl: 'https://api.fireworks.ai/inference/v1', label: 'Fireworks' },
      pipe(`${KEY}\n`),
    );
    expect(getCredential('provider-key:fireworks')).toBe(KEY);
  });

  it('add refuses a bad id and an empty key, and prints a refusal without the key', async () => {
    await keyAddCommand('Not An Id', {}, pipe(`${KEY}\n`));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await keyAddCommand('groq', {}, pipe('\n'));
    expect(printed).toMatch(/Nothing entered/);
    await keyAddCommand('anthropic', {}, pipe('mistralplainkeywithnoprefix0123\n'));
    expect(process.exitCode).toBe(1);
    expect(printed).toMatch(/sk-ant-/);
    expect(printed).not.toContain('mistralplainkeywithnoprefix0123');
  });

  it('list names the providers, and remove deletes one', async () => {
    await keyAddCommand('groq', {}, pipe(`${KEY}\n`));
    printed = '';
    keyListCommand();
    expect(printed).toMatch(/groq\s+Groq\s+api\.groq\.com/);
    expect(printed).not.toContain(KEY);
    printed = '';
    keyRemoveCommand('groq');
    expect(printed).toContain('The Groq key is gone from this machine.');
    expect(getCredential('provider-key:groq')).toBeUndefined();
    printed = '';
    keyRemoveCommand('groq');
    expect(printed).toContain('No Groq key is kept on this machine.');
  });

  it('stack use --context places a keyed model with its window, over SSH', async () => {
    const { stackUseCommand } = await import('../src/commands/stack.js');
    await keyAddCommand('groq', {}, pipe(`${KEY}\n`));
    await stackUseCommand('openai/gpt-oss-120b', 'groq', { context: '131072' });
    const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
    expect(config.stack.orchestrator).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
    expect(config.providers.groq.contextWindows).toEqual({ 'openai/gpt-oss-120b': 131072 });
    await stackUseCommand('m', 'groq', { context: '128k' });
    expect(process.exitCode).toBe(1);
    expect(printed).toMatch(/whole number/);
  });

  it('takes no key on the command line', () => {
    const cli = readFileSync(join(__dirname, '..', 'bin', 'osc.ts'), 'utf8');
    const from = cli.indexOf(".command('add')");
    const add = cli.slice(from, cli.indexOf(".command('list'", from));
    expect(add).toContain(".argument('<provider>'");
    expect(add).not.toMatch(/argument\('<key>|option\('--key/);
  });
});
