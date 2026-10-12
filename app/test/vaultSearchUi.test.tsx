// The Vault's search field and quick switcher, mounted for real (Vault M6
// 6.1; UX review X1 to X4): the tree swaps for results while searching; titles show
// at once and text hits follow with excerpts; every match is a <mark>
// element, never HTML from the note; each honest state says its line; the
// keys move through one listbox with aria-activedescendant; the switcher
// shows Today's note first, then Recent, and offers a new note when no title
// matches exactly; an agent-written Recent row carries its label only where
// the screen passes one.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';
import { fakeParse, fakeRanges } from './support/vaultQueryFake.js';
import type { VaultSearchOptions, VaultTitleHit } from 'os-code/protocol';
import { VaultSearch, isFindChord } from '../src/components/vault/VaultSearch.js';
import { VaultSwitcher, isSwitcherChord } from '../src/components/vault/VaultSwitcher.js';
import type {
  VaultQueryCore,
  VaultRecentRow as Recent,
  VaultSearchIndex,
  VaultSearchSource as Source,
} from '../src/lib/vaultSearch.js';

let dom: TestDom;
beforeEach(async () => {
  dom = await mountDom();
});
afterEach(async () => {
  await dom.unmount();
});

const CORE: VaultQueryCore = {
  parseVaultQuery: fakeParse,
  highlightRanges: fakeRanges,
};

const NOTES: Record<string, { title: string; text: string; updatedAt: string }> = {
  'Work/Plans/Roadmap.md': {
    title: 'Roadmap',
    text: '# Roadmap\n\nShip the harbor lantern by Friday.',
    updatedAt: '2026-09-20T00:00:00Z',
  },
  'Ideas.md': {
    title: 'Ideas',
    text: 'A lantern for the garden, and a <img src=x onerror=alert(1)> test.',
    updatedAt: '2026-09-21T00:00:00Z',
  },
  'Crew/Standup.md': {
    title: 'Standup',
    text: 'The agent wrote this standup.',
    updatedAt: '2026-09-27T07:00:00Z',
  },
  'Odd.md': {
    title: '<b>Odd</b> lantern',
    text: 'plain',
    updatedAt: '2026-09-01T00:00:00Z',
  },
};

function source(reads = { n: 0 }): Source {
  const fold = (s: string) => s.toLowerCase();
  return {
    titleMatches(q: string, limit: number): VaultTitleHit[] {
      const terms = fakeParse(q).clauses.filter((c) => c.kind === 'term' && !c.negated);
      if (!terms.length) return [];
      return Object.entries(NOTES)
        .filter(([, n]) => terms.every((c) => fold(n.title).includes(c.value)))
        .slice(0, limit)
        .map(([path, n]) => ({
          path,
          score: 1,
          field: 'title' as const,
          text: n.title,
          ranges: fakeRanges(n.title, fakeParse(q)),
        }));
    },
    search(q: string, opts: VaultSearchOptions) {
      const terms = fakeParse(q).clauses.filter((c) => c.kind === 'term' && !c.negated);
      return Object.entries(NOTES)
        .filter(([, n]) => terms.length && terms.every((c) => fold(n.text).includes(c.value)))
        .slice(0, opts.limit ?? 50)
        .map(([path]) => ({ path, score: 1 }));
    },
    note: (path) => NOTES[path],
    async readBody(path) {
      reads.n++;
      return NOTES[path]?.text;
    },
  };
}

const TREE = <div className="vault-tree">the tree itself</div>;
const field = () => dom.container.querySelector('input[type="search"]') as HTMLInputElement;

async function key(el: Element, k: string, extra: Record<string, unknown> = {}) {
  const { act } = await import('react');
  await act(async () => {
    const e = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.assign(e, { key: k, shiftKey: false, metaKey: false, ctrlKey: false, ...extra });
    el.dispatchEvent(e);
  });
}

async function focusField() {
  const { act } = await import('react');
  await act(async () => {
    field().dispatchEvent(new window.Event('focusin', { bubbles: true }));
  });
}

