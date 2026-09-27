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

// One body that trips the renderer, the way a malformed note could: the
// wikilink pass throws for it, and only for it.
vi.mock('../src/lib/vault.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/vault.js')>();
  return {
    ...actual,
    wikilinksToMarkdown: (text: string, paths: string[]) => {
      if (text.includes('TRIPS THE RENDERER')) throw new Error('render fault');
      return actual.wikilinksToMarkdown(text, paths);
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
