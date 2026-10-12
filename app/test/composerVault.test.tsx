// Take a note to a model (Vault M5, tech review J15). Typing `[[` in the composer
// opens the note picker, a presence-aware sheet of the person's notes searched
// by title; a pick folds a budgeted excerpt into a chip with its cost line; a
// hidden note never lists; a private note is refused while the seat leaves
// the network, at the pick, after the read, and again at send. Without the
// vault prop the composer is exactly what it was. Mounted in a real (small)
// DOM (test/support/dom.ts); the excerpt helpers are injected, since stream
// H builds the real ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountDom, type TestDom } from './support/dom.js';
import type { ComposerExcerpt, ExcerptNote } from '../src/lib/vaultExcerpt.js';
import type { ComposerVault } from '../src/components/Composer.js';
import type { PickerNote } from '../src/components/VaultNotePicker.js';

const app = vi.hoisted(() => {
  const toasts: string[] = [];
  const state = {
    settings: { permissionMode: 'default' },
    showToast: (t: string) => {
      toasts.push(t);
    },
    runCommand: () => {},
    listFiles: async () => [] as string[],
    addMemory: async () => {},
    setPermissionMode: async () => {},
  };
  return { state, toasts };
});
vi.mock('../src/state/store.js', () => ({
  useApp: <T,>(select?: (s: typeof app.state) => T) => (select ? select(app.state) : app.state),
}));

const NOTES: PickerNote[] = [
  { path: 'ideas.md', title: 'Ideas', updatedAt: '2026-09-20T10:00:00Z', visibility: 'open' },
  {
    path: 'journal/diary.md',
    title: 'Diary',
    updatedAt: '2026-09-26T10:00:00Z',
    visibility: 'local-only',
  },
  {
    path: 'secret/keys.md',
    title: 'Keys',
    updatedAt: '2026-09-27T10:00:00Z',
    visibility: 'hidden',
  },
  {
    path: 'projects/roadmap.md',
    title: 'Roadmap for launch',
    updatedAt: '2026-09-25T10:00:00Z',
    visibility: 'open',
  },
];
const BODIES: Record<string, string> = {
  'ideas.md': 'First idea.\n\nSecond idea.',
  'journal/diary.md': 'Dear diary.',
  'projects/roadmap.md': 'Ship it.',
};

let dom: TestDom;
let sent: Array<{ text: string }>;
let reads: string[];
let excerpts: Array<{ note: ExcerptNote; budget: number }>;

beforeEach(async () => {
  dom = await mountDom();
  Object.assign(window, { matchMedia: () => ({ matches: false }) });
  // linkedom has no caret; the composer puts it back after a pick.
  const area = window.HTMLTextAreaElement.prototype as { setSelectionRange?: unknown };
  area.setSelectionRange ??= () => {};
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  sent = [];
  reads = [];
  excerpts = [];
  app.toasts.length = 0;
});
afterEach(async () => {
  await dom.unmount();
  document.body.querySelectorAll('.sheet-scrim').forEach((n) => n.remove());
});

const fakeExcerpt = (note: ExcerptNote, budget: number): ComposerExcerpt => {
  excerpts.push({ note, budget });
  const text = `From my note [[${note.title}]] (updated ${note.updatedAt.slice(0, 10)}):\n> ${note.text}`;
  return { text, tokens: Math.min(budget, Math.ceil(text.length / 4)), trimmed: false };
};

function vaultOf(over: Partial<ComposerVault> = {}): ComposerVault {
  return {
    notes: NOTES,
    read: async (path) => {
      reads.push(path);
      return BODIES[path] === undefined ? null : { text: BODIES[path]! };
    },
    seat: { servedTokens: 4096, device: false, leavesNetwork: false },
    excerpt: fakeExcerpt,
    costLine: (tokens, served) => `About ${tokens} tokens of this model's ${served}`,
    ...over,
  };
}

async function show(vault?: ComposerVault) {
  const { Composer } = await import('../src/components/Composer.js');
  await dom.render(
    <Composer
      busy={false}
      visionSupported
      onSend={(text) => sent.push({ text })}
      onStop={() => {}}
      onOpenModelSheet={() => {}}
      onOpenModeSheet={() => {}}
      vault={vault}
    />,
  );
}

