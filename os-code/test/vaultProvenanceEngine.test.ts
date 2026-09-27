// Vault M7 stream C: provenance on the notes the engine writes (CTO L9, L10).
// The merge is stream B's; until it lands in this tree its stub throws, so a
// small stand-in merge answers here. What these tests prove is the engine's
// wiring: the lines are merged BEFORE the diff, execute writes the very bytes
// the preview showed, an edit reads as `agent-edit`, `vault.provenance: off`
// writes none, and a Crew run note carries `crew`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriverEvent } from '../src/core/agent/types.js';
import type { ToolContext } from '../src/core/tools/index.js';
import { vaultWriteTool } from '../src/core/tools/vault.js';
import { closeEngineVaultIndexes } from '../src/core/vault/engineIndex.js';
import { RoutineScheduler, _resetRoutineScheduler } from '../src/routines/scheduler.js';
import type { RoutineDriver } from '../src/routines/scheduler.js';
import * as store from '../src/routines/store.js';
import type { RoutineSchedule } from '../src/routines/model.js';

vi.mock('../src/harness/vault/provenance.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/harness/vault/provenance.js')>();
  const merge = (text: string, fields: Record<string, string | null>) => {
    const set = Object.entries(fields).filter(([, v]) => v !== null);
    const lines = set.map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    if (text.startsWith('---\n')) {
      const end = text.indexOf('\n---', 3);
      const kept = text
        .slice(4, end)
        .split('\n')
        .filter((l) => l && !Object.keys(fields).some((k) => l.startsWith(`${k}:`)));
      return { text: `---\n${[...kept, ...lines].join('\n')}${text.slice(end)}` };
    }
    return { text: `---\n${lines.join('\n')}\n---\n${text}` };
  };
  return {
    ...real,
    mergeProvenance: vi.fn(merge),
    readProvenance: (fm: { props: Array<{ key: string; value: unknown }> }) => {
      const source = fm.props.find((p) => p.key === 'oscode-source')?.value;
      return typeof source === 'string' ? { source } : {};
    },
  };
});

let root: string;

function ctx(provenance: 'on' | 'off' = 'on', leaves = false): ToolContext {
  return {
    vaultRoot: root,
    config: { vault: { provenance } },
    seatLeavesNetwork: () => leaves,
    vaultSeat: () => ({ model: 'qwen2.5:7b', size: 'small', provider: 'anthropic' }),
  } as unknown as ToolContext;
}

const args = (path: string, content: string) => ({ path, content, mode: 'replace' as const });

describe('provenance on an agent note (L9, L10)', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'osc-m7c-prov-'));
  });
  afterEach(async () => {
    await closeEngineVaultIndexes();
    rmSync(root, { recursive: true, force: true });
  });

  it('merges before the diff, and writes exactly the bytes the preview showed', async () => {
    const preview = await vaultWriteTool.preview!(args('Plan.md', '# Plan\n'), ctx());
    expect(preview.detail).toContain('oscode-source: "agent"');
    expect(preview.detail).toContain('oscode-model: "qwen2.5:7b"');
    expect(preview.detail).toContain('oscode-where: "local"');
    expect(preview.detail).not.toContain('oscode-provider');
    const created = /oscode-created: "([^"]+)"/.exec(preview.detail!)![1]!;
    await new Promise((r) => setTimeout(r, 5));
    const out = await vaultWriteTool.execute(args('Plan.md', '# Plan\n'), ctx(), {
      basis: preview.basis,
    });
    expect(out.ok).toBe(true);
    const text = readFileSync(join(root, 'Plan.md'), 'utf8');
    expect(text).toContain(`oscode-created: "${created}"`);
    expect(text.endsWith('# Plan\n')).toBe(true);
  });

  it('names the provider only for a cloud seat', async () => {
    const preview = await vaultWriteTool.preview!(args('C.md', 'x'), ctx('on', true));
    expect(preview.detail).toContain('oscode-where: "cloud"');
    expect(preview.detail).toContain('oscode-provider: "anthropic"');
  });

  it("writes agent-edit on the person's note, and keeps agent on its own", async () => {
    writeFileSync(join(root, 'Mine.md'), '---\ntitle: mine\n---\nhello\n');
    await vaultWriteTool.execute(args('Mine.md', '---\ntitle: mine\n---\nhello again\n'), ctx());
    const mine = readFileSync(join(root, 'Mine.md'), 'utf8');
    expect(mine).toContain('oscode-source: "agent-edit"');
    expect(mine).not.toContain('oscode-created');

    await vaultWriteTool.execute(args('Own.md', 'one\n'), ctx());
    const first = readFileSync(join(root, 'Own.md'), 'utf8');
    await vaultWriteTool.execute(args('Own.md', `${first}two\n`), ctx());
    expect(readFileSync(join(root, 'Own.md'), 'utf8')).toContain('oscode-source: "agent"');
  });

  it('writes nothing extra with vault.provenance off, or with no config', async () => {
    await vaultWriteTool.execute(args('Off.md', 'plain\n'), ctx('off'));
    expect(readFileSync(join(root, 'Off.md'), 'utf8')).toBe('plain\n');
    const bare = { vaultRoot: root } as unknown as ToolContext;
    await vaultWriteTool.execute(args('Bare.md', 'plain\n'), bare);
    expect(readFileSync(join(root, 'Bare.md'), 'utf8')).toBe('plain\n');
  });
});

