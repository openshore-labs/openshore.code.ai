// The engine's handoff store and the desktop agent's seed (Vault M5, CTO J12,
// J13): the latest handoff per owner, workspace and project, sealed at rest,
// read back only while it is at most seven days old, and cleared with the
// chats; the adapter from engine history never carries thinking or a
// local-only message; a session created with a handoff opens its first task
// with it, and only its first.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearHandoffs,
  deleteHandoff,
  handoffKey,
  handoffTurnsFromHistory,
  handoffsDir,
  readHandoff,
  writeHandoff,
  type HandoffRecord,
} from '../src/core/agent/handoffStore.js';
import { _resetDataKeyCache } from '../src/core/security/atRest.js';
import { LocalDriver } from '../src/daemon/session.js';
import { bootstrapSession } from '../src/core/agent/bootstrap.js';
import { HANDOFF_MAX_BYTES } from '../src/harness/handoff.js';
import type { AgentSession } from '../src/core/agent/loop.js';
import type { ChatMessage } from '../src/providers/types.js';

let home: string;
let cwd: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'osc-handoff-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'osc-handoff-repo-'));
  previousHome = process.env.OSC_HOME;
  process.env.OSC_HOME = home;
  _resetDataKeyCache();
});
afterEach(() => {
  process.env.OSC_HOME = previousHome;
  _resetDataKeyCache();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const record = (
  at: Date,
  text = 'HANDOFF from m, 2026-09-27. Goal: SECRET-GOAL',
): HandoffRecord => ({
  text,
  at: at.toISOString(),
  model: 'qwen2.5-coder:7b',
  turns: 6,
});

describe('the handoff store', () => {
  it('keys by owner, real workspace path and project', () => {
    const base = handoffKey({ cwd, projectName: 'Atlas' });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(handoffKey({ cwd, projectName: 'Atlas' })).toBe(base);
    expect(handoffKey({ owner: 'member-1', cwd, projectName: 'Atlas' })).not.toBe(base);
    expect(handoffKey({ cwd, projectName: 'Other' })).not.toBe(base);
    // A symlink to the same folder is the same workspace.
    const link = join(home, 'link');
    symlinkSync(cwd, link);
    expect(handoffKey({ cwd: link, projectName: 'Atlas' })).toBe(base);
  });

  it('writes the latest only, sealed at rest, and reads it back', () => {
    const scope = { cwd, projectName: 'Atlas' };
    const now = new Date('2026-09-27T12:00:00Z');
    expect(writeHandoff(scope, record(now, 'first'))).toBe(true);
    expect(writeHandoff(scope, record(now))).toBe(true);
    const files = readdirSync(handoffsDir());
    expect(files).toEqual([`${handoffKey(scope)}.json`]);
    const raw = readFileSync(join(handoffsDir(), files[0]!), 'utf8');
    expect(raw).not.toContain('SECRET-GOAL');
    expect(readHandoff(scope, { now })).toEqual(record(now));
    // Another owner's scope sees nothing.
    expect(readHandoff({ ...scope, owner: 'someone' }, { now })).toBeUndefined();
  });

  it('redacts a secret before it is stored', () => {
    const scope = { cwd };
    const now = new Date();
    writeHandoff(
      scope,
      record(now, 'Decisions: use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'),
    );
    expect(readHandoff(scope, { now })!.text).not.toContain('abcdefghijklmnop');
  });

  it('is read only while at most seven days old', () => {
    const scope = { cwd, projectName: 'Atlas' };
    const at = new Date('2026-09-20T12:00:00Z');
    writeHandoff(scope, record(at));
    expect(readHandoff(scope, { now: new Date('2026-09-27T12:00:00Z') })).toBeDefined();
    expect(readHandoff(scope, { now: new Date('2026-09-27T12:00:01Z') })).toBeUndefined();
    // A stamp from well in the future is not trusted either.
    expect(readHandoff(scope, { now: new Date('2026-09-19T12:00:00Z') })).toBeUndefined();
  });

  it('is cleared with the chats, and one scope can be removed', () => {
    const a = { cwd, projectName: 'A' };
    const b = { cwd, projectName: 'B' };
    const now = new Date();
    writeHandoff(a, record(now));
    writeHandoff(b, record(now));
    deleteHandoff(a);
    expect(readHandoff(a, { now })).toBeUndefined();
    expect(readHandoff(b, { now })).toBeDefined();
    clearHandoffs();
    expect(existsSync(handoffsDir())).toBe(false);
    expect(readHandoff(b, { now })).toBeUndefined();
  });
});

describe('the adapter from engine history', () => {
  it('drops thinking, local-only messages, tool results and harness prompts; keeps paths', () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM-PROMPT' },
      { role: 'user', content: 'Fix the parser' },
      {
        role: 'assistant',
        content: '<think>THOUGHT</think>Reading it.',
        thinkingBlocks: [{ type: 'thinking', thinking: 'BLOCK-THOUGHT' }],
        toolCalls: [
          { id: 'c1', name: 'readFile', argsText: '{"path":"src/parser.ts"}' },
          { id: 'c2', name: 'editFile', argsText: '', args: { path: 'src/lexer.ts', search: 'a' } },
        ],
      },
      { role: 'tool', content: 'FILE-BODY', toolCallId: 'c1', name: 'readFile' },
      { role: 'user', content: '[readFile result]\nFILE-BODY-TEXT' },
      { role: 'user', content: 'Your last tool call could not be used.\n- bad' },
      { role: 'user', content: '[verify result]\nfailed' },
      { role: 'tool', content: 'PRIVATE', toolCallId: 'c3', localOnly: true },
      { role: 'assistant', content: 'PRIVATE-QUOTE', localOnly: true },
      {
        role: 'user',
        content: '[Conversation so far, summarized to fit the context window]\nEarlier: X',
      },
      { role: 'assistant', content: 'Decided: going with a table. Next, run the tests.' },
    ];
    expect(handoffTurnsFromHistory(history)).toEqual([
      { role: 'user', text: 'Fix the parser' },
      { role: 'assistant', text: 'Reading it.' },
      { role: 'tool', text: '', tool: 'readFile', paths: ['src/parser.ts'] },
      { role: 'tool', text: '', tool: 'editFile', paths: ['src/lexer.ts'] },
      { role: 'assistant', text: 'Earlier: X' },
      { role: 'assistant', text: 'Decided: going with a table. Next, run the tests.' },
    ]);
  });
});