const FIELD = 'Chat with OpenShore';
const dialog = () => document.body.querySelector('.vault-note-picker');
const pickerOpen = () => Boolean(dialog() && !dialog()!.classList.contains('closing'));
const rows = () => [...document.body.querySelectorAll<HTMLButtonElement>('[data-path]')];
async function tap(el: Element) {
  const { act } = await import('react');
  await act(async () => {
    el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}
async function pick(path: string) {
  const row = rows().find((r) => r.dataset.path === path);
  if (!row) throw new Error(`No row for ${path}`);
  await tap(row);
  await dom.settle();
  await dom.settle();
}
// The picker is portaled to the body, outside the test root.
async function search(value: string) {
  const el = document.body.querySelector<HTMLInputElement>('[placeholder="Search notes"]');
  if (!el) throw new Error('No search field');
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  const { act } = await import('react');
  await act(async () => {
    if (set) set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function send() {
  const btn = dom.container.querySelector('[aria-label="Send"]');
  if (!btn) throw new Error('No send button');
  await tap(btn);
}

describe('the composer without a vault', () => {
  it('treats [[ as plain text and opens nothing', async () => {
    await show();
    await dom.type(FIELD, 'see [[');
    expect(dialog()).toBeNull();
    expect(dom.value(FIELD)).toBe('see [[');
  });
});

describe('the [[ note picker', () => {
  it('opens on [[ and lists notes, never a hidden one, a private one locked', async () => {
    await show(vaultOf());
    await dom.type(FIELD, 'Look at [[');
    expect(pickerOpen()).toBe(true);
    expect(dialog()!.getAttribute('role')).toBe('dialog');
    const paths = rows().map((r) => r.dataset.path);
    expect(paths).not.toContain('secret/keys.md');
    // Newest first with nothing typed.
    expect(paths).toEqual(['journal/diary.md', 'projects/roadmap.md', 'ideas.md']);
    const diary = rows().find((r) => r.dataset.path === 'journal/diary.md')!;
    expect(diary.querySelector('[aria-label="Private note"]')).toBeTruthy();
    expect(diary.textContent).toContain('Stays on this computer');
    for (const r of rows()) expect(r.className).toContain('press-fb');
  });

  it('searches titles, a word inside a title too', async () => {
    await show(vaultOf());
    await dom.type(FIELD, '[[');
    await search('launch');
    expect(rows().map((r) => r.dataset.path)).toEqual(['projects/roadmap.md']);
    await search('keys');
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain('No note matches that.');
  });

  it('inserts a budgeted excerpt as a chip with its cost line, and sends it', async () => {
    await show(vaultOf());
    await dom.type(FIELD, 'Summarize [[');
    await pick('ideas.md');
    expect(pickerOpen()).toBe(false);
    expect(dom.value(FIELD)).toBe('Summarize ');
    expect(reads).toEqual(['ideas.md']);
    // min(2000, floor(4096 * 0.25)) = 1024.
    expect(excerpts[0]!.budget).toBe(1024);
    expect(excerpts[0]!.note.title).toBe('Ideas');
    expect(excerpts[0]!.note.updatedAt).toBe('2026-09-20T10:00:00Z');
    const chip = dom.container.querySelector('[data-note-chip]');
    expect(chip?.textContent).toContain('Ideas');
    expect(dom.text()).toMatch(/Ideas: About \d+ tokens of this model's 4096/);
    await send();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Summarize');
    expect(sent[0]!.text).toContain('From my note [[Ideas]]');
    expect(sent[0]!.text).toContain('Second idea.');
  });

  it('caps the budget at 2000 on a big window and 1024 on a device seat', async () => {
    await show(vaultOf({ seat: { servedTokens: 200000, device: false, leavesNetwork: true } }));
    await dom.type(FIELD, '[[');
    await pick('ideas.md');
    expect(excerpts[0]!.budget).toBe(2000);
    await dom.unmount();
    dom = await mountDom();
    Object.assign(window, { matchMedia: () => ({ matches: false }) });
    await show(vaultOf({ seat: { servedTokens: 32768, device: true, leavesNetwork: false } }));
    await dom.type(FIELD, '[[');
    await pick('ideas.md');
    expect(excerpts[1]!.budget).toBe(1024);
  });

  it('never lands an excerpt over its budget', async () => {
    await show(
      vaultOf({
        excerpt: (note, budget) => ({ text: note.text, tokens: budget + 1, trimmed: false }),
      }),
    );
    await dom.type(FIELD, '[[');
    await pick('ideas.md');
    expect(dom.container.querySelector('[data-note-chip]')).toBeNull();
    expect(app.toasts.join(' ')).toContain('would not fit this model');
  });

  it('says when a trimmed excerpt was cut to fit', async () => {
    await show(
      vaultOf({
        excerpt: (note) => ({ text: `From my note [[${note.title}]]`, tokens: 12, trimmed: true }),
      }),
    );
    await dom.type(FIELD, '[[');
    await pick('ideas.md');
    expect(dom.text()).toContain('Trimmed to fit.');
  });

  it('leaves [[ in the field when the picker is closed without a pick', async () => {
    await show(vaultOf());
    await dom.type(FIELD, 'about [[');
    const close = document.body.querySelector('.vault-note-picker [aria-label="Close"]')!;
    await tap(close);
    expect(pickerOpen()).toBe(false);
    expect(dom.value(FIELD)).toBe('about [[');
    expect(reads).toEqual([]);
  });
});

describe('a private note and a seat that leaves the network', () => {
  it('is refused at the tap with honest copy, and never read', async () => {
    const { PRIVATE_NOTE_REFUSED } = await import('../src/components/VaultNotePicker.js');
    expect(PRIVATE_NOTE_REFUSED).toBe(
      'Private notes stay on this computer. Switch to a local model to ask about it.',
    );
    await show(vaultOf({ seat: { servedTokens: 200000, device: false, leavesNetwork: true } }));
    await dom.type(FIELD, '[[');
    const diary = rows().find((r) => r.dataset.path === 'journal/diary.md')!;
    expect(diary.getAttribute('aria-disabled')).toBe('true');
    await pick('journal/diary.md');
    expect(pickerOpen()).toBe(true);
    expect(document.body.textContent).toContain(PRIVATE_NOTE_REFUSED);
    expect(reads).toEqual([]);
    expect(dom.container.querySelector('[data-note-chip]')).toBeNull();
  });

  it('goes to a local seat, and is held at send once the seat turns cloud', async () => {
    const { PRIVATE_NOTE_REFUSED } = await import('../src/components/VaultNotePicker.js');
    await show(vaultOf());
    await dom.type(FIELD, 'reflect on [[');
    await pick('journal/diary.md');
    expect(dom.container.querySelector('[data-note-chip]')).toBeTruthy();
    await show(vaultOf({ seat: { servedTokens: 200000, device: false, leavesNetwork: true } }));
    await send();
    expect(sent).toEqual([]);
    expect(app.toasts).toContain(PRIVATE_NOTE_REFUSED);
  });

  it('is refused when the seat turns cloud while the note is being read', async () => {
    const { PRIVATE_NOTE_REFUSED } = await import('../src/components/VaultNotePicker.js');
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow = vaultOf({
      read: async (path) => {
        reads.push(path);
        await gate;
        return { text: BODIES[path]! };
      },
    });
    await show(slow);
    await dom.type(FIELD, '[[');
    await pick('journal/diary.md');
    await show({ ...slow, seat: { servedTokens: 200000, device: false, leavesNetwork: true } });
    release();
    await dom.settle();
    await dom.settle();
    expect(dom.container.querySelector('[data-note-chip]')).toBeNull();
    expect(app.toasts).toContain(PRIVATE_NOTE_REFUSED);
  });
});

describe('Ask about this note (vault.take)', () => {
  it('takes the note in through the same budget, never sends it', async () => {
    await show(vaultOf({ take: { seq: 1, path: 'projects/roadmap.md' } }));
    await dom.settle();
    await dom.settle();
    expect(dom.container.querySelector('[data-note-chip]')?.textContent).toContain('Roadmap');
    expect(sent).toEqual([]);
  });

  it('fails closed on a hidden or unknown note', async () => {
    await show(vaultOf({ take: { seq: 1, path: 'secret/keys.md' } }));
    await dom.settle();
    expect(reads).toEqual([]);
    expect(dom.container.querySelector('[data-note-chip]')).toBeNull();
  });
});

describe('searchNotes and noteRefused (pure)', () => {
  it('ranks a title prefix over a word match over a path match', async () => {
    const { searchNotes } = await import('../src/components/VaultNotePicker.js');
    const notes: PickerNote[] = [
      { path: 'plan/x.md', title: 'Other', updatedAt: '2026-09-27T00:00:00Z', visibility: 'open' },
      { path: 'a.md', title: 'The plan', updatedAt: '2026-09-01T00:00:00Z', visibility: 'open' },
      { path: 'b.md', title: 'Plan B', updatedAt: '2026-09-02T00:00:00Z', visibility: 'open' },
      { path: 'c.md', title: 'Planet', updatedAt: '2026-09-03T00:00:00Z', visibility: 'hidden' },
    ];
    expect(searchNotes(notes, 'plan').map((n) => n.path)).toEqual(['b.md', 'a.md', 'plan/x.md']);
    expect(searchNotes(notes, '', 2).map((n) => n.path)).toEqual(['plan/x.md', 'b.md']);
  });

  it('refuses hidden always and local-only only off the network', async () => {
    const { noteRefused } = await import('../src/components/VaultNotePicker.js');
    expect(noteRefused({ visibility: 'hidden' }, false)).toBe(true);
    expect(noteRefused({ visibility: 'local-only' }, true)).toBe(true);
    expect(noteRefused({ visibility: 'local-only' }, false)).toBe(false);
    expect(noteRefused({ visibility: 'open' }, true)).toBe(false);
  });
});

describe('the picker follows the house motion standard', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/VaultNotePicker.tsx'), 'utf8');
  it('rises in the presence-aware Sheet and ticks through lib/haptics', () => {
    expect(src).toMatch(/import \{ Sheet \} from '\.\/Sheet\.js'/);
    expect(src).toMatch(/from '\.\.\/lib\/haptics\.js'/);
    expect(src).not.toMatch(/navigator\.vibrate|cubic-bezier|transition:/);
  });
});
