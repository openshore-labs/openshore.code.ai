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
