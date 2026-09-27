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
import { readFrontmatter } from 'os-code/protocol';
import { restoreEol } from '../src/lib/vault.js';
import { vaultAutosave } from '../src/lib/vaultAutosave.js';

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
        expect(html).toContain('<h1>Goals</h1>');
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
    expect(html).toContain('href="vault:b%2FIndex.md"');
  });
});
