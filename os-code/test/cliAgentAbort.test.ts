// cliAgent honors Stop (review 5, defect 3.8): a paired CLI run is killed when
// the task's abort signal fires, instead of running on for up to its timeout
// after the person tapped Stop. A fake `claude` on PATH stands in for the CLI.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliAgentTool } from '../src/core/tools/cliAgent.js';
import { EgressPolicy } from '../src/core/security/egress.js';
import type { ToolContext } from '../src/core/tools/index.js';

let bin: string;
let savedPath: string | undefined;

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'osc-fake-cli-'));
  // A "claude" that prints a line, then sleeps well past the test.
  writeFileSync(join(bin, 'claude'), '#!/bin/bash\necho started\nsleep 20\necho never\n');
  chmodSync(join(bin, 'claude'), 0o755);
  savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${savedPath ?? ''}`;
});

afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(bin, { recursive: true, force: true });
});

function ctxWith(partial: Partial<ToolContext>): ToolContext {
  return {
    egress: new EgressPolicy({ webEnabled: true, allowlist: [], blocklist: [] }),
    cwd: bin,
    currents: { cli: { command: 'claude' } },
    ...partial,
  } as unknown as ToolContext;
}

describe('cliAgent and Stop', () => {
  it('kills the CLI when the task is aborted and says it was stopped', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = cliAgentTool.execute(
      { task: 'do the thing', timeoutSeconds: 30 },
      ctxWith({ signal: controller.signal }),
    );
    // Give the fake CLI a moment to print, then stop the task.
    await new Promise((r) => setTimeout(r, 300));
    controller.abort();
    const out = await pending;
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/was stopped/);
    expect(out.content).toContain('started');
    expect(out.content).not.toContain('never');
  });

  it('never starts the CLI when the task is already stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await cliAgentTool.execute(
      { task: 'do the thing' },
      ctxWith({ signal: controller.signal }),
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/not started/);
  });
});
