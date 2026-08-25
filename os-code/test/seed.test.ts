// TS-P1-3 / TS-P2-6: rebuilding chat history and clearing zombie approvals from
// a session's journaled events when the daemon rehydrates it after a restart.
import { describe, expect, it } from 'vitest';
import type { DriverEvent } from '../src/core/agent/types.js';
import { seedHistoryFromEvents, unresolvedApprovalIds } from '../src/core/agent/seed.js';

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
