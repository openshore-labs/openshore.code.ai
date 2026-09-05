// The shared command runner: streams chunks live, reports the real exit code,
// redacts secrets per chunk, answers stdin, and kills a runaway on demand.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/core/exec/commandRunner.js';

function cwd(): string {
  return mkdtempSync(join(tmpdir(), 'oscmd-'));
}

describe('commandRunner', () => {
  it('streams stdout chunks and resolves with exit code 0', async () => {
    const dir = cwd();
    const chunks: string[] = [];
    const run = runCommand({
      command: 'printf "hello\\nworld\\n"',
      cwd: dir,
      onChunk: (stream, text) => {
        if (stream === 'stdout') chunks.push(text);
      },
    });
    const result = await run.done;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.stdout).toContain('world');
    expect(chunks.join('')).toContain('hello');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a non-zero exit code and stderr', async () => {
    const dir = cwd();
    const result = await runCommand({
      command: 'echo oops 1>&2; exit 3',
      cwd: dir,
    }).done;
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('oops');
    rmSync(dir, { recursive: true, force: true });
  });

  it('redacts a secret before it reaches a chunk', async () => {
    const dir = cwd();
    let seen = '';
    const result = await runCommand({
      // An OpenAI-style key the redactor recognizes.
      command: 'echo "token sk-abcdefghijklmnopqrstuvwxyz1234567890ABCD"',
      cwd: dir,
      onChunk: (_s, text) => (seen += text),
    }).done;
    expect(seen).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890ABCD');
    expect(result.stdout).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890ABCD');
    rmSync(dir, { recursive: true, force: true });
  });

  it('redacts a secret split across two chunks (ENG-10)', async () => {
    const dir = cwd();
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890ABCD';
    const head = secret.slice(0, 12);
    const tail = secret.slice(12);
    let seen = '';
    const result = await runCommand({
      // Two writes with a pause between them, so the key arrives in two chunks.
      command: `printf '%s' 'token ${head}'; sleep 0.05; printf '%s\\n' '${tail} end'`,
      cwd: dir,
      onChunk: (_s, text) => (seen += text),
    }).done;
    expect(result.exitCode).toBe(0);
    expect(seen).not.toContain(secret);
    expect(seen).toContain('[redacted:');
    expect(seen).toContain('end');
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).toContain('end');
    rmSync(dir, { recursive: true, force: true });
  });

  it('flushes a held tail while the process waits, so a prompt stays visible', async () => {
    const dir = cwd();
    let seen = '';
    const run = runCommand({
      command: 'printf "Continue? "; read -r line; echo "got:$line"',
      cwd: dir,
      stdin: 'pipe',
      onChunk: (_s, text) => (seen += text),
    });
    // The prompt is shorter than the carry; it must still arrive on its own.
    const start = Date.now();
    while (!seen.includes('Continue?')) {
      if (Date.now() - start > 2000) throw new Error('prompt never arrived');
      await new Promise((r) => setTimeout(r, 5));
    }
    run.write('yes\n');
    const result = await run.done;
    expect(result.stdout).toContain('got:yes');
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers stdin so an interactive read completes', async () => {
    const dir = cwd();
    const run = runCommand({
      command: 'read -r line; echo "got:$line"',
      cwd: dir,
      stdin: 'pipe',
    });
    run.write('yes\n');
    const result = await run.done;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('got:yes');
    rmSync(dir, { recursive: true, force: true });
  });

  it('kills a long-running process on demand', async () => {
    const dir = cwd();
    const run = runCommand({
      command: 'sleep 30',
      cwd: dir,
      killGraceMs: 50,
    });
    setTimeout(() => run.kill(), 50);
    const result = await run.done;
    // Killed: not a clean exit 0.
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('times out and kills when a timeout is set', async () => {
    const dir = cwd();
    const result = await runCommand({
      command: 'sleep 30',
      cwd: dir,
      timeoutMs: 100,
      killGraceMs: 50,
    }).done;
    expect(result.timedOut).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
