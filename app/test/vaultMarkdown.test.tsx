// A bad link cannot blank the app (0.10, ui-9). A hand-written or pasted
// vault: link with a broken percent-escape threw URIError from
// decodeURIComponent during render, and with no error boundary React took the
// whole app down with it. The decode is now wrapped, and a boundary sits
// around the note and around the Vault room for anything else. The boundary
// cases mount React in a real (small) DOM, since a boundary only catches a
// fault thrown inside a real client render (test/support/dom.ts).
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VaultMarkdown, vaultHrefPath } from '../src/components/VaultMarkdown.js';
import { ErrorBoundary } from '../src/components/ErrorBoundary.js';
import { mountDom, type TestDom } from './support/dom.js';
import { listTasks, readFrontmatter } from 'os-code/protocol';
import { restoreEol } from '../src/lib/vault.js';
import { vaultAutosave } from '../src/lib/vaultAutosave.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createVaultBlobs, vaultBlobKey } from '../src/lib/vaultBlobs.js';
import { vaultReaderCopy } from '../src/lib/vaultCopy.js';
import type { VaultMedia } from '../src/components/VaultMarkdown.js';
import type { AttachmentMeta, BytesRead } from 'os-code/protocol';

// One body that trips the renderer, the way a malformed note could: the
// wikilink pass throws for it, and only for it. The pass is the remark plugin
// now (Vault M3 3.3), so the fault is raised inside the real render.
vi.mock('../src/lib/remarkWikilinks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/remarkWikilinks.js')>();
  return {
    ...actual,
    remarkWikilinks: (opts: Parameters<typeof actual.remarkWikilinks>[0]) => {
      const run = actual.remarkWikilinks(opts);
      return (tree: object) => {
        if (JSON.stringify(tree).includes('TRIPS THE RENDERER')) throw new Error('render fault');
        run(tree);
      };
    },
  };
});

// The pure Obsidian helpers are stream A2's real ones (os-code/src/harness
// vault markdown.ts and attachments.ts), so these cases test the reader over
// the parser it ships with.

const render = (text: string, paths: string[] = []) =>
  renderToStaticMarkup(<VaultMarkdown text={text} paths={paths} onOpenNote={() => {}} />);

describe('VaultMarkdown with a malformed vault: link', () => {
  it('renders [x](vault:%E0%A4%A) without throwing', () => {
    let html = '';
    expect(() => {
      html = render('[x](vault:%E0%A4%A)');
    }).not.toThrow();
    expect(html).toContain('>x</a>');
    // The href the link carries still cannot be decoded (the parser escapes
    // the lone % but the truncated byte sequence stays), so this is the case
    // that used to throw during render.
    const href = /href="vault:([^"]*)"/.exec(html)?.[1] ?? '';
    expect(href.startsWith('%E0%A4')).toBe(true);
    expect(() => decodeURIComponent(href)).toThrow(URIError);
  });

  it('still renders the rest of the note around it, wikilinks included', () => {
    const html = render('Before [[Ideas]] and [bad](vault:%E0) after.', ['Ideas.md']);
    expect(html).toContain('Before');
    expect(html).toContain('after.');
    expect(html).toContain('class="wikilink"');
  });

  it('decodes a good path, and falls back to the raw text for a broken one', () => {
    expect(vaultHrefPath('vault:Ideas%2FVault.md')).toBe('Ideas/Vault.md');
    expect(vaultHrefPath('vault:100%25.md?new')).toBe('100%.md');
    expect(vaultHrefPath('vault:%E0%A4%A')).toBe('%E0%A4%A');
    expect(vaultHrefPath('vault:100%?new')).toBe('100%');
  });
});

describe('ErrorBoundary', () => {
  const fallback = () => <p>fell back</p>;

  it('clears the fault when its key changes (the next note, edited text)', () => {
    const props = { fallback, children: null };
    expect(
      ErrorBoundary.getDerivedStateFromProps(
        { ...props, resetKey: 'a' },
        { failed: true, key: 'a' },
      ),
    ).toBeNull();
    expect(
      ErrorBoundary.getDerivedStateFromProps(
        { ...props, resetKey: 'b' },
        { failed: true, key: 'a' },
      ),
    ).toEqual({ failed: false, key: 'b' });
  });
});

// A child that throws while rendering, until told not to.
const faults = { on: true };
function Fragile({ label = 'the note' }: { label?: string }) {
  if (faults.on) throw new Error('render fault');
  return <p>{label}</p>;
}

