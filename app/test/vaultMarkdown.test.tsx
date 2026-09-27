// A bad link cannot blank the app (0.10, ui-9). A hand-written or pasted
// vault: link with a broken percent-escape threw URIError from
// decodeURIComponent during render, and with no error boundary React took the
// whole app down with it. The decode is now wrapped, and a boundary sits
// around the note and around the Vault room for anything else.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VaultMarkdown, vaultHrefPath } from '../src/components/VaultMarkdown.js';
import { ErrorBoundary } from '../src/components/ErrorBoundary.js';

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

  it('turns a render fault into the fallback, not a blank app', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const b = new ErrorBoundary({ fallback, resetKey: 'a', children: <p>note</p> });
    expect(renderToStaticMarkup(<>{b.render()}</>)).toBe('<p>note</p>');
    b.state = { failed: true, key: 'a' };
    expect(renderToStaticMarkup(<>{b.render()}</>)).toBe('<p>fell back</p>');
  });

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