class FakeDriver implements RoutineDriver {
  readonly id = `prov${Math.random().toString(16).slice(2, 8)}`;
  private listeners = new Set<(e: DriverEvent, seq: number) => void>();
  send(): void {}
  abort(): void {}
  onEvent(l: (e: DriverEvent, seq: number) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  answerApproval(): void {}
  emit(event: DriverEvent): void {
    for (const l of [...this.listeners]) l(event, 0);
  }
}

describe('provenance on a Crew run note (L9)', () => {
  let home: string;
  let workspace: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'osc-m7c-home-'));
    process.env.OSC_HOME = home;
    root = join(home, 'Vault');
    mkdirSync(root);
    workspace = mkdtempSync(join(tmpdir(), 'osc-m7c-ws-'));
    _resetRoutineScheduler();
  });
  afterEach(() => {
    _resetRoutineScheduler();
    delete process.env.OSC_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  function run(provenance: boolean): string {
    const routine = store.createRoutine({
      name: 'Morning review',
      agentName: 'Reviewer',
      persona: 'A calm reviewer.',
      task: 'Review.',
      cwd: workspace,
      schedule: { hour: 6, minute: 0, days: [] } as RoutineSchedule,
    });
    const drivers: FakeDriver[] = [];
    const scheduler = new RoutineScheduler({
      autostart: false,
      vaultRoot: () => root,
      allowedWorkspace: () => true,
      persistAllowedRoot: () => {},
      lock: { acquire: () => ({ pid: process.pid, startedAt: '' }), release: () => {} },
      provenance: () => provenance,
      openSession: () => {
        const driver = new FakeDriver();
        drivers.push(driver);
        return { driver, warnings: [], model: 'qwen2.5:7b', where: 'local' };
      },
    });
    scheduler.runNow(routine.id);
    drivers[0]!.emit({ type: 'text-final', text: 'All green.' });
    drivers[0]!.emit({ type: 'task-done', reason: 'complete' });
    const notePath = scheduler.get(routine.id)!.lastRun!.notePath!;
    return readFileSync(join(root, notePath), 'utf8');
  }

  it('stamps the run note as crew, with its model and where it ran', () => {
    const note = run(true);
    expect(note).toContain('oscode-source: "crew"');
    expect(note).toContain('oscode-model: "qwen2.5:7b"');
    expect(note).toContain('oscode-where: "local"');
    expect(note).toContain('oscode-created:');
    expect(note).toContain('All green.');
    expect(note).toContain('type: "crew-run"');
  });

  it('leaves it off when vault.provenance is off', () => {
    expect(run(false)).not.toContain('oscode-');
  });
});
