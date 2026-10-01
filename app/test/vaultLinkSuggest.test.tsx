// Linking that feels native (Vault M6, 6.7; CTO K14, CX X15), mounted in a
// real (small) DOM: the editor's keys drive the list (Up, Down, Enter or Tab
// picks, Esc closes the list only), the rows are options the editor points at
// through aria-activedescendant, a pick replaces through an existing `]]` or
// up to a `|`, `[[Note#` offers that note's headings, colliding titles carry
// a folder sub-label and insert the shortest unambiguous path, and insertion
// takes execCommand('insertText') first, setRangeText only as the fallback.
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wikilinkContext, type TextRange, type WikilinkContext } from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';

let dom: TestDom;
let dismissed: number;

beforeEach(async () => {
  dom = await mountDom();
  dismissed = 0;
});
afterEach(async () => {
  await dom.unmount();
  delete (document as { execCommand?: unknown }).execCommand;
});

/** The replace range per its contract (stream A2 builds the real one): from
 *  the `[[` through the target already written, through an existing `]]`, or
 *  up to an existing `|`. */
function replaceRange(text: string, ctx: WikilinkContext): TextRange {
  let end = ctx.end;
  while (end < text.length && !/[\]|\n]/.test(text[end]!)) end++;
  if (text.startsWith(']]', end)) end += 2;
  return { start: ctx.start, end };
}

const PATHS = ['Plan.md', 'Ideas.md', 'Work/Notes.md', 'Home/Notes.md', 'Journal/Today.md'];

/** Give linkedom's textarea the selection API a browser has. */
function wire(el: HTMLTextAreaElement, text: string, caret: number) {
  const state = { start: caret, end: caret, inputs: 0, rangeText: 0 };
  el.value = text;
  Object.defineProperty(el, 'selectionStart', { get: () => state.start, configurable: true });
  Object.defineProperty(el, 'selectionEnd', { get: () => state.end, configurable: true });
  Object.assign(el, {
    setSelectionRange(s: number, e: number) {
      state.start = s;
      state.end = e;
    },
    setRangeText(t: string, s: number, e: number) {
      state.rangeText++;
      el.value = el.value.slice(0, s) + t + el.value.slice(e);
      state.start = state.end = s + t.length;
    },
  });
  el.addEventListener('input', () => state.inputs++);
  return state;
}

async function show(
  text: string,
  caret: number,
  over: { headingsOf?: (p: string) => readonly string[]; sourcePath?: string } = {},
) {
  const { VaultLinkSuggest } = await import('../src/components/vault/VaultLinkSuggest.js');
  const ctx = wikilinkContext(text, caret);
  function Harness() {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    return (
      <>
        <textarea ref={ref} />
        <VaultLinkSuggest
          paths={PATHS}
          sourcePath={over.sourcePath ?? 'Journal/Today.md'}
          context={ctx}
          editor={ref}
          headingsOf={over.headingsOf}
          onDismiss={() => dismissed++}
          replaceRange={replaceRange}
        />
      </>
    );
  }
  await dom.render(<Harness />);
  const el = dom.container.querySelector('textarea') as HTMLTextAreaElement;
  const state = wire(el, text, caret);
  return { el, state };
}

async function key(el: HTMLElement, k: string, extra: Record<string, unknown> = {}) {
  const { act } = await import('react');
  const e = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.assign(e, { key: k, ...extra });
  await act(async () => {
    el.dispatchEvent(e);
  });
  return e;
}

const options = () => [...dom.container.querySelectorAll<HTMLElement>('[role="option"]')];

