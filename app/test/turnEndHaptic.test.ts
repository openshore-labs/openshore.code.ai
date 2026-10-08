// The success tap at a turn's end (image reading follow-up, 2026-10-08). A
// turn whose only result is the image offer (nothing here could read the
// picture) ends complete, a calm reply, but it answered nothing, so it ends
// without the success haptic; a turn that answered keeps it, an answer
// followed by the offer included. The rule is state/turnEndOps.ts, read
// against the Stack driver's own event stream, and the store's one success
// tap at a turn's end asks it first, through lib/haptics.ts.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverEvent } from 'os-code/protocol';

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async () => ({ started: true }),
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  // No key anywhere: nothing here can read a picture.
  secretGet: async () => null,
  storeGetJson: async () => null,
}));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { harborRef } = await import('../src/lib/stack.js');
const { NOTHING_SHOWN, celebratesTurn, turnShown } = await import('../src/state/turnEndOps.js');

/** Every tap a turn's events would earn, folded the way the store folds them. */
function taps(events: DriverEvent[]): number {
  let shown = NOTHING_SHOWN;
  let n = 0;
  for (const e of events) {
    shown = turnShown(shown, e);
    if (celebratesTurn(shown, e)) n++;
  }
  return n;
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('the success tap', () => {
  it('stays quiet on a turn whose only result is the image offer', async () => {
    const driver = new StackDriver({ reasoning: harborRef(), active: [], saved: {} }, 'offshore');
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    driver.send('Who is this?', [
      {
        id: 'a1',
        name: 'jimi.jpg',
        mime: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,AAAA',
        isImage: true,
      },
    ]);
    await settle();
    // The turn really is the offer alone, ended complete.
    expect(events.some((e) => e.type === 'image-reader-offer')).toBe(true);
    expect(events.findLast((e) => e.type === 'task-done')).toMatchObject({ reason: 'complete' });
    expect(taps(events)).toBe(0);
    driver.dispose();
  });

  it('taps for a turn that answered, and for an answer the offer follows', () => {
    const answer: DriverEvent[] = [
      { type: 'task-start', input: 'Hi' },
      { type: 'text-delta', text: 'Hello.' },
      { type: 'text-final', text: 'Hello.' },
      { type: 'task-done', reason: 'complete' },
    ];
    expect(taps(answer)).toBe(1);
    // A play whose image step ran on the text: its answer, then the offer.
    const play: DriverEvent[] = [
      { type: 'task-start', input: 'Explain the chart' },
      { type: 'text-final', text: 'Here is the chart, explained.' },
      { type: 'image-reader-offer', from: 'play', cloud: 'none' },
      { type: 'task-done', reason: 'complete' },
    ];
    expect(taps(play)).toBe(1);
  });

  it('starts each task clean, so an offer never quiets the next answer', () => {
    const events: DriverEvent[] = [
      { type: 'task-start', input: 'Who is this?' },
      { type: 'text-final', text: '' },
      { type: 'image-reader-offer', from: 'image', cloud: 'none' },
      { type: 'task-done', reason: 'complete' },
      { type: 'task-start', input: 'Then just say hi' },
      { type: 'text-final', text: 'Hi.' },
      { type: 'task-done', reason: 'complete' },
    ];
    expect(taps(events)).toBe(1);
  });

  it('never taps on a stop, a decline or an error', () => {
    for (const reason of ['aborted', 'declined', 'error'] as const) {
      expect(
        taps([
          { type: 'task-start', input: 'x' },
          { type: 'text-final', text: 'part' },
          { type: 'task-done', reason },
        ]),
      ).toBe(0);
    }
  });

  it("is the store's only gate on the turn-end tap", () => {
    const store = readFileSync(join(process.cwd(), 'src', 'state', 'store.ts'), 'utf8');
    const calls = [...store.matchAll(/hapticSuccess\(\)/g)];
    expect(calls).toHaveLength(1);
    const before = store.slice(Math.max(0, calls[0]!.index! - 300), calls[0]!.index!);
    expect(before).toMatch(/celebratesTurn\(shown, event\)/);
    expect(before).toMatch(/shown = turnShown\(shown, event\)/);
  });
});
