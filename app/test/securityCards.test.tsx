// The security package's two transcript cards (D3 and C1), mounted in a real
// (small) DOM: the secrets safety card (CX 7) says why it asks on every card
// while the lockdown is on, lists a commit's files with the flagged ones
// unticked, warns on ticking one (naming the platform only when the commit
// pushes), and answers with the ticked list; the truncated window card (CX 6)
// renders each room variant with its exact words, and its button calls
// through the store to the driver.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalRequest, CommitStage, DriverEvent } from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';
import {
  LOCKDOWN_LINE,
  MORE_ROOM_ACTION,
  NO_ROOM_LINE,
  OPEN_STACK,
  SECRET_PILL,
  SECRET_REASON,
  WINDOW_CUT_BODY,
  flaggedLine,
  moreRoomCost,
  moreRoomGiven,
  tickedWarning,
  windowCutTitle,
} from '../src/lib/securityCopy.js';
import type { ThreadItem, ThreadState } from '../src/state/types.js';

type Answer = { approve: boolean; always?: boolean; inProject?: boolean; files?: string[] };

let dom: TestDom;
let answers: Answer[];

beforeEach(async () => {
  dom = await mountDom();
  answers = [];
});

afterEach(async () => {
  await dom.unmount();
});

/** `total` 2 keeps the sheet up, so an answer lands at once rather than
 *  after the exit plays. */
async function showApproval(request: ApprovalRequest, total = 1) {
  const { ApprovalSheet } = await import('../src/components/ApprovalSheet.js');
  await dom.render(
    <ApprovalSheet
      request={request}
      index={0}
      total={total}
      agent
      mode="default"
      onAnswer={(approve, always, inProject, files) =>
        answers.push({ approve, always, inProject, files })
      }
      onAnswerAll={() => {}}
      onOpenMode={() => {}}
    />,
  );
}

async function press(key: string) {
  const { act } = await import('react');
  await act(async () => {
    const event = new window.Event('keydown') as Event & { key: string };
    Object.assign(event, { key });
    window.dispatchEvent(event);
  });
}

/** The checkbox on the row for this path. */
function box(path: string): HTMLInputElement {
  const row = [...dom.container.querySelectorAll('.commit-file')].find(
    (li) => li.querySelector('.commit-file-path')?.textContent === path,
  );
  const input = row?.querySelector('input') as HTMLInputElement | null;
  if (!input) throw new Error(`No row for ${path}`);
  return input;
}

/** Tick or untick a row the way a tap does: the browser flips `checked`
 *  past React's tracker, then the click arrives. */
