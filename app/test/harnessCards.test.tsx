// The harness package's transcript cards, mounted in a real (small) DOM: the
// verdict pill on the task-done card (pass, fail and not checked, in the
// transcript verify pill's own words, never the danger red, and a tap that
// brings the check into view), the little-room card in the truncation card's
// family, and the card for retrieval before turn one.
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverEvent } from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';
import {
  NOT_CHECKED,
  RETRIEVAL_SEAT,
  SHOW_CHECK,
  WINDOW_TIGHT_BODY,
  retrievalHeadline,
  retrievalPlace,
  windowTightTitle,
} from '../src/lib/harnessCopy.js';
import { verdictLabel } from '../src/components/VerifyPill.js';
import { MORE_ROOM_ACTION, WINDOW_CUT_BODY, moreRoomCost } from '../src/lib/securityCopy.js';
import { taskVerdict, verifyAnchor, type TaskVerdict } from '../src/state/harnessOps.js';
import type { ThreadItem, ThreadState } from '../src/state/types.js';

let dom: TestDom;

beforeEach(async () => {
  dom = await mountDom();
});

afterEach(async () => {
  await dom.unmount();
});

const user = (id: string): ThreadItem => ({ kind: 'user', id, text: 'fix the header' });
const verify = (id: string, passed: boolean, check: 'tests' | 'page' = 'tests'): ThreadItem => ({
  kind: 'verify',
  id,
  passed,
  check,
  summary: passed ? 'All checks passed.' : 'One check failed.',
  retrying: false,
});
const changed = (id: string): ThreadItem => ({
  kind: 'changed',
  id,
  files: [{ path: 'index.html', added: 3, removed: 1, status: 'modified' }],
});

async function showCard(verdict: TaskVerdict | undefined, undone?: string[]) {
  const { ChangedFilesCard } = await import('../src/components/ChangedFilesCard.js');
  await dom.render(
    <ChangedFilesCard
      files={[{ path: 'index.html', added: 3, removed: 1, status: 'modified' }]}
      checkpointId="cp1"
      undone={undone}
      onRestore={() => {}}
      verdict={verdict}
    />,
  );
}

const pill = () => dom.container.querySelector('.changed-verdict');

describe('the verdict on the task-done card', () => {
  it('reads the last check of the same task', () => {
    const items = [
      user('u0'),
      verify('v0', true),
      changed('c0'),
      user('u1'),
      verify('v1', false),
      verify('v2', true, 'page'),
      changed('c1'),
    ];
    expect(taskVerdict(items, 6)).toEqual({ state: 'pass', check: 'page', verifyId: 'v2' });
    expect(taskVerdict(items, 2)).toEqual({ state: 'pass', check: 'tests', verifyId: 'v0' });
    // A check from an earlier task never speaks for this one.
    expect(taskVerdict([user('u0'), verify('v0', true), user('u1'), changed('c1')], 3)).toEqual({
      state: 'not-run',
    });
    expect(taskVerdict([user('u0'), verify('v0', false), changed('c0')], 2)).toMatchObject({
      state: 'fail',
    });
  });

  it('says the same words as the transcript pill', () => {
    expect(verdictLabel(true, 'page')).toBe('It works');
    expect(verdictLabel(true, 'tests')).toBe('Checks pass');
    expect(verdictLabel(false, 'page')).toBe('Not yet');
    expect(verdictLabel(false, 'tests')).toBe('Checks failing');
    expect(verdictLabel(false, 'page', true)).toBe('Not yet, fixing it');
    expect(NOT_CHECKED).toBe('Not checked');
  });

  it('a pass is a quiet green pill that answers the touch', async () => {
    await showCard({ state: 'pass', check: 'tests', verifyId: 'v1' });
    const el = pill()!;
    expect(el.tagName).toBe('BUTTON');
    expect(el.textContent).toBe('Checks pass');
    expect(el.className).toContain('pass');
    expect(el.className).toContain('press-fb');
    expect(el.getAttribute('aria-label')).toBe(`Checks pass. ${SHOW_CHECK}`);
  });

  it('a fail says so plainly, in the page check words too', async () => {
    await showCard({ state: 'fail', check: 'page', verifyId: 'v1' });
    expect(pill()!.textContent).toBe('Not yet');
    expect(pill()!.className).toContain('fail');
    expect(pill()!.className).not.toMatch(/danger|error/);
  });

  it('work nothing checked says so, and is not a button', async () => {
    await showCard({ state: 'not-run' });
    expect(pill()!.tagName).toBe('SPAN');
    expect(pill()!.textContent).toBe(NOT_CHECKED);
    expect(dom.buttons()).not.toContain(NOT_CHECKED);
  });

  it('steps aside once every file is back', async () => {
    await showCard({ state: 'pass', check: 'tests', verifyId: 'v1' }, ['index.html']);
    expect(pill()).toBeNull();
    expect(dom.text()).toContain('Undone');
  });

  it('in the transcript, a tap brings the check into view', { timeout: 20_000 }, async () => {
    // A tap in the transcript finishes any typing (skipReveals), which raises
    // an event on the window; linkedom's window takes its own kind.
    const NodeEvent = globalThis.Event;
    globalThis.Event = window.Event as unknown as typeof Event;
    // linkedom lays nothing out: the list's own follow scroll is a no-op here,
    // and a jump into view is recorded.
    const scrolled: string[] = [];
    const proto = window.HTMLElement.prototype as unknown as {
      scrollIntoView?: unknown;
      scrollTo?: unknown;
    };
    const before = { into: proto.scrollIntoView, to: proto.scrollTo };
    proto.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.id);
    };
    proto.scrollTo = () => {};
    onTestFinished(() => {
      globalThis.Event = NodeEvent;
      proto.scrollIntoView = before.into;
      proto.scrollTo = before.to;
    });
    const { MessageList } = await import('../src/components/MessageList.js');
    const { emptyThread } = await import('../src/state/types.js');
    const thread: ThreadState = {
      ...emptyThread(),
      items: [user('u1'), verify('v1', false), verify('v2', true, 'page'), changed('c1')],
    };
    await dom.render(<MessageList thread={thread} />);
    expect(dom.container.querySelector(`#${verifyAnchor('v2')}`)).not.toBeNull();
    await dom.click('It works');
    expect(scrolled).toEqual([verifyAnchor('v2')]);
  });

  it('never wears the danger red, and keeps teal and amber for their meanings', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'theme.css'), 'utf8');
    const rules = [...css.matchAll(/\.changed-verdict[^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) expect(body).not.toMatch(/--danger|--local|--cloud/);
    expect(css).toMatch(/\.changed-verdict\.pass \{[^}]*var\(--ok\)/);
    expect(css).toMatch(/\.changed-verdict\.fail \{[^}]*var\(--warn\)/);
    expect(css).toMatch(/\.changed-verdict \{[^}]*animation: msg-in var\(--dur-3\)/);
  });
});

