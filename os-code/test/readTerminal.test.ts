// The readTerminal tool: it must strip ANSI, redact secrets, and cap length
// before the model ever sees the terminal, and degrade cleanly when there is no
// terminal on the session. A stub ctx.terminal accessor stands in for the ring
// buffer, so this needs no pty and no daemon.
import { describe, expect, it } from 'vitest';
import { cleanTerminalOutput, readTerminalTool } from '../src/core/tools/readTerminal.js';
import type { ToolContext } from '../src/core/tools/index.js';

function ctxWith(terminal?: ToolContext['terminal']): ToolContext {
  // Only `terminal` matters to this tool; the rest is never touched.
  return { terminal } as unknown as ToolContext;
}

describe('cleanTerminalOutput', () => {
  it('strips ANSI color and cursor sequences', () => {
    const raw = '\x1b[32mgreen\x1b[0m and \x1b[2K\x1b[1Gcleared';
    expect(cleanTerminalOutput(raw)).toBe('green and cleared');
  });

  it('redacts secrets in the output', () => {
    const raw = 'export ANTHROPIC_API_KEY=sk-ant-abcdef0123456789abcdef0123456789\n';
    const cleaned = cleanTerminalOutput(raw);
    expect(cleaned).not.toContain('sk-ant-abcdef0123456789abcdef0123456789');
  });

  it('caps very long output', () => {
    const raw = 'x'.repeat(50_000);
    const cleaned = cleanTerminalOutput(raw);
    expect(cleaned.length).toBeLessThan(raw.length);
    expect(cleaned).toContain('characters trimmed');
  });
});

describe('readTerminalTool', () => {
  it('returns cleaned terminal output through the accessor', async () => {
    const ctx = ctxWith(() => '\x1b[31mbuild failed\x1b[0m\nerror: TS2304');
    const out = await readTerminalTool.execute({}, ctx);
    expect(out.ok).toBe(true);
    expect(out.content).toContain('build failed');
    expect(out.content).toContain('TS2304');
    expect(out.content).not.toContain('\x1b');
  });

  it('degrades to a clear message when no terminal accessor is wired', async () => {
    const out = await readTerminalTool.execute({}, ctxWith(undefined));
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/no interactive terminal/i);
  });

  it('reports when the session has no open terminal (accessor returns undefined)', async () => {
    const out = await readTerminalTool.execute(
      {},
      ctxWith(() => undefined),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/no terminal is open/i);
  });

  it('passes the requested line count and termId to the accessor', async () => {
    let seen: { lines: number; termId?: string } | undefined;
    const ctx = ctxWith((lines, termId) => {
      seen = { lines, termId };
      return 'ok';
    });
    await readTerminalTool.execute({ lines: 50, termId: 'abc123' }, ctx);
    expect(seen).toEqual({ lines: 50, termId: 'abc123' });
  });
});