async function tap(path: string) {
  const { act } = await import('react');
  const input = box(path);
  let proto: object | null = Object.getPrototypeOf(input);
  let set: ((v: boolean) => void) | undefined;
  while (proto && !set) {
    set = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
    proto = Object.getPrototypeOf(proto);
  }
  await act(async () => {
    if (set) set.call(input, !input.checked);
    else input.checked = !input.checked;
    input.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

const commitRequest = (commit: CommitStage, lockdown = true): ApprovalRequest => ({
  id: 'ap_commit',
  kind: 'tool',
  toolName: 'gitCommit',
  risk: 'write',
  summary: 'git commit (all changes)',
  alwaysAsk: true,
  ...(lockdown ? { lockdown: true } : {}),
  commit,
});

const stage: CommitStage = {
  message: 'ship the header',
  files: [
    { path: '.env', secret: 'env' },
    { path: 'app.ts' },
    { path: 'certs/server.pem', secret: 'pem' },
    { path: 'config.ts', secret: 'detected' },
    { path: 'id_ed25519', secret: 'login-key' },
  ],
};

describe('the secrets safety cards (CX 7)', () => {
  it('uses CX 7 words exactly', () => {
    expect(LOCKDOWN_LINE).toBe(
      "This chat can see your project's Tokens and Secrets, so OpenShore asks before every command and commit.",
    );
    expect(SECRET_PILL).toBe('May hold a secret');
    expect(SECRET_REASON).toEqual({
      env: 'A settings file that often holds keys.',
      pem: 'A certificate or private key.',
      'login-key': 'A private login key.',
      detected: 'Has text that looks like a key or password.',
    });
    expect(flaggedLine(4)).toBe(
      '4 files may hold secrets. They stay out of this commit unless you tick them.',
    );
    expect(tickedWarning()).toBe("This file will be saved in the project's history.");
    expect(tickedWarning('GitHub')).toBe(
      "This file will be saved in the project's history, and sent to GitHub.",
    );
  });

  it('says why it asks on every card while the lockdown is on, and not otherwise', async () => {
    await showApproval({
      id: 'ap_shell',
      kind: 'tool',
      toolName: 'runShell',
      risk: 'shell',
      summary: 'npm test',
      alwaysAsk: true,
      lockdown: true,
    });
    expect(dom.text()).toContain(LOCKDOWN_LINE);
    await showApproval({
      id: 'ap_plain',
      kind: 'tool',
      toolName: 'runShell',
      risk: 'shell',
      summary: 'npm test',
    });
    expect(dom.text()).not.toContain(LOCKDOWN_LINE);
  });

  it('lists every file, flags the secrets with their reasons, and starts them unticked', async () => {
    await showApproval(commitRequest(stage));
    const text = dom.text();
    expect(text).toContain(LOCKDOWN_LINE);
    expect(text).toContain('Message: ship the header');
    expect(text).toContain(flaggedLine(4));
    expect(dom.container.querySelectorAll('.commit-file-pill')).toHaveLength(4);
    for (const reason of Object.values(SECRET_REASON)) expect(text).toContain(reason);
    expect(box('app.ts').checked).toBe(true);
    for (const path of ['.env', 'certs/server.pem', 'config.ts', 'id_ed25519']) {
      expect(box(path).checked, path).toBe(false);
    }
    // No warning until one is ticked.
    expect(dom.container.querySelector('.commit-file-warn')).toBeNull();
  });

  it('warns on ticking a flagged file, naming the platform only when the commit pushes', async () => {
    await showApproval(commitRequest(stage));
    await tap('.env');
    expect(box('.env').checked).toBe(true);
    expect(dom.text()).toContain(tickedWarning());
    expect(dom.text()).not.toContain('sent to');
    await dom.unmount();
    dom = await mountDom();
    await showApproval(commitRequest({ ...stage, pushesTo: 'GitHub' }));
    await tap('config.ts');
    expect(dom.text()).toContain(tickedWarning('GitHub'));
  });

  it('answers with exactly the ticked files', async () => {
    await showApproval(commitRequest(stage), 2);
    await tap('app.ts'); // untick the plain one
    await tap('id_ed25519'); // tick a flagged one
    await press('y');
    await dom.settle();
    expect(answers).toHaveLength(1);
    expect(answers[0]!.approve).toBe(true);
    expect(answers[0]!.files).toEqual(['id_ed25519']);
  });

  it('a declined commit carries no files, and a card with no flags says nothing about secrets', async () => {
    await showApproval(commitRequest({ message: 'm', files: [{ path: 'a.ts' }] }, false), 2);
    expect(dom.text()).not.toContain('may hold');
    expect(dom.text()).not.toContain(LOCKDOWN_LINE);
    await press('n');
    await dom.settle();
    expect(answers[0]).toMatchObject({ approve: false });
    expect(answers[0]!.files).toBeUndefined();
  });
});

type CutItem = Extract<ThreadItem, { kind: 'window-cut' }>;

async function showCut(item: Omit<CutItem, 'id' | 'kind'>) {
  const { WindowCutCard } = await import('../src/components/WindowCutCard.js');
  const taps = { give: 0, stack: 0 };
  await dom.render(
    <WindowCutCard
      item={{ id: 'w1', kind: 'window-cut', ...item }}
      onGiveMoreRoom={() => taps.give++}
      onOpenStack={() => taps.stack++}
    />,
  );
  return taps;
}

describe('the truncated window card (CX 6)', () => {
  it('uses CX 6 words exactly', () => {
    expect(windowCutTitle('qwen2.5-coder:7b')).toBe(
      'qwen2.5-coder:7b could not see the whole chat',
    );
    expect(WINDOW_CUT_BODY).toBe(
      'Your computer gave it less room than this chat needs, so the start of the task, maybe your instructions, fell out of view. Its answer may miss something you asked for.',
    );
    expect(MORE_ROOM_ACTION).toBe('Give it more room');
    expect(moreRoomCost(1.5)).toBe('Uses about 1.5 GB more memory. Replies get slower.');
    expect(moreRoomCost()).toBe('Uses more memory. Replies get slower.');
    expect(moreRoomGiven('qwen')).toBe('qwen has more room from your next message, in every chat.');
    expect(NO_ROOM_LINE).toBe(
      'This computer has no memory to spare for more. A shorter chat helps.',
    );
    expect(OPEN_STACK).toBe('Open Stack');
  });

  it('with room to spare: the action states its cost, and the tap calls through', async () => {
    const taps = await showCut({ model: 'qwen', provider: 'ollama', room: 'more', gb: 1.5 });
    expect(dom.text()).toContain(windowCutTitle('qwen'));
    expect(dom.text()).toContain(WINDOW_CUT_BODY);
    expect(dom.text()).toContain(moreRoomCost(1.5));
    await dom.click(MORE_ROOM_ACTION);
    expect(taps.give).toBe(1);
  });

  it('without a known cost, it still says it uses memory', async () => {
    await showCut({ model: 'qwen', provider: 'ollama', room: 'more' });
    expect(dom.text()).toContain(moreRoomCost());
  });

  it('after the tap, the action gives way to what changed', async () => {
    await showCut({ model: 'qwen', provider: 'ollama', room: 'more', gb: 2, state: 'given' });
    expect(dom.buttons()).not.toContain(MORE_ROOM_ACTION);
    expect(dom.text()).toContain(moreRoomGiven('qwen'));
  });

  it('with no memory to spare: the line and Open Stack', async () => {
    const taps = await showCut({ model: 'qwen', provider: 'ollama', room: 'full' });
    expect(dom.text()).toContain(NO_ROOM_LINE);
    expect(dom.buttons()).not.toContain(MORE_ROOM_ACTION);
    await dom.click(OPEN_STACK);
    expect(taps.stack).toBe(1);
  });

  it('on a server OpenShore does not size: the title and body only', async () => {
    await showCut({ model: 'gpt-x', provider: 'lmstudio' });
    expect(dom.buttons()).toEqual([]);
    expect(dom.text()).toBe(`${windowCutTitle('gpt-x')}${WINDOW_CUT_BODY}`);
  });

  it('shows why a tap did not go through', async () => {
    await showCut({
      model: 'qwen',
      provider: 'ollama',
      room: 'more',
      error: "Only this computer's owner can give a model more memory.",
    });
    expect(dom.text()).toContain("Only this computer's owner can give a model more memory.");
  });
});

describe('the window card, event to driver', () => {
  const empty: ThreadState = {
    items: [],
    busy: false,
    pendingApprovals: [],
    queued: [],
    lastSeq: 0,
  } as unknown as ThreadState;

  it('a window-cut event becomes one card with what the event offers', async () => {
    const { reduceEvent } = await import('../src/state/transcript.js');
    const event: DriverEvent = {
      type: 'window-cut',
      model: 'qwen',
      provider: 'ollama',
      read: 1800,
      estimated: 6000,
      room: 'more',
      gb: 1.2,
    };
    const next = reduceEvent(empty, event);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({
      kind: 'window-cut',
      model: 'qwen',
      provider: 'ollama',
      room: 'more',
      gb: 1.2,
    });
    const full = reduceEvent(empty, { ...event, room: 'full', gb: undefined });
    expect(full.items[0]).toMatchObject({ room: 'full' });
    expect(full.items[0]).not.toHaveProperty('gb');
  });

  it('the tap reaches the driver with the provider, and the card settles on the answer', async () => {
    const { giveMoreRoomFor } = await import('../src/state/securityOps.js');
    const asked: string[] = [];
    const patches: unknown[] = [];
    const driver = {
      giveMoreRoom: async (provider: string) => {
        asked.push(provider);
        return { ok: true as const, provider };
      },
    } as unknown as Parameters<typeof giveMoreRoomFor>[0];
    await giveMoreRoomFor(driver, 'ollama', (p) => patches.push(p));
    expect(asked).toEqual(['ollama']);
    expect(patches).toEqual([
      { state: 'giving', error: undefined },
      { state: 'given', error: undefined },
    ]);
    // A refusal (a member on a shared hub) lands on the card in its words.
    const refused = {
      giveMoreRoom: async () => ({
        error: "Only this computer's owner can give a model more memory.",
      }),
    } as unknown as Parameters<typeof giveMoreRoomFor>[0];
    patches.length = 0;
    await giveMoreRoomFor(refused, 'ollama', (p) => patches.push(p));
    expect(patches.at(-1)).toEqual({
      state: undefined,
      error: "Only this computer's owner can give a model more memory.",
    });
    // A chat with no computer behind it says so.
    patches.length = 0;
    await giveMoreRoomFor(undefined, 'ollama', (p) => patches.push(p));
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      error: expect.stringMatching(/not running on your computer/),
    });
  });

  it('the guard passes the action through to the driver underneath', async () => {
    const { guardDriver } = await import('../src/drivers/guardedDriver.js');
    const asked: string[] = [];
    const inner = {
      kind: 'desktop' as const,
      send() {},
      abort() {},
      answerApproval() {},
      subscribe: () => () => {},
      dispose() {},
      giveMoreRoom: async (provider: string) => {
        asked.push(provider);
        return { ok: true as const, provider };
      },
    };
    const guarded = guardDriver(inner as never);
    expect(guarded.giveMoreRoom).toBeTypeOf('function');
    await guarded.giveMoreRoom!('ollama');
    expect(asked).toEqual(['ollama']);
  });

  it('a paired phone asks its computer over the more-room route', async () => {
    const { RemoteDriver } = await import('../src/drivers/remoteDriver.js');
    const calls: Array<{ url: string; body: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(
        JSON.stringify({
          error: 'restricted',
          message: "Only this computer's owner can give a model more memory.",
        }),
        { status: 403 },
      );
    }) as typeof fetch;
    try {
      // terminalOnly: no event stream or role probe, only the route under test.
      const driver = new RemoteDriver(
        's1',
        { baseUrl: 'http://hub:4816', token: 't' } as never,
        0,
        {
          terminalOnly: true,
        },
      );
      const result = await driver.giveMoreRoom('ollama');
      expect(calls[0]).toEqual({
        url: 'http://hub:4816/sessions/s1/more-room',
        body: JSON.stringify({ provider: 'ollama' }),
      });
      expect(result).toEqual({ error: "Only this computer's owner can give a model more memory." });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
