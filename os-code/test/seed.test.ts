// TS-P1-3 / TS-P2-6: rebuilding chat history and clearing zombie approvals from
// a session's journaled events when the daemon rehydrates it after a restart.
import { describe, expect, it } from 'vitest';
import type { DriverEvent } from '../src/core/agent/types.js';
import { seedHistoryFromEvents, unresolvedApprovalIds } from '../src/core/agent/seed.js';
import { LOCAL_ONLY_STUB, withholdLocalOnly } from '../src/harness/vault/privacy.js';

describe('seedHistoryFromEvents (TS-P1-3)', () => {
  it('pairs each task-start with the following text-final', () => {
    const events: DriverEvent[] = [
      { type: 'task-start', input: 'fix the bug' },
      { type: 'text-final', text: 'Fixed it in foo.ts.' },
      { type: 'task-start', input: 'now the other file' },
      { type: 'text-final', text: 'Done in bar.ts.' },
    ];
    expect(seedHistoryFromEvents(events)).toEqual([
      { role: 'user', content: 'fix the bug' },
      { role: 'assistant', content: 'Fixed it in foo.ts.' },
      { role: 'user', content: 'now the other file' },
      { role: 'assistant', content: 'Done in bar.ts.' },
    ]);
  });

  it('keeps a user turn that never got a final answer', () => {
    const events: DriverEvent[] = [
      { type: 'task-start', input: 'do a thing' },
      { type: 'task-done', reason: 'aborted' },
    ];
    expect(seedHistoryFromEvents(events)).toEqual([{ role: 'user', content: 'do a thing' }]);
  });

  it('skips an empty final answer', () => {
    const events: DriverEvent[] = [
      { type: 'task-start', input: 'hi' },
      { type: 'text-final', text: '   ' },
    ];
    expect(seedHistoryFromEvents(events)).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

describe('unresolvedApprovalIds (TS-P2-6)', () => {
  it('returns approvals with no matching resolution', () => {
    const req = (id: string): DriverEvent => ({
      type: 'approval-request',
      request: { id, kind: 'tool', toolName: 'runShell', risk: 'shell', summary: 's', detail: 'd' },
    });
    const events: DriverEvent[] = [
      req('a'),
      { type: 'approval-resolved', id: 'a', approved: true },
      req('b'),
    ];
    expect(unresolvedApprovalIds(events)).toEqual(['b']);
  });

  it('returns nothing when every approval was resolved', () => {
    const req = (id: string): DriverEvent => ({
      type: 'approval-request',
      request: { id, kind: 'tool', toolName: 'runShell', risk: 'shell', summary: 's', detail: 'd' },
    });
    const events: DriverEvent[] = [
      req('a'),
      { type: 'approval-resolved', id: 'a', approved: false },
    ];
    expect(unresolvedApprovalIds(events)).toEqual([]);
  });
});

// Vault M4 (CTO I5): a daemon restart must not unprotect a private note. The
// tool results are not seeded, but a reply written after a local-only read
// may quote the note, so it comes back marked and a leaving seat gets a stub.
describe('seedHistoryFromEvents keeps the local-only mark (Vault M4)', () => {
  const PRIVATE = 'the salary figure is 123';
  const events: DriverEvent[] = [
    { type: 'task-start', input: 'what did I note about pay?' },
    { type: 'text-final', text: 'Let me look in your vault.' },
    {
      type: 'tool-end',
      call: { id: 'c1', name: 'vaultRead', args: { path: 'Private/pay.md' } },
      result: { ok: true, content: PRIVATE, localOnly: true },
      durationMs: 3,
    },
    { type: 'text-final', text: `Your note says ${PRIVATE}.` },
    { type: 'task-start', input: 'and the weather?' },
    {
      type: 'tool-end',
      call: { id: 'c2', name: 'vaultRead', args: { path: 'Notes/weather.md' } },
      result: { ok: true, content: 'sunny' },
      durationMs: 3,
    },
    { type: 'text-final', text: 'Sunny.' },
  ];

  it('marks only the replies after a local-only read, within that task', () => {
    const seeded = seedHistoryFromEvents(events);
    expect(seeded).toEqual([
      { role: 'user', content: 'what did I note about pay?' },
      { role: 'assistant', content: 'Let me look in your vault.' },
      { role: 'assistant', content: `Your note says ${PRIVATE}.`, localOnly: true },
      { role: 'user', content: 'and the weather?' },
      { role: 'assistant', content: 'Sunny.' },
    ]);
  });

  it('a leaving seat after the restart gets the stub, never the note', () => {
    const sent = withholdLocalOnly(seedHistoryFromEvents(events));
    expect(JSON.stringify(sent)).not.toContain(PRIVATE);
    expect(sent[2]!.content).toBe(LOCAL_ONLY_STUB);
    expect(sent[4]!.content).toBe('Sunny.');
  });
});

// D5 (privacy review 2026-10-08, engine-routing-1): the loop marks a reply a
// seat on this network wrote while the chat held a local-only note, or that a
// pack carrying one grounded; a restart rebuilds the same marks.
describe('seedHistoryFromEvents rebuilds the loop marks after a restart', () => {
  const NOTE = 'the journal says 4410';
  const turn = (providerKind: 'local' | 'cloud'): DriverEvent => ({
    type: 'turn-start',
    turn: 1,
    model: providerKind === 'local' ? 'qwen3:4b' : 'claude-sonnet-5',
    providerKind,
  });
  const read: DriverEvent = {
    type: 'tool-end',
    call: { id: 'c1', name: 'vaultRead', args: { path: 'Journal/today.md' } },
    result: { ok: true, content: NOTE, localOnly: true },
    durationMs: 3,
  };

  it('a later local reply in a chat that holds a marked one stays marked; a cloud one does not', () => {
    const events: DriverEvent[] = [
      { type: 'task-start', input: 'read my journal' },
      turn('local'),
      read,
      turn('local'),
      { type: 'text-final', text: `It says ${NOTE}.` },
      { type: 'task-start', input: 'say it again' },
      turn('local'),
      { type: 'text-final', text: `Again, ${NOTE}.` },
      { type: 'task-start', input: 'now online' },
      turn('cloud'),
      { type: 'text-final', text: 'A cloud answer.' },
    ];
    const seeded = seedHistoryFromEvents(events);
    expect(seeded.filter((m) => m.role === 'assistant').map((m) => m.localOnly)).toEqual([
      true,
      true,
      undefined,
    ]);
    expect(JSON.stringify(withholdLocalOnly(seeded))).not.toContain(NOTE);
  });

  it('a read in a task that wrote no reply still marks a later local reply', () => {
    // The loop keeps the read's result in its history after a stopped task,
    // so its next local reply is marked; the restart must agree.
    const events: DriverEvent[] = [
      { type: 'task-start', input: 'read my journal' },
      turn('local'),
      read,
      { type: 'task-done', reason: 'aborted', message: 'Stopped at your request.' },
      { type: 'task-start', input: 'what did it say?' },
      turn('local'),
      { type: 'text-final', text: `It said ${NOTE}.` },
    ];
    const seeded = seedHistoryFromEvents(events);
    expect(seeded.at(-1)).toMatchObject({ content: `It said ${NOTE}.`, localOnly: true });
    expect(JSON.stringify(withholdLocalOnly(seeded))).not.toContain(NOTE);
  });

  it('a reply grounded in a pack that carried a local-only note is marked', () => {
    const events: DriverEvent[] = [
      { type: 'task-start', input: 'what is the plan?' },
      turn('local'),
      {
        type: 'context-pack',
        seat: 'local',
        mode: 'current-state',
        tokens: 40,
        budgetTokens: 800,
        sources: [{ layer: 'pin', path: 'Private/plan.md', title: 'plan', project: true }],
        withheld: 0,
        cold: false,
        localOnly: true,
      },
      { type: 'text-final', text: 'The plan says 7731.' },
    ];
    expect(seedHistoryFromEvents(events).at(-1)).toMatchObject({ localOnly: true });
  });
});
