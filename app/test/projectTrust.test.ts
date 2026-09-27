// Project trust in the app: a folder's own os-code.config.json asks for
// settings that stay off until the person trusts the folder on that computer.
// The engine says so once with a project-trust event; the chat shows one card
// with one decision; trusting folds the card on every device, because the
// engine echoes the trust back into the session.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { reduceEvent, reduceEvents } from '../src/state/transcript.js';
import { emptyThread } from '../src/state/types.js';
import { guardDriver } from '../src/drivers/guardedDriver.js';
import type { ChatDriver, DriverEventSink } from '../src/drivers/types.js';

const asking: DriverEvent = {
  type: 'project-trust',
  state: 'untrusted',
  folder: '/home/me/OSCode/app',
  waiting: ["runs `npm test` to check the agent's work after changes"],
};

describe('the trust card', () => {
  it('arrives once, with what the folder asks for', () => {
    const thread = reduceEvents(emptyThread(), [{ event: asking }]);
    const cards = thread.items.filter((i) => i.kind === 'trust');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: 'trust',
      state: 'untrusted',
      waiting: ["runs `npm test` to check the agent's work after changes"],
    });
  });

  it('folds to trusted when the engine echoes the trust', () => {
    const thread = reduceEvents(emptyThread(), [
      { event: asking },
      {
        event: {
          type: 'project-trust',
          state: 'trusted',
          folder: '/home/me/OSCode/app',
          waiting: [],
        },
      },
    ]);
    const card = thread.items.find((i) => i.kind === 'trust');
    expect(card).toMatchObject({ state: 'trusted' });
  });

  it('a trust with no card on screen (trusted from the CLI) leaves one plain note', () => {
    const thread = reduceEvent(emptyThread(), {
      type: 'project-trust',
      state: 'trusted',
      folder: '/home/me/OSCode/app',
      waiting: [],
    });
    expect(thread.items.map((i) => i.kind)).toEqual(['note']);
  });
});

class FakeDriver implements ChatDriver {
  readonly kind = 'desktop' as const;
  trusted = 0;
  send(): void {}
  abort(): void {}
  answerApproval(): void {}
  subscribe(_sink: DriverEventSink): () => void {
    return () => {};
  }
  dispose(): void {}
  async trustFolder(): Promise<{ ok: true; folder: string }> {
    this.trusted += 1;
    return { ok: true, folder: '/home/me/OSCode/app' };
  }
}

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
});

describe('the ethics wrapper passes trust through', () => {
  it('reaches the engine driver underneath', async () => {
    const inner = new FakeDriver();
    const guarded = guardDriver(inner);
    expect(typeof guarded.trustFolder).toBe('function');
    await expect(guarded.trustFolder!()).resolves.toEqual({
      ok: true,
      folder: '/home/me/OSCode/app',
    });
    expect(inner.trusted).toBe(1);
  });
});