describe('ErrorBoundary in a real render', () => {
  let dom: TestDom;
  beforeEach(async () => {
    faults.on = true;
    // React reports every caught render fault on the console; the fallback
    // on screen is what these cases check.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
    vi.restoreAllMocks();
  });

  it('turns a fault thrown while rendering into the fallback, and the rest of the app stays', async () => {
    await dom.render(
      <main>
        <h1>The app</h1>
        <ErrorBoundary fallback={() => <p>fell back</p>}>
          <Fragile />
        </ErrorBoundary>
      </main>,
    );
    expect(dom.text()).toBe('The appfell back');
  });

  it("the fallback's reset renders the children again once they can render", async () => {
    await dom.render(
      <ErrorBoundary fallback={(reset) => <button onClick={reset}>Try again</button>}>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(dom.buttons()).toEqual(['Try again']);
    // Still faulting: the reset shows the fallback again, never a blank.
    await dom.click('Try again');
    expect(dom.buttons()).toEqual(['Try again']);
    faults.on = false;
    await dom.click('Try again');
    expect(dom.text()).toBe('the note');
  });

  it('a new reset key (the next note) clears the fault without a tap', async () => {
    function Room() {
      const [note, setNote] = useState('a');
      return (
        <>
          <button onClick={() => setNote('b')}>Open b</button>
          <ErrorBoundary resetKey={note} fallback={() => <p>fell back</p>}>
            <Fragile label={note} />
          </ErrorBoundary>
        </>
      );
    }
    await dom.render(<Room />);
    expect(dom.text()).toBe('Open bfell back');
    faults.on = false;
    await dom.click('Open b');
    expect(dom.text()).toBe('Open bb');
  });

  it('a note body that trips the renderer shows as plain text, inside the note', async () => {
    const body = '# Plan\n\nTRIPS THE RENDERER [[Ideas]]';
    await dom.render(
      <main>
        <h1>Plan</h1>
        <VaultMarkdown text={body} paths={['Ideas.md']} onOpenNote={() => {}} />
      </main>,
    );
    expect(dom.text()).toContain('Plan');
    expect(dom.text()).toContain('could not be shown formatted');
    expect(dom.container.querySelector('pre.vault-raw')?.textContent).toBe(body);
  });
});

// Vault M3 3.3 (CTO H2): the core finds the frontmatter and the renderer shows
// only `text.slice(fm.end)`, so YAML is never read as markdown; properties sit
// in a quiet strip above; and nothing on the read path ever writes the note.
describe('frontmatter in the reader (Vault M3 H2)', () => {
  const note = (eol: string, bom = '') =>
    `${bom}---${eol}title: Plan${eol}tags: [work, q3]${eol}up: "[[Roadmap]]"${eol}---${eol}# Goals${eol}${eol}Ship it.${eol}`;

  it('YAML is not an H2, and never shows as a rule or text in the body', () => {
    for (const eol of ['\n', '\r\n']) {
      for (const bom of ['', '\uFEFF']) {
        const html = render(note(eol, bom), ['Roadmap.md']);
        expect(html).not.toContain('<h2');
        expect(html).not.toContain('<hr');
        expect(html).not.toContain('title: Plan');
        expect(html).toContain('<h1 data-heading-index="0">Goals</h1>');
        expect(html).toContain('Ship it.');
        // The strip is there, closed: a count, no values until it opens.
        expect(html).toContain('3 properties');
        expect(html).toContain('aria-expanded="false"');
      }
    }
  });

  it('a note with no frontmatter, or an empty block, shows no strip', () => {
    expect(render('# Just a note')).not.toContain('vault-props');
    expect(render('---\n---\nBody')).not.toContain('vault-props');
    // A lone "---" rule mid-note is a rule, not frontmatter.
    expect(render('Intro\n\n---\n\nMore')).toContain('<hr/>');
  });

  it('a block that cannot be read says so, and still keeps YAML out of the body', () => {
    const html = render('---\na: 1\na: 2\n---\nBody text');
    expect(html).toContain('Properties could not be read');
    expect(html).not.toContain('<h2');
    expect(html).toContain('Body text');
  });

  it('opening and saving with no edit writes nothing', () => {
    const saves: string[] = [];
    const autosave = vaultAutosave({
      target: () => ({ providerId: 'local', resourceId: 'vault' }),
      save: (_path, text) => saves.push(text),
    });
    for (const text of [note('\n'), note('\r\n'), note('\r\n', '\uFEFF')]) {
      // Open: the reader renders it (and reads its YAML); nothing schedules.
      render(text, ['Roadmap.md']);
      // Leave the note: the flush sends only text that was typed.
      autosave.flush();
      // The textarea hands back CRLF as LF; untouched, the save wrap gives
      // the exact loaded bytes back, so even a stray save changes nothing.
      expect(restoreEol(text, text.replace(/\r\n/g, '\n'))).toBe(text);
    }
    expect(saves).toEqual([]);
  });

  it('a body-only edit keeps the frontmatter bytes identical, for LF, CRLF and a BOM', () => {
    for (const [eol, bom] of [
      ['\n', ''],
      ['\r\n', ''],
      ['\n', '\uFEFF'],
      ['\r\n', '\uFEFF'],
    ] as const) {
      const loaded = note(eol, bom);
      const fm = readFrontmatter(loaded);
      expect(fm.state).toBe('ok');
      // What the textarea shows (CRLF folded to LF), with the body edited.
      const typed = `${loaded.replace(/\r\n/g, '\n')}More.\n`;
      const saved = restoreEol(loaded, typed);
      expect(saved.slice(0, fm.end)).toBe(loaded.slice(0, fm.end));
      expect(saved.startsWith(loaded)).toBe(true);
      expect(readFrontmatter(saved).raw).toBe(fm.raw);
    }
  });

  it('a code fence renders verbatim: no wikilink, no tag, no emphasis inside', () => {
    const body = '```\n[[Roadmap]] and #tag and **bold** and ![[Art]]\n```\n\nOut: [[Roadmap]]';
    const html = render(body, ['Roadmap.md']);
    expect(html).toContain('[[Roadmap]] and #tag and **bold** and ![[Art]]');
    // The only link is the one outside the fence.
    expect(html.match(/class="wikilink/g)).toHaveLength(1);
    expect(html).not.toContain('<strong>');
    // A code span holds its link as text too.
    expect(render('Use `[[Roadmap]]` to link.', ['Roadmap.md'])).not.toContain('wikilink');
  });

  it('resolves links from the note being read, and opens a markdown link to a note', () => {
    const html = renderToStaticMarkup(
      <VaultMarkdown
        text={'[[Plan]] and [the list](Tasks.md) and [[#Goals]]'}
        paths={['a/Plan.md', 'b/Plan.md', 'b/Tasks.md']}
        sourcePath="b/Index.md"
        onOpenNote={() => {}}
      />,
    );
    expect(html).toContain('href="vault:b%2FPlan.md"');
    expect(html).toContain('<a href="Tasks.md" class="wikilink">the list</a>');
    expect(html).toContain('href="vault:b%2FIndex.md#Goals"');
  });
});

// ---------------------------------------------------------------------------
// Vault M6 6.5 and 6.6 (CTO K10, K11; CX X12 to X14): one case per syntax.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A media source over a fake provider and an injected registry, recording
 *  every read and every URL made and revoked. */
function fakeMedia(over: Partial<VaultMedia> & { files?: Record<string, BytesRead> } = {}) {
  const made: string[] = [];
  const revoked: string[] = [];
  const reads: string[] = [];
  const files: Record<string, BytesRead> = over.files ?? {
    'art/cat.png': { ok: true, bytes: PNG, mime: 'image/png', version: 'v1' },
  };
  const attachments: AttachmentMeta[] = Object.keys(files).map((path) => ({
    path,
    size: 11,
    updatedAt: '',
    version: 'v1',
    mime: path.endsWith('.pdf') ? 'application/pdf' : 'image/png',
  }));
  const registry = createVaultBlobs({
    createUrl: () => {
      const url = `blob:test/${made.length + 1}`;
      made.push(url);
      return url;
    },
    revokeUrl: (url) => revoked.push(url),
  });
  const media: VaultMedia = {
    scope: 'local:vault',
    attachments,
    readBytes: async (path) => {
      reads.push(path);
      return files[path] ?? { ok: false, reason: 'absent' };
    },
    registry,
    ...over,
  };
  return { media, made, revoked, reads, registry };
}

describe('callouts (X12)', () => {
  it('renders the four families from the status tokens, with a title or the type', () => {
    const html = render(
      '> [!warning] Mind the gap\n> Body **text**\n\n> [!tip]\n> Short\n\n> [!zebra-note]\n> Odd one\n\n> [!bug] Crash',
    );
    expect(html).toContain('vault-callout vault-callout--caution');
    expect(html).toContain('Mind the gap');
    expect(html).toContain('<strong>text</strong>');
    expect(html).toContain('vault-callout vault-callout--positive');
    expect(html).toContain('>Tip</span>');
    // An unknown type is neutral, titled by itself; the raw type never
    // reaches a class name.
    expect(html).toContain('vault-callout vault-callout--neutral');
    expect(html).toContain('>Zebra note</span>');
    expect(html).not.toContain('zebra-note"');
    expect(html).toContain('vault-callout vault-callout--danger');
    expect(html).not.toContain('<blockquote');
    // A plain quote stays a quote.
    expect(render('> Just a quote')).toContain('<blockquote>');
  });

  it('never borrows teal or amber: no callout rule reads --local, --cloud or --accent', () => {
    const css = readFileSync(join(__dirname, '../src/theme.css'), 'utf8');
    const fence = css.slice(
      css.indexOf('/* ---- M6 stream E begin ----'),
      css.indexOf('/* ---- M6 stream E end ---- */'),
    );
    expect(fence).toContain('.vault-callout--caution');
    expect(fence).not.toMatch(/var\(--(?:local|cloud|accent)[\w-]*\)/);
  });

  it('a folded callout is a button with aria-expanded, and its body is hidden', () => {
    const html = render('> [!note]- Folded\n> Hidden body');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
    expect(html).toMatch(/class="vault-callout-body" hidden=""/);
    const open = render('> [!note]+ Open\n> Shown body');
    expect(open).toMatch(/aria-expanded="true"/);
    expect(open).not.toMatch(/vault-callout-body" hidden/);
  });
});

describe('highlights, comments and block anchors (X12)', () => {
  it('==highlight== is a mark; inside code it stays as written', () => {
    const html = render('Some ==bright words== here, and `==code==`.');
    expect(html).toContain('<mark class="vault-mark">bright words</mark>');
    expect(html).toContain('<code>==code==</code>');
  });

  it('%%comments%% are absent from the page and the accessibility tree', () => {
    const html = render('Visible %%secret one%% text.\n\n%%\nsecret two\n%%\n\nAfter.');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('%%');
    expect(html).toContain('Visible');
    expect(html).toContain('After.');
  });

  it('^block ids leave the text and stay as data-block; no id is built from note text', () => {
    const html = render('# Goals ^top\n\nA paragraph ^para-1\n\n- item one ^li\n- item two');
    expect(html).not.toMatch(/\^(?:top|para-1|li)/);
    expect(html).toContain('data-block="para-1"');
    expect(html).toMatch(/<li data-block="li">/);
    expect(html).toMatch(/<h1 data-block="top" data-heading-index="0">Goals<\/h1>/);
    expect(html).not.toMatch(/\sid="/);
    // An id inside code is not an anchor.
    expect(render('```\ncode ^nope\n```')).toContain('code ^nope');
  });
});

describe('links to a heading or a block (X12)', () => {
  it('carries the subpath and hands it to the open', async () => {
    const html = render('[[Plan#Goals]] and [[Plan#^b1|see]]', ['Plan.md']);
    expect(html).toContain('href="vault:Plan.md#Goals"');
    expect(html).toContain('href="vault:Plan.md#%5Eb1"');
    const dom = await mountDom();
    const opened: unknown[] = [];
    await dom.render(
      <VaultMarkdown
        text="Go to [[Plan#Goals]]."
        paths={['Plan.md']}
        onOpenNote={(...a) => opened.push(a)}
      />,
    );
    const { act } = await import('react');
    await act(async () => {
      dom.container.querySelector('a')!.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    expect(opened).toEqual([['Plan.md', false, 'Goals']]);
    await dom.unmount();
  });

  it('scrolls to the heading, focuses it, lands a one-shot highlight; a missing one says so', async () => {
    const dom = await mountDom();
    const scrolled: unknown[] = [];
    const proto = (window as unknown as { HTMLElement: { prototype: object } }).HTMLElement
      .prototype as { scrollIntoView?: (o: unknown) => void };
    proto.scrollIntoView = function (this: HTMLElement, o: unknown) {
      scrolled.push([this.textContent, o]);
    };
    const notices: string[] = [];
    const text = '# Intro\n\nText\n\n## Goals\n\nMore\n\nA block ^b1';
    const view = (anchor: { subpath: string; key: number }) => (
      <VaultMarkdown
        text={text}
        paths={[]}
        sourcePath="Plan.md"
        anchor={anchor}
        onOpenNote={() => {}}
        onNotice={(m) => notices.push(m)}
      />
    );
    await dom.render(view({ subpath: 'goals', key: 1 }));
    const h = dom.container.querySelector('[data-heading-index="1"]') as HTMLElement;
    expect(scrolled).toEqual([['Goals', { behavior: 'smooth', block: 'start' }]]);
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(h.classList.contains('vault-landed')).toBe(true);
    await dom.render(view({ subpath: '^b1', key: 2 }));
    expect(scrolled).toHaveLength(2);
    await dom.render(view({ subpath: 'Nowhere', key: 3 }));
    expect(notices).toEqual([vaultReaderCopy.anchorMissing('Nowhere', 'Plan')]);
    expect(notices[0]).toBe('No heading "Nowhere" in "Plan", so it opened at the top.');
    // The same key never fires twice.
    await dom.render(view({ subpath: 'Nowhere', key: 3 }));
    expect(notices).toHaveLength(1);
    delete proto.scrollIntoView;
    await dom.unmount();
  });
});

describe('task checkboxes (X13)', () => {
  const note = '---\na: 1\n---\n- [ ] one\n- [x] two\n- [-] custom';

  it('renders a whole-line target per task, done muted, a custom status as text', () => {
    const html = render(note);
    expect(html.match(/<label class="vault-task/g)).toHaveLength(2);
    expect(html).toContain('vault-task--done');
    expect(html).not.toContain('<del');
    expect(html).toContain('[-] custom');
    // No toggle handler: the boxes show but do not tick.
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });

  it('a tick flips at once, reports its line in the whole note, and reverts on a refusal', async () => {
    const dom = await mountDom();
    const calls: Array<[number, boolean]> = [];
    let answer: boolean | undefined = undefined;
    await dom.render(
      <VaultMarkdown
        text={note}
        paths={[]}
        onOpenNote={() => {}}
        onToggleTask={(line, checked) => {
          calls.push([line, checked]);
          return Promise.resolve(answer);
        }}
      />,
    );
    const boxes = () =>
      [...dom.container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    const { act } = await import('react');
    const tick = (box: HTMLInputElement) =>
      act(async () => {
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'checked')?.set;
        if (set) set.call(box, !box.checked);
        else box.checked = !box.checked;
        box.dispatchEvent(new window.Event('click', { bubbles: true }));
      });
    expect(boxes().map((b) => b.checked)).toEqual([false, true]);
    await tick(boxes()[0]!);
    // Line 3 of the whole note: the frontmatter's three lines come first,
    // the same basis as the core's listTasks, which the store matches on.
    expect(calls).toEqual([[3, true]]);
    expect(listTasks(note).map((t) => t.line)).toEqual([3, 4, 5]);
    expect(boxes()[0]!.checked).toBe(true);
    // Refused: the box shows the file's truth again.
    answer = false;
    await tick(boxes()[1]!);
    expect(calls[1]).toEqual([4, false]);
    await dom.settle();
    expect(boxes()[1]!.checked).toBe(true);
    await dom.unmount();
  });

  it('read-only boxes are aria-disabled and never call back', async () => {
    const dom = await mountDom();
    const calls: unknown[] = [];
    await dom.render(
      <VaultMarkdown
        text="- [ ] one"
        paths={[]}
        onOpenNote={() => {}}
        tasksReadOnly
        onToggleTask={(...a) => {
          calls.push(a);
        }}
      />,
    );
    const box = dom.container.querySelector('input') as HTMLInputElement;
    expect(box.getAttribute('aria-disabled')).toBe('true');
    const { act } = await import('react');
    await act(async () => {
      box.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    expect(calls).toEqual([]);
    await dom.unmount();
  });
});

describe('code blocks (X12)', () => {
  it("use the chat's CodeBlock with Copy, and never Run", () => {
    const html = render('```bash\nrm -rf build\n```');
    expect(html).toContain('class="md-code"');
    expect(html).toContain('>Copy</button>');
    expect(html).not.toContain('>Run</button>');
  });
});

describe('note embeds (X14)', () => {
  const bodies: Record<string, string> = {
    'Plan.md':
      '---\ntitle: x\n---\n# Plan\n\nThe plan. ![[Deep]]\n\n## Goals\n\nShip.\n\n## Later\n\nWait.',
    'Deep.md': 'Too deep to show.',
  };
  const readEmbed = async (path: string) => bodies[path];
  const paths = ['Plan.md', 'Deep.md'];

  it('renders a card one level deep; a second level is a link chip; a missing note says so', async () => {
    const dom = await mountDom();
    const opened: unknown[] = [];
    await dom.render(
      <VaultMarkdown
        text={'Intro ![[Plan]] outro\n\n![[Nope]]'}
        paths={paths}
        readEmbed={readEmbed}
        onOpenNote={(...a) => opened.push(a)}
      />,
    );
    await dom.settle();
    const card = dom.container.querySelector('section.vault-embed')!;
    expect(card.parentElement?.tagName).not.toBe('P');
    expect(card.textContent).toContain('From "Plan"');
    expect(card.textContent).toContain('The plan.');
    expect(card.textContent).not.toContain('title: x');
    expect(card.textContent).toContain(vaultReaderCopy.embedNested('Deep'));
    expect(card.textContent).not.toContain('Too deep to show.');
    expect(dom.text()).toContain('No note named "Nope" yet.');
    expect(dom.text()).toContain('Intro');
    expect(dom.text()).toContain('outro');
    await dom.click('From "Plan"');
    expect(opened).toEqual([['Plan.md', false, undefined]]);
    await dom.unmount();
  });

  it('a heading embed shows only that section', async () => {
    const dom = await mountDom();
    await dom.render(
      <VaultMarkdown
        text="![[Plan#Goals]]"
        paths={paths}
        readEmbed={readEmbed}
        onOpenNote={() => {}}
      />,
    );
    await dom.settle();
    expect(dom.text()).toContain('Ship.');
    expect(dom.text()).not.toContain('Wait.');
    expect(dom.text()).not.toContain('The plan.');
    await dom.unmount();
  });

  it('caps note embeds at ten per note; the rest are chips', () => {
    const text = Array.from({ length: 12 }, () => '![[Plan]]').join('\n\n');
    const html = render(text, paths);
    // No reader for bodies here, so every card is a chip too; with one, ten
    // cards and two chips.
    expect(html.match(/is embedded here/g)).toHaveLength(12);
  });
});

describe('images and PDFs (X14, K11)', () => {
  it('loads an image from a registry blob URL, sized by |300, alt from the name', async () => {
    const dom = await mountDom();
    const { media, reads, made } = fakeMedia();
    await dom.render(
      <VaultMarkdown
        text={'![[cat.png|300]]\n\n![A cat](art/cat.png)'}
        paths={[]}
        media={media}
        onOpenNote={() => {}}
      />,
    );
    await dom.settle();
    const imgs = [...dom.container.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['blob:test/1', 'blob:test/1']);
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['cat', 'A cat']);
    // One read and one URL for both: the registry shares the key.
    expect(reads).toEqual(['art/cat.png']);
    expect(made).toEqual(['blob:test/1']);
    const frame = dom.container.querySelector('.vault-image-frame') as HTMLElement;
    expect(frame.getAttribute('style')).toMatch(/max-width:\s*300px/);
    await dom.unmount();
  });

  it('shows a 4:3 skeleton until the bytes arrive', () => {
    const { media } = fakeMedia();
    // With no media source (Project Memory), an image is a chip that says so.
    expect(render('![[cat.png]]')).toContain(vaultReaderCopy.otherFile);
    const loading = renderToStaticMarkup(
      <VaultMarkdown text="![[cat.png]]" paths={[]} media={media} onOpenNote={() => {}} />,
    );
    expect(loading).toContain('vault-image-skeleton');
    expect(loading).toContain('Loading cat.png');
    expect(loading).not.toContain('<img');
  });

  it('never loads a src the note names: data:, blob:, remote and raw HTML images', async () => {
    const dom = await mountDom();
    const { media, reads } = fakeMedia();
    await dom.render(
      <VaultMarkdown
        text={
          '![x](data:image/png;base64,AAAA)\n\n![y](blob:https://evil/1)\n\n![Tracker](https://evil.example/p.png)\n\n<img src="https://evil.example/q.png">'
        }
        paths={[]}
        media={media}
        onOpenNote={() => {}}
      />,
    );
    await dom.settle();
    expect(dom.container.querySelectorAll('img')).toHaveLength(0);
    expect(reads).toEqual([]);
    const link = dom.container.querySelector('a.vault-chip--link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://evil.example/p.png');
    expect(link.textContent).toBe('Tracker');
    await dom.unmount();
  });

  it('says why an image cannot show: missing, downloading, away, too large, not an image', async () => {
    const dom = await mountDom();
    const { media } = fakeMedia({
      files: {
        'dl.png': { ok: false, reason: 'downloading' },
        'fake.png': {
          ok: true,
          bytes: new Uint8Array([1, 2, 3]),
          mime: 'image/png',
          version: 'v1',
        },
      },
    });
    await dom.render(
      <VaultMarkdown
        text={'![[nope.png]]\n\n![[dl.png]]\n\n![[fake.png]]'}
        paths={[]}
        media={media}
        onOpenNote={() => {}}
      />,
    );
    await dom.settle();
    expect(dom.text()).toContain('Image not found: nope.png');
    expect(dom.text()).toContain('Downloading dl.png');
    expect(dom.text()).toContain('fake.png could not be opened here.');
    const away = fakeMedia({ away: true });
    await dom.render(
      <VaultMarkdown text="![[cat.png]]" paths={[]} media={away.media} onOpenNote={() => {}} />,
    );
    expect(dom.text()).toContain('Your computer is off, so this image cannot load.');
    expect(away.reads).toEqual([]);
    const big = fakeMedia();
    const huge = {
      ...big.media,
      attachments: [{ ...big.media.attachments[0]!, size: 21 * 1024 * 1024 }],
    };
    await dom.render(
      <VaultMarkdown text="![[cat.png]]" paths={[]} media={huge} onOpenNote={() => {}} />,
    );
    expect(dom.text()).toContain('cat.png is too large to show here.');
    expect(big.reads).toEqual([]);
    await dom.unmount();
  });

  it('a tap opens the image full screen in a Sheet', async () => {
    const dom = await mountDom();
    const { media } = fakeMedia();
    await dom.render(
      <VaultMarkdown text="![[cat.png]]" paths={[]} media={media} onOpenNote={() => {}} />,
    );
    await dom.settle();
    await dom.click('');
    const sheet = dom.container.querySelector('.vault-image-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet!.querySelector('img')?.getAttribute('src')).toBe('blob:test/1');
    expect(sheet!.textContent).toContain('cat.png');
    await dom.unmount();
  });

  it('a PDF is a chip that opens in the system viewer, and says so only when it fails', async () => {
    const dom = await mountDom();
    const opened: string[] = [];
    const notices: string[] = [];
    let ok = true;
    const { media } = fakeMedia({
      files: { 'docs/spec.pdf': { ok: false, reason: 'refused' } },
      openAttachment: async (path) => {
        opened.push(path);
        return { ok };
      },
    });
    await dom.render(
      <VaultMarkdown
        text="![[spec.pdf]]"
        paths={[]}
        media={media}
        onOpenNote={() => {}}
        onNotice={(m) => notices.push(m)}
      />,
    );
    expect(dom.text()).toContain('spec.pdf');
    expect(dom.text()).toContain('PDF');
    await dom.click('spec.pdfPDF');
    await dom.settle();
    expect(opened).toEqual(['docs/spec.pdf']);
    expect(notices).toEqual([]);
    ok = false;
    await dom.click('spec.pdfPDF');
    await dom.settle();
    expect(notices).toEqual(['spec.pdf could not be opened here.']);
    // A phone, until a native preview lands: the name, and where to open it.
    const phone = fakeMedia({ files: { 'docs/spec.pdf': { ok: false, reason: 'refused' } } });
    const html = renderToStaticMarkup(
      <VaultMarkdown text="![[spec.pdf]]" paths={[]} media={phone.media} onOpenNote={() => {}} />,
    );
    expect(html).toContain('PDF. Open it on your computer.');
    expect(html).not.toContain('<button');
    await dom.unmount();
  });

  it('retires the M3 embed placeholder', () => {
    expect(render('![[Plan]] ![[cat.png]]', ['Plan.md'])).not.toContain('embed not supported yet');
  });
});

describe('blob URL lifetime (K11)', () => {
  const ok = (bytes = PNG): BytesRead => ({ ok: true, bytes, mime: 'image/png', version: 'v1' });

  function registry(cap?: number) {
    const made: string[] = [];
    const revoked: string[] = [];
    const timers: Array<{ fn: () => void; ms: number; on: boolean }> = [];
    const reg = createVaultBlobs({
      createUrl: () => {
        const url = `blob:${made.length + 1}`;
        made.push(url);
        return url;
      },
      revokeUrl: (u) => revoked.push(u),
      setTimer: (fn, ms) => {
        const t = { fn, ms, on: true };
        timers.push(t);
        return t;
      },
      clearTimer: (t) => {
        (t as { on: boolean }).on = false;
      },
      capBytes: cap,
    });
    const fire = () => {
      for (const t of timers.splice(0)) if (t.on) t.fn();
    };
    return { reg, made, revoked, timers, fire };
  }

  it('is keyed by provider, resource, path and version', () => {
    expect(vaultBlobKey('local:v', 'a.png', '1')).not.toBe(vaultBlobKey('local:v', 'a.png', '2'));
    expect(vaultBlobKey('local:v', 'a.png', '1')).not.toBe(vaultBlobKey('hub:v', 'a.png', '1'));
  });

  it('shares one read per key, and revokes 30 s after the last release', async () => {
    const { reg, made, revoked, timers, fire } = registry();
    let loads = 0;
    const load = async () => {
      loads++;
      return ok();
    };
    const [a, b] = await Promise.all([reg.acquire('k', load), reg.acquire('k', load)]);
    expect(a).toEqual({ ok: true, url: 'blob:1' });
    expect(b).toEqual(a);
    expect(loads).toBe(1);
    reg.release('k');
    expect(timers).toHaveLength(0);
    reg.release('k');
    expect(timers.map((t) => t.ms)).toEqual([30_000]);
    expect(revoked).toEqual([]);
    // Back within the grace: the same URL, no new read, the clock stopped.
    expect(await reg.acquire('k', load)).toEqual({ ok: true, url: 'blob:1' });
    expect(loads).toBe(1);
    fire();
    expect(revoked).toEqual([]);
    reg.release('k');
    fire();
    expect(revoked).toEqual(['blob:1']);
    expect(reg.stats()).toEqual({ bytes: 0, entries: 0 });
    // Gone: the next acquire reads again.
    await reg.acquire('k', load);
    expect(loads).toBe(2);
    expect(made).toEqual(['blob:1', 'blob:2']);
  });

  it('holds 64 MB by evicting the least recently used unmounted entries, never a mounted one', async () => {
    const { reg, revoked } = registry(20);
    const ten = () => ok(new Uint8Array(10));
    await reg.acquire('a', async () => ten());
    await reg.acquire('b', async () => ten());
    reg.release('a');
    reg.release('b');
    await reg.acquire('c', async () => ten());
    // a is oldest and idle, so it goes; c is mounted and stays.
    expect(revoked).toEqual(['blob:1']);
    await reg.acquire('d', async () => ten());
    expect(revoked).toEqual(['blob:1', 'blob:2']);
    expect(reg.stats().entries).toBe(2);
  });

  it('revokeAll drops everything, and a read in flight makes no URL', async () => {
    const { reg, made, revoked } = registry();
    await reg.acquire('a', async () => ok());
    let finish!: (r: BytesRead) => void;
    const pending = reg.acquire('b', () => new Promise<BytesRead>((r) => (finish = r)));
    reg.revokeAll();
    expect(revoked).toEqual(['blob:1']);
    finish(ok());
    expect(await pending).toEqual({ ok: false, reason: 'gone' });
    expect(made).toEqual(['blob:1']);
    expect(reg.stats()).toEqual({ bytes: 0, entries: 0 });
  });

  it('an image holds its URL while mounted and releases it when it unmounts', async () => {
    const dom = await mountDom();
    const { media, registry: reg, revoked } = fakeMedia();
    const released: string[] = [];
    const watched: VaultMedia = {
      ...media,
      registry: {
        ...reg,
        release: (key) => {
          released.push(key);
          reg.release(key);
        },
      },
    };
    await dom.render(
      <VaultMarkdown text="![[cat.png]]" paths={[]} media={watched} onOpenNote={() => {}} />,
    );
    await dom.settle();
    expect(released).toEqual([]);
    await dom.unmount();
    expect(released).toEqual([vaultBlobKey('local:vault', 'art/cat.png', 'v1')]);
    // Idle now, inside its grace; leaving the room drops it at once.
    expect(revoked).toEqual([]);
    reg.revokeAll();
    expect(revoked).toEqual(['blob:test/1']);
  });
});

// Vault M6 wave 2: a #tag is a tap that searches tag:x (CX X2), and headings
// carry the index the outline scrolls by (K10).
describe('tags and heading indexes in reading view', () => {
  let dom: TestDom;
  beforeEach(async () => {
    dom = await mountDom();
  });
  afterEach(async () => {
    await dom.unmount();
  });

  it('a #tag is a button that hands its tag up; a link, code and #1 are not tags', async () => {
    const tapped: string[] = [];
    await dom.render(
      <VaultMarkdown
        text={'Filed under #work/q4 and (#idea).\n\n[see #notatag](https://example.com) `#code` #1'}
        paths={[]}
        onOpenNote={() => {}}
        onTag={(t) => tapped.push(t)}
      />,
    );
    expect(dom.buttons()).toEqual(expect.arrayContaining(['#work/q4', '#idea']));
    expect(dom.buttons()).not.toContain('#notatag');
    expect(dom.buttons()).not.toContain('#code');
    expect(dom.buttons()).not.toContain('#1');
    await dom.click('#work/q4');
    expect(tapped).toEqual(['work/q4']);
  });

  it('without onTag a tag is styled text, and headings carry data-heading-index in order', () => {
    const html = render('# One\n\n#plain\n\n```\n# not a heading\n```\n\n## Two\n');
    expect(html).toContain('<span class="vault-tag">#plain</span>');
    expect([...html.matchAll(/data-heading-index="(\d+)"/g)].map((m) => m[1])).toEqual(['0', '1']);
  });
});
