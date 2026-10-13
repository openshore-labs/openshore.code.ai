// The Vault's view swaps are true crossfades (motion standard, rule 3; tech review
// K18, UX review X17): tree and note, read and edit, and the Trash page each way
// (Vault M8, the M6 follow-up: leaving Trash used to cut). The arriving view fades in
// while a snapshot of the leaving one fades out, inert and aria-hidden, on the
// tokens, and reduced motion leaves no snapshot at all. Pinned two ways: the
// hook, mounted in a small real DOM, and a guard over VaultScreen.tsx that
// fails any Vault view root rendered without its exit binding.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const SRC = join(process.cwd(), 'src');
const SCREEN = readFileSync(join(SRC, 'screens', 'VaultScreen.tsx'), 'utf8');
const THEME = readFileSync(join(SRC, 'theme.css'), 'utf8');
const TRASH = readFileSync(join(SRC, 'components', 'vault', 'VaultTrashView.tsx'), 'utf8');

// The roots of the views that replace each other inside the room. The Trash
// page's root lives in its own component and takes the room's ghost as
// `rootRef`.
const VIEW_ROOTS = [
  'vault-tree-view',
  'vault-note',
  'vault-editor-wrap',
  'vault-read',
  'vault-trash',
];

describe('the guard: no Vault view swaps without an exit binding', () => {
  // Every opening <div> tag in the screen (an arrow's `=>` is not its end).
  const tags = [SCREEN, TRASH].flatMap((src) =>
    [...src.matchAll(/<div\b((?:=>|[^>])*)>/g)].map((m) => m[1]!),
  );
  const classesOf = (tag: string) =>
    [...tag.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .join(' ')
      .split(/[\s'"`:?]+/)
      .filter(Boolean);

  it('binds a ghost ref on every view root', () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const tag of tags) {
      const roots = classesOf(tag).filter((c) => VIEW_ROOTS.includes(c));
      if (!roots.length) continue;
      roots.forEach((r) => seen.add(r));
      if (
        !/ref=\{(?:pageGhost|modeGhost)\('[a-z]+'\)\}|ref=\{bindReader\}|ref=\{rootRef\}/.test(tag)
      ) {
        offenders.push(`${roots.join(', ')}: ${tag.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, offenders.join('\n  ')).toEqual([]);
    // A renamed root must not pass by being missed.
    expect([...seen].sort()).toEqual([...VIEW_ROOTS].sort());
  });

  it('keys each ghost by the view the render shows, and the reader binds its own', () => {
    expect(SCREEN).toMatch(/useViewGhost\(vaultNote \? 'note' : trashOpen \? 'trash' : 'tree'\)/);
    expect(SCREEN).toMatch(/useViewGhost\(editing && !locked \? 'edit' : 'read'\)/);
    expect(SCREEN).toMatch(
      /const bindReader = useCallback\([\s\S]{0,200}modeGhost\('read'\)\(node\)/,
    );
  });

  it('binds the Trash page to the room ghost, inside the room screen that outlives the swap', () => {
    expect(SCREEN).toMatch(/<VaultTrashView\s+rootRef=\{pageGhost\('trash'\)\}/);
    // The snapshot is placed beside the leaving root, so that root's parent
    // must survive the swap: the Trash branch renders in the same
    // `.vault-screen` the tree and the note do, and the page has no screen
    // of its own.
    const branch = SCREEN.slice(SCREEN.indexOf('if (trashOpen) {'));
    expect(branch).toMatch(
      /^if \(trashOpen\) \{\s*return \(\s*<div className="screen vault-screen">/,
    );
    expect(TRASH).not.toMatch(/className="screen"/);
  });

  it('fades the snapshot out on the tokens, and reduced motion stills it', () => {
    const rule = THEME.match(/\.view-ghost\.closing \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(
      /animation: vault-view-out var\(--dur-3\) var\(--ease-standard\) forwards/,
    );
    expect(rule).toMatch(/pointer-events: none/);
    expect(THEME).toMatch(/@keyframes vault-view-out \{[^@]*opacity: 0/);
    const reduced = [
      ...THEME.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
    ].map((m) => m[1]!);
    expect(reduced.some((b) => b.includes('.view-ghost.closing'))).toBe(true);
    // The room's scroller holds it.
    expect(THEME).toMatch(/\.vault-screen \{\s*position: relative;/);
  });
});

describe('useViewGhost', () => {
  let dom: TestDom;
  let reduce = false;
  beforeEach(async () => {
    reduce = false;
    dom = await mountDom();
    Object.assign(window, {
      matchMedia: (q: string) => ({ matches: q.includes('reduce') ? reduce : false }),
    });
  });
  afterEach(async () => {
    await dom.unmount();
    vi.useRealTimers();
  });

  let flip: (v: string) => void = () => {};
  let rekey: () => void = () => {};
  async function Harness() {
    const { useViewGhost } = await import('../src/hooks/useViewGhost.js');
    return function View() {
      const [view, setView] = useState('tree');
      const [n, setN] = useState(0);
      flip = setView;
      rekey = () => setN((x) => x + 1);
      const ghost = useViewGhost(view);
      return (
        <div className="screen">
          {view === 'tree' ? (
            <div key={`tree:${n}`} ref={ghost('tree')} id="list" className="tree">
              the notes list
              <button type="button">Ideas</button>
            </div>
          ) : (
            <div key="note" ref={ghost('note')} className="note">
              <textarea defaultValue="" />
            </div>
          )}
        </div>
      );
    };
  }

  const ghosts = () => [...dom.container.querySelectorAll('.view-ghost')] as HTMLElement[];

  it('leaves an inert, aria-hidden snapshot of the leaving view that is gone after the clock', async () => {
    vi.useFakeTimers();
    const View = await Harness();
    await dom.render(<View />);
    const { act } = await import('react');
    await act(async () => flip('note'));
    const [g] = ghosts();
    expect(g).toBeTruthy();
    expect(g!.classList.contains('closing')).toBe(true);
    expect(g!.classList.contains('tree')).toBe(true);
    expect(g!.getAttribute('aria-hidden')).toBe('true');
    expect(g!.hasAttribute('inert')).toBe(true);
    expect(g!.hasAttribute('id')).toBe(false);
    // Both are on screen while they cross: the arriving view is live.
    expect(dom.container.querySelector('.note:not(.view-ghost)')).toBeTruthy();
    const { viewGhostMs } = await import('../src/hooks/useViewGhost.js');
    await act(async () => {
      vi.advanceTimersByTime(viewGhostMs());
    });
    expect(ghosts()).toEqual([]);
  });

  it('keeps what was typed in the snapshot of an editor', async () => {
    const View = await Harness();
    await dom.render(<View />);
    const { act } = await import('react');
    await act(async () => flip('note'));
    const field = dom.container.querySelector(
      '.note:not(.view-ghost) textarea',
    ) as HTMLTextAreaElement;
    field.value = 'typed words';
    await act(async () => flip('tree'));
    const g = ghosts().find((el) => el.classList.contains('note'));
    expect((g?.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('typed words');
  });

  it('leaves no snapshot for a re-key of the same view', async () => {
    const View = await Harness();
    await dom.render(<View />);
    const { act } = await import('react');
    await act(async () => rekey());
    expect(ghosts()).toEqual([]);
  });

  it('leaves no snapshot under reduced motion', async () => {
    reduce = true;
    const View = await Harness();
    await dom.render(<View />);
    const { act } = await import('react');
    await act(async () => flip('note'));
    expect(ghosts()).toEqual([]);
  });
});

// The real Trash page in the room's shape: leaving it (Back) leaves a fading
// snapshot of the page over the tree that arrives, and entering it leaves one
// of the tree.
describe('the Trash page crossfades each way', () => {
  let dom: TestDom;
  beforeEach(async () => {
    dom = await mountDom();
    Object.assign(window, { matchMedia: () => ({ matches: false }) });
  });
  afterEach(async () => {
    await dom.unmount();
  });

  let open: (v: boolean) => void = () => {};
  async function Room() {
    const { useViewGhost } = await import('../src/hooks/useViewGhost.js');
    const { VaultTrashView } = await import('../src/components/vault/VaultTrashView.js');
    const noop = async () => {};
    return function View() {
      const [trashOpen, setTrashOpen] = useState(true);
      open = setTrashOpen;
      const pageGhost = useViewGhost(trashOpen ? 'trash' : 'tree');
      if (trashOpen) {
        return (
          <div className="screen vault-screen">
            <VaultTrashView
              rootRef={pageGhost('trash')}
              kind="folder"
              entries={[]}
              onBack={() => setTrashOpen(false)}
              onRestore={noop}
              onEmpty={noop}
            />
          </div>
        );
      }
      return (
        <div className="screen vault-screen">
          <div key="tree" ref={pageGhost('tree')} className="screen-inner vault-tree-view">
            the notes list
          </div>
        </div>
      );
    };
  }

  const ghosts = () => [...dom.container.querySelectorAll('.view-ghost')] as HTMLElement[];

  it('leaving Trash fades the page out instead of cutting', async () => {
    const View = await Room();
    await dom.render(<View />);
    const { act } = await import('react');
    await act(async () => open(false));
    const g = ghosts().find((el) => el.classList.contains('vault-trash'));
    expect(g, 'a snapshot of the Trash page').toBeTruthy();
    expect(g!.classList.contains('closing')).toBe(true);
    expect(g!.getAttribute('aria-hidden')).toBe('true');
    expect(dom.container.querySelector('.vault-tree-view:not(.view-ghost)')).toBeTruthy();
  });

  it('entering Trash fades the tree out', async () => {
    const View = await Room();
    await dom.render(<View />);
    const { act } = await import('react');
    await act(async () => open(false));
    await act(async () => open(true));
    expect(ghosts().some((el) => el.classList.contains('vault-tree-view'))).toBe(true);
  });
});