const empty = (): ThreadState =>
  ({
    items: [],
    busy: false,
    pendingApprovals: [],
    queued: [],
    lastSeq: 0,
  }) as unknown as ThreadState;

describe('the little-room card (the truncation card family)', () => {
  it('a window-tight event becomes the window card with its own words and the same action', async () => {
    const { reduceEvent } = await import('../src/state/transcript.js');
    const event: DriverEvent = {
      type: 'window-tight',
      model: 'qwen2.5-coder:3b',
      provider: 'ollama',
      fixedTokens: 2900,
      windowTokens: 4096,
      room: 'more',
      gb: 0.8,
    };
    const next = reduceEvent(empty(), event);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({
      kind: 'window-cut',
      tight: true,
      model: 'qwen2.5-coder:3b',
      provider: 'ollama',
      room: 'more',
      gb: 0.8,
    });
    const { WindowCutCard } = await import('../src/components/WindowCutCard.js');
    let taps = 0;
    await dom.render(
      <WindowCutCard
        item={next.items[0] as Extract<ThreadItem, { kind: 'window-cut' }>}
        onGiveMoreRoom={() => taps++}
      />,
    );
    expect(dom.text()).toContain(windowTightTitle('qwen2.5-coder:3b'));
    expect(dom.text()).toContain(WINDOW_TIGHT_BODY);
    expect(dom.text()).not.toContain(WINDOW_CUT_BODY);
    expect(dom.text()).toContain(moreRoomCost(0.8));
    await dom.click(MORE_ROOM_ACTION);
    expect(taps).toBe(1);
    expect(windowTightTitle('m')).toBe('m has little room left for this chat on this computer');
  });
});

describe('the retrieval card', () => {
  it('names each place, and says where it stayed', async () => {
    const { reduceEvent } = await import('../src/state/transcript.js');
    const next = reduceEvent(empty(), {
      type: 'retrieval',
      sources: [
        { path: 'src/magic.mjs', line: 1 },
        { path: 'src/use.mjs', line: 12 },
      ],
      tokens: 86,
      budgetTokens: 409,
    });
    expect(next.items[0]).toMatchObject({ kind: 'retrieval' });
    const { RetrievalCard } = await import('../src/components/RetrievalCard.js');
    await dom.render(
      <RetrievalCard item={next.items[0] as Extract<ThreadItem, { kind: 'retrieval' }>} />,
    );
    expect(dom.text()).toBe(
      `${retrievalHeadline(2)}${RETRIEVAL_SEAT}${retrievalPlace('src/magic.mjs', 1)}${retrievalPlace('src/use.mjs', 12)}`,
    );
    expect(retrievalHeadline(1)).toBe('Started from 1 place in your code');
    expect(dom.container.querySelector('.context-pack-card.local')).not.toBeNull();
  });
});