async function wait(ms: number) {
  const { act } = await import('react');
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function Harness(props: {
  initial?: string;
  index?: VaultSearchIndex;
  away?: boolean;
  recent?: Recent[];
  agentLabel?: string;
  opened?: string[];
  retried?: { n: number };
  src?: Source;
}) {
  // A tiny controlled parent: the screen holds the query.
  const [q, setQ] = useState(props.initial ?? '');
  return (
    <VaultSearch
      query={q}
      onQuery={setQ}
      source={props.src ?? source()}
      core={CORE}
      index={props.index ?? { kind: 'ready' }}
      away={props.away}
      recent={props.recent}
      agentLabel={props.agentLabel}
      onRetryIndex={() => props.retried && props.retried.n++}
      onOpen={(p) => props.opened?.push(p)}
      debounceMs={0}
    >
      {TREE}
    </VaultSearch>
  );
}

describe('the tree search field (X1, X2)', () => {
  it('shows the tree until searching, with the house field and labels', async () => {
    await dom.render(<Harness />);
    expect(dom.text()).toContain('the tree itself');
    expect(field().getAttribute('placeholder')).toBe('Search notes');
    expect(field().getAttribute('aria-label')).toBe('Search your vault');
  });

  it('focused and empty: the hint and Recent, and the agent label only when passed', async () => {
    const recent: Recent[] = [
      {
        path: 'Crew/Standup.md',
        title: 'Standup',
        folder: 'Crew',
        at: '2026-09-27T07:00:00Z',
        agent: true,
      },
      { path: 'Ideas.md', title: 'Ideas', folder: '', at: '2026-09-21T00:00:00Z', agent: false },
    ];
    await dom.render(<Harness recent={recent} agentLabel="From your agent" />);
    await focusField();
    expect(dom.text()).toContain('Try tag:, path:, file:, or "an exact phrase".');
    expect(dom.text()).toContain('Recent');
    expect(dom.text()).toContain('From your agent');
    await dom.unmount();
    dom = await mountDom();
    await dom.render(<Harness recent={recent} />);
    await focusField();
    expect(dom.text()).toContain('Standup');
    expect(dom.text()).not.toMatch(/agent/i);
  });

  it('titles at once, then text hits with excerpts, matches as <mark> elements', async () => {
    const reads = { n: 0 };
    await dom.render(<Harness src={source(reads)} />);
    await dom.type('Search notes', 'lantern');
    // Titles: at once, no read.
    expect(dom.text()).toContain('Titles');
    const marks = [...dom.container.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toContain('lantern');
    await dom.settle();
    await dom.settle();
    expect(dom.text()).toContain('In notes');
    expect(dom.text()).toContain('Ship the harbor lantern by Friday.');
    expect(dom.text()).toContain('3 notes');
    // The tree is out of the way while results show.
    await wait(260);
    const layer = dom.container.querySelector('.vault-tree')!.parentElement!;
    expect(layer.hasAttribute('hidden')).toBe(true);
    expect(reads.n).toBeLessThanOrEqual(20);
  });

  it('never renders a note as HTML', async () => {
    await dom.render(<Harness />);
    await dom.type('Search notes', 'lantern');
    await dom.settle();
    await dom.settle();
    expect(dom.container.querySelector('img')).toBeNull();
    expect(dom.container.querySelector('b')).toBeNull();
    expect(dom.text()).toContain('<b>Odd</b>');
    expect(dom.text()).toContain('<img src=x onerror=alert(1)>');
  });

  it('labels each row for VoiceOver as title, folder, excerpt', async () => {
    await dom.render(<Harness />);
    await dom.type('Search notes', 'roadmap');
    const row = dom.container.querySelector('[role="option"]')!;
    expect(row.getAttribute('aria-label')).toBe('Roadmap, in Work / Plans.');
    expect(dom.text()).toContain('Work / Plans');
  });

  it('moves through the listbox with the keys, opens with Enter, clears with Esc', async () => {
    const opened: string[] = [];
    await dom.render(<Harness opened={opened} />);
    await dom.type('Search notes', 'lantern');
    await dom.settle();
    await dom.settle();
    const options = [...dom.container.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(1);
    expect(field().getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    await key(field(), 'ArrowDown');
    expect(field().getAttribute('aria-activedescendant')).toBe(options[1]!.id);
    expect(options[1]!.getAttribute('aria-selected')).toBe('true');
    await key(field(), 'Enter');
    expect(opened).toHaveLength(1);
    await key(field(), 'Escape');
    expect(field().value).toBe('');
    await wait(260);
    expect(dom.text()).toContain('the tree itself');
  });

  it('says no match, and that more may appear while the index reads', async () => {
    await dom.render(<Harness index={{ kind: 'loading', done: 3, total: 40 }} />);
    await dom.type('Search notes', 'zzzz');
    await dom.settle();
    await dom.settle();
    expect(dom.text()).toContain('Titles are ready. Reading note text, 3 of 40.');
    expect(dom.text()).toContain('No notes match "zzzz". More may appear as notes finish loading.');
  });

  it('a failed index says titles only, reads no bodies, and offers Try again', async () => {
    const reads = { n: 0 };
    const retried = { n: 0 };
    await dom.render(<Harness src={source(reads)} index={{ kind: 'failed' }} retried={retried} />);
    await dom.type('Search notes', 'lantern');
    await dom.settle();
    expect(dom.text()).toContain('Could not read note text for search, so only titles match.');
    expect(dom.text()).not.toContain('In notes');
    expect(reads.n).toBe(0);
    await dom.click('Try again');
    expect(retried.n).toBe(1);
  });

  it('says when Your computer is away', async () => {
    await dom.render(<Harness away />);
    await dom.type('Search notes', 'lantern');
    expect(dom.text()).toContain(
      'Your computer is off, so this searches the notes last seen here.',
    );
  });

  it('knows the find and switcher chords', () => {
    const k = (
      key: string,
      o: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>,
    ) => ({
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...o,
    });
    expect(isFindChord(k('f', { metaKey: true, shiftKey: true }))).toBe(true);
    expect(isFindChord(k('F', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isFindChord(k('f', { metaKey: true }))).toBe(false);
    expect(isSwitcherChord(k('o', { metaKey: true }))).toBe(true);
    expect(isSwitcherChord(k('o', { ctrlKey: true }))).toBe(true);
    expect(isSwitcherChord(k('o', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSwitcherChord(k('o', {}))).toBe(false);
  });
});

describe('the quick switcher (X3, X4)', () => {
  const recent: Recent[] = [
    {
      path: 'Crew/Standup.md',
      title: 'Standup',
      folder: 'Crew',
      at: '2026-09-27T07:00:00Z',
      agent: true,
    },
  ];

  function Switcher(props: {
    picked: string[];
    created?: string[];
    today?: { n: number };
    agentLabel?: string;
  }) {
    return (
      <VaultSwitcher
        open
        onClose={() => {}}
        source={source()}
        core={CORE}
        recent={recent}
        agentLabel={props.agentLabel}
        onPick={(p) => props.picked.push(p)}
        onToday={() => props.today && props.today.n++}
        onCreate={(name) => props.created?.push(name)}
      />
    );
  }

  it('opens on Today first, then Recent, with the agent label passed in', async () => {
    await dom.render(<Switcher picked={[]} agentLabel="From your agent" />);
    expect(dom.text()).toContain('Open a note');
    const options = [...dom.container.querySelectorAll('[role="option"]')].map(
      (o) => o.textContent,
    );
    expect(options[0]).toBe("Today's note");
    expect(options[1]).toContain('Standup');
    expect(options[1]).toContain('From your agent');
    expect(dom.container.querySelector('input')!.getAttribute('placeholder')).toBe(
      'Type a note name',
    );
  });

  it('Enter on Today runs Today after the exit', async () => {
    const today = { n: 0 };
    await dom.render(<Switcher picked={[]} today={today} />);
    await key(dom.container.querySelector('input')!, 'Enter');
    expect(today.n).toBe(0);
    await wait(700);
    expect(today.n).toBe(1);
  });

  it('titles only while typing, a pick lands after the exit', async () => {
    const picked: string[] = [];
    await dom.render(<Switcher picked={picked} />);
    await dom.type('Type a note name', 'road');
    const options = [...dom.container.querySelectorAll('[role="option"]')].map(
      (o) => o.textContent,
    );
    expect(options[0]).toContain('Roadmap');
    expect(options[options.length - 1]).toBe('New note "road"');
    await key(dom.container.querySelector('input')!, 'Enter');
    expect(picked).toEqual([]);
    await wait(700);
    expect(picked).toEqual(['Work/Plans/Roadmap.md']);
  });

  it('offers no new note when the title matches exactly; Shift+Enter creates otherwise', async () => {
    const created: string[] = [];
    await dom.render(<Switcher picked={[]} created={created} />);
    await dom.type('Type a note name', 'ideas');
    expect(dom.text()).not.toContain('New note');
    await dom.type('Type a note name', 'Garden plan');
    expect(dom.text()).toContain('New note "Garden plan"');
    await key(dom.container.querySelector('input')!, 'Enter', { shiftKey: true });
    await wait(700);
    expect(created).toEqual(['Garden plan']);
  });
});
