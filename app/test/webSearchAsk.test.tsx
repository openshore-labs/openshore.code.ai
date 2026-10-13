// The web search sheet after a private read (UX and copy review, 2026-10-08, H).
// Once a chat on a model that stays on this network holds a private note's
// text, every search that model writes asks here, every time, whatever the
// person allowed before: the card shows the exact words and why, offers
// Approve once and No, skip it, carries no Settings hint, and its answer is
// never remembered (no standing allow, and a no keeps web search as it was).
// A clean search keeps asking once. Mounted in a real DOM
// (test/support/dom.ts) so the taps are the ones a person makes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  isDesktop: () => false,
  isPhone: () => true,
  dataUnlockState: async () => 'ok',
  openExternal: () => {},
  openInAppBrowser: () => {},
  storeGetJson: async () => undefined,
  storeSetJson: async () => {},
  storeGet: async () => null,
  storeSet: async () => {},
  storeDelete: async () => {},
  sealExistingKeys: async () => {},
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

// The DOM comes first: React DOM decides whether it has one when it loads.
const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { WebSearchAsk } = await import('../src/components/WebSearchAsk.js');
const { WebSearchSheets, answersSheet, remembersAnswer, searchAskShortcut } =
  await import('../src/state/webSearchAskOps.js');
const { privateSearchCard } = await import('os-code/protocol');

const card = privateSearchCard('DuckDuckGo', 'tide times', 'read');

afterEach(async () => {
  await dom.render(null);
  useApp.setState({ webSearchAsk: undefined });
});

describe('the rules', () => {
  it('a search after a private read always asks, whatever was allowed', () => {
    expect(searchAskShortcut('allowed', false, true)).toBeUndefined();
    expect(searchAskShortcut(undefined, false, true)).toBeUndefined();
    // A clean search keeps asking once.
    expect(searchAskShortcut('allowed', false, false)).toBe(true);
    expect(searchAskShortcut('declined', false, false)).toBe(false);
    expect(searchAskShortcut(undefined, true, false)).toBe(false);
    expect(searchAskShortcut(undefined, false, false)).toBeUndefined();
  });

  it('remembers only a clean answer', () => {
    expect(remembersAnswer({ query: 'q' })).toBe(true);
    expect(remembersAnswer({ query: 'q', private: card })).toBe(false);
  });

  it('shows one sheet at a time, in order', async () => {
    const shown: string[] = [];
    const sheets = new WebSearchSheets((s) => shown.push(s.query));
    const first = sheets.open({ query: 'one', private: card });
    const second = sheets.open({ query: 'two' });
    await Promise.resolve();
    await Promise.resolve();
    expect(shown).toEqual(['one']);
    sheets.answer(true);
    expect(await first).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(shown).toEqual(['one', 'two']);
    sheets.answer(false);
    expect(await second).toBe(false);
  });
});

describe('the sheet after a private read', () => {
  beforeEach(() => {
    useApp.setState({
      settings: { ...useApp.getState().settings, webSearchConsent: 'allowed' },
    });
  });

  it('shows the exact words and why, with the always-ask buttons and no Settings hint', async () => {
    useApp.setState({ webSearchAsk: { query: 'tide times', private: card } });
    await dom.render(<WebSearchAsk />);
    expect(dom.container.querySelector('.sheet h2, .sheet-head h2')?.textContent).toBe(
      'Search DuckDuckGo for "tide times"',
    );
    expect(dom.container.querySelector('.sheet-sub')?.textContent).toBe(
      'This chat has read a private note. These words go to DuckDuckGo as written, so check that they carry nothing from it. Nothing is sent without this approval.',
    );
    expect(dom.buttons()).toEqual(expect.arrayContaining(['Approve once', 'No, skip it']));
    expect(dom.buttons()).not.toContain('Allow web search');
    expect(dom.container.querySelector('.hint')).toBeNull();
  });

  it('remembers nothing on a yes or a no', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, webSearchConsent: undefined },
      webSearchAsk: { query: 'tide times', private: card },
    });
    useApp.getState().answerWebSearch(true);
    expect(useApp.getState().webSearchAsk).toBeUndefined();
    expect(useApp.getState().settings.webSearchConsent).toBeUndefined();
    useApp.setState({ webSearchAsk: { query: 'tide times', private: card } });
    useApp.getState().answerWebSearch(false);
    expect(useApp.getState().settings.webSearchConsent).toBeUndefined();
  });

  it('a second tap, or the scrim, as the private card slides away answers nothing', async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, webSearchConsent: undefined },
      webSearchAsk: { query: 'tide times', private: card },
    });
    await dom.render(<WebSearchAsk />);
    await dom.click('Approve once');
    expect(useApp.getState().webSearchAsk).toBeUndefined();
    // The sheet still draws the card it is sliding away with.
    expect(dom.buttons()).toContain('Approve once');
    await dom.click('Approve once');
    const scrim = dom.container.querySelector('.sheet-scrim');
    expect(scrim).not.toBeNull();
    scrim!.dispatchEvent(new window.Event('click', { bubbles: true }));
    await dom.settle();
    // Neither a standing allow nor a standing no came of it.
    expect(useApp.getState().settings.webSearchConsent).toBeUndefined();
    // A clean card shown next still asks, and a no on it is still its own.
    useApp.setState({ webSearchAsk: { query: 'moon phase' } });
    expect(answersSheet(useApp.getState().webSearchAsk, { query: 'moon phase' })).toBe(false);
    expect(answersSheet(useApp.getState().webSearchAsk, undefined)).toBe(true);
    expect(answersSheet(undefined, undefined)).toBe(false);
  });

  it('keeps the clean sheet as it was', async () => {
    useApp.setState({ webSearchAsk: { query: 'tide times' } });
    await dom.render(<WebSearchAsk />);
    expect(dom.buttons()).toEqual(expect.arrayContaining(['Allow web search', 'Not now']));
    expect(dom.container.querySelector('.hint')?.textContent).toBe(
      'You can change this any time in Settings, Web search.',
    );
  });

  it('is wired in the store: the rules decide, and a private answer is not saved', () => {
    const store = readFileSync(join(process.cwd(), 'src', 'state', 'store.ts'), 'utf8');
    expect(store).toMatch(/searchAskShortcut\(\s*get\(\)\.settings\.webSearchConsent,/);
    expect(store).toMatch(/webSearchSheets\.open\(\{ query, private: ask\.card \}\)/);
    expect(store).toMatch(/if \(!answersSheet\(current, sheet\)\) return;/);
    expect(store).toMatch(/const remembered = remembersAnswer\(current\)/);
  });
});
