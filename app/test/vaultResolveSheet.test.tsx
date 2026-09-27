// The Vault's resolve sheet (Vault M1, 1.1; Creative Studio 1b, 1e; CX 1.1),
// mounted in a real (small) DOM: it shows what happened before it asks, Keep
// both comes first and commits on one tap, the two choices that drop a side
// each take two taps (and arming one disarms the other, and a tab switch
// disarms both), focus lands on the dialog and never on a button, every row
// waits while a choice runs, a failure says so, and closing never chooses.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

type Choice = 'both' | 'mine' | 'theirs' | 'discard';

let dom: TestDom;
let chosen: Choice[];
let closed: number;

beforeEach(async () => {
  dom = await mountDom();
  chosen = [];
  closed = 0;
});
afterEach(async () => {
  await dom.unmount();
});

const theirs = {
  text: 'first line\nsecond line from elsewhere\nthird line',
  updatedAt: '2026-09-27T10:00:00.000Z',
  version: '1:2:3',
};
const mine = 'first line\nmy second line\nthird line';

async function show(
  over: Partial<{
    mode: 'edit' | 'missing';
    busy: boolean;
    failed: boolean;
    again: boolean;
    theirs: typeof theirs;
    mine: string;
  }> = {},
) {
  const { VaultResolveSheet } = await import('../src/components/VaultResolveSheet.js');
  await dom.render(
    <VaultResolveSheet
      open
      mode={over.mode ?? 'edit'}
      title="Ideas"
      mine={over.mine ?? mine}
      theirs={over.mode === 'missing' ? undefined : (over.theirs ?? theirs)}
      loadedAt={0}
      again={over.again}
      busy={over.busy ?? false}
      failed={over.failed ?? false}
      onChoose={(c) => chosen.push(c)}
      onClose={() => closed++}
    />,
  );
}

const rows = () => [...dom.container.querySelectorAll<HTMLButtonElement>('[data-choice]')];
const row = (choice: Choice) =>
  dom.container.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!;
const labelOf = (b: HTMLButtonElement) => b.querySelector('.grow')!.firstChild!.textContent;
async function tap(el: HTMLElement) {
  const { act } = await import('react');
  await act(async () => {
    const w = globalThis.window as unknown as { Event: typeof Event };
    el.dispatchEvent(new w.Event('click', { bubbles: true }));
  });
}

describe('the resolve sheet: two versions of a note', () => {
  it('says what happened, then offers Keep both first as the one primary row', async () => {
    await show();
    const text = dom.text();
    expect(text).toContain('Two versions of this note');
    expect(text).toContain('"Ideas" was changed somewhere else');
    expect(text).toContain('Nothing is lost until you choose.');
    expect(rows().map((b) => b.dataset.choice)).toEqual(['both', 'mine', 'theirs']);
    expect(rows().map(labelOf)).toEqual(['Keep both', 'Keep yours', 'Keep the other version']);
    expect(row('both').className).toMatch(/\bprimary\b/);
    expect(row('mine').className).toMatch(/\bghost\b/);
    // Every tappable acknowledges the touch.
    for (const b of dom.container.querySelectorAll('button')) {
      expect(b.className).toMatch(/press-fb/);
    }
  });

  it('draws a neutral line compare: yours and the other version, each marked', async () => {
    await show();
    const mineLines = [...dom.container.querySelectorAll('.vault-cmp-line.mine')];
    const otherLines = [...dom.container.querySelectorAll('.vault-cmp-line.other')];
    expect(mineLines.map((l) => l.textContent)).toEqual(['Yours: my second line']);
    expect(otherLines.map((l) => l.textContent)).toEqual([
      'Other version: second line from elsewhere',
    ]);
    expect(dom.text()).toContain('Only in yours');
    expect(dom.text()).toContain('Only in the other version');
  });

  it('shows each version in full on its own tab', async () => {
    await show();
    const tab = (name: string) =>
      [...dom.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (b) => b.textContent === name,
      )!;
    await tap(tab('Other version'));
    expect(dom.container.querySelector('.vault-compare-full')!.textContent).toBe(theirs.text);
    await tap(tab('Yours'));
    expect(dom.container.querySelector('.vault-compare-full')!.textContent).toBe(mine);
  });

  it('says so when the versions differ only in spacing', async () => {
    await show({ mine: theirs.text.replace(/\n/g, '  \r\n'), theirs });
    expect(dom.text()).toContain('The two versions differ only in spacing or line endings.');
  });

  it('Keep both commits on one tap', async () => {
    await show();
    await tap(row('both'));
    expect(chosen).toEqual(['both']);
  });

  it('Keep yours takes two taps; arming one row disarms the other', async () => {
    await show();
    await tap(row('mine'));
    expect(chosen).toEqual([]);
    expect(labelOf(row('mine'))).toBe('Really replace it? Tap to confirm.');
    expect(row('mine').className).toMatch(/\bdanger\b/);
    // The consequence stays, so nothing reflows.
    expect(row('mine').querySelector('.sub')!.textContent).toBe(
      'Yours replaces the other version.',
    );
    await tap(row('theirs'));
    expect(labelOf(row('mine'))).toBe('Keep yours');
    expect(labelOf(row('theirs'))).toBe('Really discard your edits? Tap to confirm.');
    await tap(row('theirs'));
    expect(chosen).toEqual(['theirs']);
  });

  it('switching tabs disarms an armed row', async () => {
    await show();
    await tap(row('mine'));
    const yoursTab = [...dom.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')][1]!;
    await tap(yoursTab);
    expect(labelOf(row('mine'))).toBe('Keep yours');
    await tap(row('mine'));
    expect(chosen).toEqual([]);
  });

  it('focus goes to the dialog itself, never to a button', async () => {
    // linkedom keeps no focus, so record what the sheet focuses.
    const proto = (globalThis.window as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement
      .prototype;
    const focused: Element[] = [];
    const before = proto.focus;
    proto.focus = function (this: HTMLElement) {
      focused.push(this);
    };
    try {
      await show();
    } finally {
      proto.focus = before;
    }
    const dialog = dom.container.querySelector('[role="dialog"]')!;
    expect(focused).toEqual([dialog]);
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    expect(dom.container.querySelector('button[autofocus]')).toBeNull();
  });

  it('every row waits while a choice runs, and a failure says so', async () => {
    await show({ busy: true });
    expect(rows().every((b) => b.disabled)).toBe(true);
    await show({ failed: true });
    expect(dom.text()).toContain(
      'Your vault storage did not take that, so nothing changed. Try again.',
    );
    expect(rows().every((b) => !b.disabled)).toBe(true);
  });

  it('says when the other version changed again while it was open', async () => {
    await show({ again: true });
    expect(dom.text()).toContain('It changed again while this was open.');
  });

  it('the round close defers and never chooses', async () => {
    await show();
    await tap(dom.container.querySelector<HTMLButtonElement>('.mode-close')!);
    expect(closed).toBe(1);
    expect(chosen).toEqual([]);
  });
});

describe('the resolve sheet: a note that is gone', () => {
  it('offers Save it again first, and Discard only on a second tap, with no compare', async () => {
    await show({ mode: 'missing' });
    expect(dom.text()).toContain('This note is gone');
    expect(dom.container.querySelector('.vault-compare')).toBeNull();
    expect(rows().map(labelOf)).toEqual(['Save it again', 'Discard your edits']);
    await tap(row('discard'));
    expect(chosen).toEqual([]);
    await tap(row('discard'));
    expect(chosen).toEqual(['discard']);
    await tap(row('mine'));
    expect(chosen).toEqual(['discard', 'mine']);
  });
});