describe('the link list answers the keyboard', () => {
  it('is a listbox of options, and the editor points at the active one', async () => {
    const { el } = await show('See [[', 6);
    const list = dom.container.querySelector('[role="listbox"]')!;
    expect(list).toBeTruthy();
    expect(options().length).toBeGreaterThan(1);
    expect(el.getAttribute('aria-controls')).toBe(list.id);
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('Down moves the active row, Up wraps, and Enter picks it', async () => {
    const { el, state } = await show('See [[', 6);
    const labels = options().map((o) => o.getAttribute('aria-label'));
    const down = await key(el, 'ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(el.getAttribute('aria-activedescendant')).toBe(options()[1]!.id);
    await key(el, 'ArrowUp');
    await key(el, 'ArrowUp');
    const last = options().length - 1;
    expect(el.getAttribute('aria-activedescendant')).toBe(options()[last]!.id);
    await key(el, 'ArrowDown');
    await key(el, 'ArrowDown');
    const enter = await key(el, 'Enter');
    expect(enter.defaultPrevented).toBe(true);
    // The second row's note, linked by its shortest name.
    expect(labels[1]).toBeTruthy();
    expect(el.value).toMatch(/^See \[\[[^\]]+\]\]$/);
    expect(state.inputs).toBe(1);
    expect(dismissed).toBe(1);
  });

  it('Tab picks the active row too', async () => {
    const { el } = await show('A [[Pla', 7);
    await key(el, 'Tab');
    expect(el.value).toBe('A [[Plan]]');
  });

  it('Esc closes the list only: nothing is inserted and the Esc goes no further', async () => {
    const { el } = await show('A [[Pla', 7);
    let heard = 0;
    document.addEventListener('keydown', () => heard++);
    const esc = await key(el, 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(dismissed).toBe(1);
    expect(heard).toBe(0);
    expect(el.value).toBe('A [[Pla');
  });

  it('leaves Shift+Enter and a modified key to the editor', async () => {
    const { el } = await show('A [[Pla', 7);
    const shifted = await key(el, 'Enter', { shiftKey: true });
    const meta = await key(el, 'ArrowDown', { metaKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(meta.defaultPrevented).toBe(false);
    expect(el.value).toBe('A [[Pla');
  });

  it('a tap picks without taking focus from the note', async () => {
    const { el } = await show('A [[Ide', 7);
    const { act } = await import('react');
    const row = options().find((o) => o.textContent === 'Ideas')!;
    const down = new window.Event('mousedown', { bubbles: true, cancelable: true });
    await act(async () => {
      row.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    expect(el.value).toBe('A [[Ideas]]');
  });
});

describe('a pick replaces what the link already holds', () => {
  it('replaces through an existing ]]', async () => {
    const { el } = await show('See [[Pl]] now', 8);
    await key(el, 'Enter');
    expect(el.value).toBe('See [[Plan]] now');
  });

  it('stops at a | so the alias is kept', async () => {
    const { el } = await show('See [[Pl|the plan]] now', 8);
    await key(el, 'Enter');
    expect(el.value).toBe('See [[Plan|the plan]] now');
  });

  it('keeps the ! of an embed', async () => {
    const { el } = await show('![[Ide', 6);
    await key(el, 'Enter');
    expect(el.value).toBe('![[Ideas]]');
  });
});

describe('ambiguous titles', () => {
  it('show a folder sub-label and insert the shortest unambiguous path', async () => {
    const { linkOptions } = await import('../src/components/vault/VaultLinkSuggest.js');
    const rows = linkOptions(PATHS, 'Plan.md', wikilinkContext('[[Notes', 7));
    const notes = rows.filter((r) => r.kind === 'note');
    expect(notes.map((r) => r.sub).sort()).toEqual(['Home', 'Work']);
    expect(notes.map((r) => r.target).sort()).toEqual(['Home/Notes', 'Work/Notes']);
    expect(notes.map((r) => r.aria).sort()).toEqual(['Notes, in Home', 'Notes, in Work']);
    // A unique title carries no sub-label and links by its name alone.
    const plan = linkOptions(PATHS, 'Ideas.md', wikilinkContext('[[Pla', 5));
    expect(plan[0]).toMatchObject({ label: 'Plan', target: 'Plan' });
    expect(plan[0]!.sub).toBeUndefined();
  });

  it('the inserted text is that path, and the sub-label is on screen', async () => {
    const { el } = await show('See [[Notes', 11);
    expect(dom.container.querySelectorAll('.vault-link-sub').length).toBe(2);
    const target = options()[0]!.getAttribute('aria-label')!.endsWith('Home')
      ? 'Home/Notes'
      : 'Work/Notes';
    await key(el, 'Enter');
    expect(el.value).toBe(`See [[${target}]]`);
  });

  it('offers a new note only when no title matches', async () => {
    const { linkOptions } = await import('../src/components/vault/VaultLinkSuggest.js');
    const fresh = linkOptions(PATHS, 'Plan.md', wikilinkContext('[[Garden', 8));
    expect(fresh.at(-1)).toMatchObject({ kind: 'new', label: 'New: Garden', target: 'Garden' });
    expect(fresh.at(-1)!.aria).toBe('Link to a new note named Garden');
    const known = linkOptions(PATHS, 'Ideas.md', wikilinkContext('[[plan', 6));
    expect(known.some((r) => r.kind === 'new')).toBe(false);
  });
});

describe('heading completion', () => {
  const headingsOf = (p: string) =>
    p === 'Plan.md' ? ['Goals', 'Open questions', 'Goals'] : ['Elsewhere'];

  it("after [[Note# offers that note's headings, filtered, once each", async () => {
    const { linkOptions } = await import('../src/components/vault/VaultLinkSuggest.js');
    const all = linkOptions(PATHS, 'Ideas.md', wikilinkContext('[[Plan#', 7), headingsOf);
    expect(all.map((r) => r.label)).toEqual(['# Goals', '# Open questions']);
    const some = linkOptions(PATHS, 'Ideas.md', wikilinkContext('[[Plan#ope', 10), headingsOf);
    expect(some.map((r) => r.target)).toEqual(['Plan#Open questions']);
    // `[[#` is the note itself; `#^` is a block and offers nothing.
    const own = linkOptions(PATHS, 'Plan.md', wikilinkContext('[[#', 3), headingsOf);
    expect(own.map((r) => r.target)).toEqual(['#Goals', '#Open questions']);
    expect(linkOptions(PATHS, 'Ideas.md', wikilinkContext('[[Plan#^', 8), headingsOf)).toEqual([]);
  });

  it('a pick writes the heading link', async () => {
    const { el } = await show('See [[Plan#Op', 13, { headingsOf, sourcePath: 'Ideas.md' });
    await key(el, 'Enter');
    expect(el.value).toBe('See [[Plan#Open questions]]');
  });
});

describe('insertAtCaret', () => {
  it('uses execCommand insertText first, so the native undo stack holds the pick', async () => {
    const { el, state } = await show('A [[Pla', 7);
    const calls: string[] = [];
    Object.assign(document, {
      execCommand(cmd: string, _ui: boolean, text: string) {
        calls.push(cmd);
        el.value = el.value.slice(0, el.selectionStart) + text + el.value.slice(el.selectionEnd);
        el.dispatchEvent(new window.Event('input', { bubbles: true }));
        return true;
      },
    });
    await key(el, 'Enter');
    expect(calls).toEqual(['insertText']);
    expect(state.rangeText).toBe(0);
    expect(state.inputs).toBe(1);
    expect(el.value).toBe('A [[Plan]]');
  });

  it('falls back to setRangeText and an input event when the command is refused', async () => {
    const { el, state } = await show('A [[Pla', 7);
    Object.assign(document, { execCommand: () => false });
    await key(el, 'Enter');
    expect(state.rangeText).toBe(1);
    expect(state.inputs).toBe(1);
    expect(el.value).toBe('A [[Plan]]');
    expect(state.start).toBe('A [[Plan]]'.length);
  });
});

describe('the accessory bar edits', () => {
  it('link, tag and task make the edits the tools name', async () => {
    const { linkEdit, tagEdit, taskEdit } =
      await import('../src/components/vault/VaultAccessoryBar.js');
    expect(linkEdit('ab', 2, 2)).toEqual({ range: { start: 2, end: 2 }, insert: '[[]]', caret: 4 });
    expect(linkEdit('see Plan', 4, 8)).toMatchObject({ insert: '[[Plan]]', caret: 12 });
    expect(tagEdit('word', 4).insert).toBe(' #');
    expect(tagEdit('word ', 5).insert).toBe('#');
    expect(taskEdit('buy milk', 3)).toEqual({
      range: { start: 0, end: 0 },
      insert: '- [ ] ',
      caret: 9,
    });
    expect(taskEdit('a\n  - eggs', 8)).toMatchObject({
      range: { start: 6, end: 6 },
      insert: '[ ] ',
    });
    expect(taskEdit('- [ ] done', 4)).toBeNull();
    expect(taskEdit('x\n- [x] done', 12)).toBeNull();
  });
});

// The card under the note and the outline (6.8; CTO K15, CX X16, X17) ride
// the same stream, so their pure helpers and the skeleton are pinned here.
describe('outgoing links, unlinked mentions, and the outline', () => {
  it('lists outgoing links once each, a missing note muted, self and files left out', async () => {
    const { outgoingLinks } = await import('../src/components/vault/VaultBacklinks.js');
    const out = outgoingLinks(
      [
        { link: { target: 'Plan' }, resolved: 'Plan.md' },
        { link: { target: 'Plan#Goals' }, resolved: 'Plan.md' },
        { link: { target: 'Garden' }, resolved: null },
        { link: { target: 'garden' }, resolved: null },
        { link: { target: 'photo.png' }, resolved: null },
        { link: { target: '#Top' }, resolved: 'Ideas.md' },
      ],
      'Ideas.md',
    );
    expect(out).toEqual([
      { target: 'Plan', path: 'Plan.md' },
      { target: 'Garden', path: null },
    ]);
  });

  it('finds unlinked mentions from search candidates, 50 reads at most', async () => {
    const { findUnlinkedRows } = await import('../src/components/vault/VaultBacklinks.js');
    const reads: string[] = [];
    const many = Array.from({ length: 70 }, (_, i) => ({ path: `n${i}.md` }));
    const rows = await findUnlinkedRows({
      path: 'Plan.md',
      aliases: ['Roadmap'],
      search: async (q) => (q === 'Plan' ? [{ path: 'Plan.md' }, ...many] : [{ path: 'n1.md' }]),
      readBody: async (p) => {
        reads.push(p);
        return p === 'n1.md' ? 'we follow the plan today' : 'nothing here';
      },
      find: (text, names) => {
        const at = text.toLowerCase().indexOf(names[0]!.toLowerCase());
        return at === -1
          ? []
          : [{ start: at, end: at + names[0]!.length, name: names[0]!, line: 0 }];
      },
    });
    expect(reads).toHaveLength(50);
    expect(reads).not.toContain('Plan.md');
    expect(rows.map((r) => r.path)).toEqual(['n1.md']);
    expect(rows[0]!.excerpt).toContain('plan');
  });

  it('a Link keeps the sentence as written', async () => {
    const { linkMentionText } = await import('../src/components/vault/VaultBacklinks.js');
    const text = 'we follow the plan today';
    const m = { start: 14, end: 18, name: 'Plan' };
    expect(linkMentionText(text, m, 'Plan')).toBe('we follow the [[Plan|plan]] today');
    expect(linkMentionText('see Plan now', { start: 4, end: 8, name: 'Plan' }, 'Plan')).toBe(
      'see [[Plan]] now',
    );
    // The mention moved (the note changed): nothing is written.
    expect(
      linkMentionText('see Plxn now', { start: 4, end: 8, name: 'Plan' }, 'Plan'),
    ).toBeUndefined();
  });

  it('shows three skeleton rows while linked mentions load, busy and named', async () => {
    const { VaultBacklinks } = await import('../src/components/vault/VaultBacklinks.js');
    await dom.render(<VaultBacklinks mentions={[]} loading onOpen={() => {}} />);
    expect(dom.container.querySelectorAll('.vault-skel-row')).toHaveLength(3);
    expect(dom.container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(dom.text()).toContain('Finding linked mentions');
  });

  it('orders the three sections and offers unlinked mentions on request', async () => {
    const { VaultBacklinks } = await import('../src/components/vault/VaultBacklinks.js');
    let asked = 0;
    await dom.render(
      <VaultBacklinks
        mentions={[{ path: 'A.md', excerpt: 'links [[Plan]]' }]}
        outgoing={[{ target: 'Garden', path: null }]}
        onCreate={() => {}}
        title="Plan"
        unlinked={{ status: 'idle' }}
        onFindUnlinked={() => asked++}
        onOpen={() => {}}
      />,
    );
    const heads = [...dom.container.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Linked mentions', 'Links from this note', 'Unlinked mentions']);
    expect(dom.text()).toContain('Not created yet. Tap to create it.');
    await dom.click('Find unlinked mentions');
    expect(asked).toBe(1);
  });

  it('a missing link where nothing can be created reads as not created, and takes no tap', async () => {
    const { VaultBacklinks } = await import('../src/components/vault/VaultBacklinks.js');
    await dom.render(
      <VaultBacklinks
        mentions={[]}
        outgoing={[{ target: 'Garden', path: null }]}
        onOpen={() => {}}
      />,
    );
    expect(dom.text()).toContain('Not created yet.');
    expect(dom.text()).not.toContain('Tap to create it.');
    const row = dom.container.querySelector('.vault-outgoing-missing') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
  });

  it('the outline is offered from two headings, indented by level up to H3', async () => {
    const { outlineOffered, outlineDepth } =
      await import('../src/components/vault/VaultOutlineSheet.js');
    expect(outlineOffered([{ level: 1, text: 'a', line: 0 }])).toBe(false);
    expect(
      outlineOffered([
        { level: 1, text: 'a', line: 0 },
        { level: 2, text: 'b', line: 3 },
      ]),
    ).toBe(true);
    expect([1, 2, 3, 4, 6].map(outlineDepth)).toEqual([0, 1, 2, 2, 2]);
  });
});