/** A stand-in agent that records what each task was run with. */
function recordingAgent(calls: Array<{ input: string; preamble?: string }>): AgentSession {
  return {
    async run(input: string, _images?: unknown, preamble?: string) {
      calls.push({ input, preamble });
    },
    generateTitle: async () => undefined,
    flushHandoff: () => undefined,
  } as unknown as AgentSession;
}

async function settle(driver: LocalDriver): Promise<void> {
  for (let i = 0; i < 50 && !driver.idle; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 5));
}

describe('the desktop agent is seedable (J12)', () => {
  it('opens the first task with the handoff, and only the first', async () => {
    const driver = new LocalDriver(cwd, { persist: false, handoff: 'HANDOFF from Claude.' });
    const calls: Array<{ input: string; preamble?: string }> = [];
    driver.attachAgent(recordingAgent(calls));
    driver.send('carry on');
    await settle(driver);
    driver.send('and then');
    await settle(driver);
    expect(calls).toEqual([
      { input: 'carry on', preamble: 'HANDOFF from Claude.' },
      { input: 'and then', preamble: undefined },
    ]);
  });

  it('a dispose asks the agent for its last handoff', () => {
    const driver = new LocalDriver(cwd, { persist: false });
    let flushed = 0;
    driver.attachAgent({ flushHandoff: () => (flushed += 1) } as unknown as AgentSession);
    driver.dispose();
    expect(flushed).toBe(1);
  });

  it('bootstrap carries a handoff even with Memory off, and refuses one over the cap', async () => {
    const config = (await import('../src/config/schema.js')).ConfigSchema.parse({
      stack: { orchestrator: { provider: 'ollama', model: 'qwen' } },
    });
    const boot = (handoff: string, memory?: boolean) =>
      bootstrapSession({
        cwd,
        profile: 'local-interactive',
        persist: false,
        config,
        handoff,
        memory,
      });
    const seeded = boot('HANDOFF from Claude.', false);
    expect((seeded.driver as unknown as { handoff?: string }).handoff).toBe('HANDOFF from Claude.');
    // Memory off also stops the engine's own handoff writes.
    expect((seeded.agent as unknown as { deps: { onHandoff?: unknown } }).deps.onHandoff).toBe(
      undefined,
    );
    const big = boot('x'.repeat(HANDOFF_MAX_BYTES + 1));
    expect((big.driver as unknown as { handoff?: string }).handoff).toBeUndefined();
    expect(big.warnings.some((w) => /too long to carry/.test(w))).toBe(true);
    expect((big.agent as unknown as { deps: { onHandoff?: unknown } }).deps.onHandoff).toBeTypeOf(
      'function',
    );
  });
});
