// The discipline seam wired into the loop: a small seat gets a lean prompt.
// harness.profiles is off in the test helper by default (so the rest of the
// suite carries the full prompt), and these tests turn it on and check what the
// model actually receives: fewer tools, a compact standards digest instead of
// the multi-KB text, and a one-time note. mid and large seats, and the off
// switch, keep the full prompt and every tool.
import { describe, it, expect } from 'vitest';
import { MockProvider, textTurn, type ScriptedTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import type { AgentEvent } from '../src/core/agent/types.js';
import type { ChatRequest } from '../src/providers/types.js';

// The mock model has no size hint and a 32k window, so it derives to the small
// class. A big window pushes it to mid; cloud is always large.
function runWith(
  turns: ScriptedTurn[],
  configOverrides: Record<string, unknown>,
  caps?: { contextTokens?: number },
  kind?: 'local' | 'cloud',
): Promise<{ requests: ChatRequest[]; events: AgentEvent[] }> {
  const provider = new MockProvider('mock', turns, { kind, caps });
  const session = makeTestSession(provider, { configOverrides });
  return session.agent.run('do the thing').then(() => ({
    requests: provider.requests,
    events: session.events,
  }));
}

const systemOf = (req: ChatRequest): string => {
  const s = req.messages.find((m) => m.role === 'system');
  return typeof s?.content === 'string' ? s.content : JSON.stringify(s?.content);
};

describe('the discipline seam in the loop: a small seat gets a lean prompt', () => {
  it('shows a small model only its profile allowance of tools, core-first', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const tools = requests[0]!.tools!;
    // small class: at most 10 tools shown.
    expect(tools.length).toBeLessThanOrEqual(10);
    const names = tools.map((t) => t.name);
    // The coding core survived the cut.
    expect(names).toContain('readFile');
    expect(names).toContain('editFile');
    expect(names).toContain('writeFile');
    expect(names).toContain('grep');
  });

  it('sends a compact digest, not the full UX and humanizer text, to a small seat', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const system = systemOf(requests[0]!);
    expect(system).toContain("OpenShore's premium bar");
    // The full multi-KB standards markers are absent.
    expect(system).not.toContain('UX STANDARD');
    expect(system).not.toContain("Hick's law");
  });

  it('gives a small seat a short, direct core instead of the full etiquette', async () => {
    // The full core tells a capable model to report like a colleague, ask
    // before touching working code, and open with todoWrite. A 3B reads those
    // as the task and explains or asks instead of editing. The lean core says:
    // do it, do not ask, answer briefly.
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const system = systemOf(requests[0]!);
    expect(system).toContain('Never ask for permission');
    expect(system).toContain('Workspace root:');
    expect(system).not.toContain('call todoWrite first');
    expect(system).not.toContain('blast radius');
    expect(system).not.toContain('propose one line for their standing instructions');
  });

  it('a full seat keeps the complete core', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: false } },
    });
    const system = systemOf(requests[0]!);
    expect(system).toContain('call todoWrite first');
    expect(system).toContain('blast radius');
    expect(system).not.toContain('Never ask for permission');
  });

  it('carries a project ux note into the lean digest', async () => {
    const { requests } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
      ux: { standard: 'premium', notes: 'Brand color is teal.' },
    });
    const system = systemOf(requests[0]!);
    expect(system).toContain('This project adds: Brand color is teal.');
  });

  it('says once, plainly, that a small seat is running with the harness', async () => {
    const { events } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: true } },
    });
    const notes = events.filter((e) => e.type === 'note') as Array<{ message: string }>;
    const seat = notes.filter((n) => /model seat/i.test(n.message));
    expect(seat).toHaveLength(1);
    expect(seat[0]!.message).toMatch(/tools/i);
  });

  it('a mid seat (big window) keeps every tool and the full standards', async () => {
    const { requests } = await runWith(
      [textTurn('done')],
      { harness: { profiles: { enabled: true } } },
      { contextTokens: 200_000 }, // a large window derives to mid when size is unknown
    );
    const tools = requests[0]!.tools!;
    expect(tools.length).toBeGreaterThan(10);
    expect(systemOf(requests[0]!)).toContain('UX STANDARD');
  });

  it('with profiles off, a small model still gets every tool and the full prompt', async () => {
    const { requests, events } = await runWith([textTurn('done')], {
      harness: { profiles: { enabled: false } },
    });
    expect(requests[0]!.tools!.length).toBeGreaterThan(10);
    expect(systemOf(requests[0]!)).toContain('UX STANDARD');
    const seat = (events.filter((e) => e.type === 'note') as Array<{ message: string }>).filter(
      (n) => /model seat/i.test(n.message),
    );
    expect(seat).toHaveLength(0);
  });

  it('is on by default in the engine config', async () => {
    // The test helper turns it off; the shipped default is on. Lock that here so
    // a schema change cannot silently ship the harness disabled.
    const { ConfigSchema } = await import('../src/config/schema.js');
    expect(ConfigSchema.parse({}).harness.profiles.enabled).toBe(true);
  });
});
