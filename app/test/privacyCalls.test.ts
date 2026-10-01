// The v1 review's four privacy calls (founder, 2026-09-27, DECISIONS), each
// held by a test so none of them drifts back:
//   1. Web search goes through one gate: it asked once, and since 2026-10-01
//      (founder) it is on by default; off in Settings, nothing reaches a
//      search service and the model is told plainly it did not search.
//   2. Desktop updates ask before downloading on every platform: the check
//      stays (it is listed), the download waits for the Update click.
//   3. The guardrail record never uploads the name of a person a request was
//      about; that stays in the device's copy.
//   4. The repository sign-in exchange passes the token through once and keeps
//      nothing: no database, no storage, no token in a log line.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_UPDATER, stepUpdater, type UpdaterEvent } from '../electron/updateState.js';

const h = vi.hoisted(() => ({
  searchMock: vi.fn(async () => [{ title: 'T', url: 'https://example.com', snippet: 's' }]),
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('../src/lib/webSearch.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/webSearch.js')>()),
  resolveSearchKey: async () => undefined,
  webSearch: h.searchMock,
  formatSearchResults: (query: string, results: unknown[]) =>
    `RESULTS for ${query}: ${results.length}`,
}));

vi.mock('../src/lib/supabase.js', () => ({
  isConfigured: () => true,
  insert: async (table: string, _token: string, row: Record<string, unknown>) => {
    h.inserts.push({ table, row });
  },
  rpc: async () => undefined,
}));

vi.mock('../src/lib/platform.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/platform.js')>()),
  storeGetJson: async () => null,
  storeSetJson: async () => undefined,
}));

const { searchForModel, setSearchConsent, SEARCH_NOT_ALLOWED } =
  await import('../src/lib/localSearch.js');
const { recordEthicsEvent, setEthicsAuth } = await import('../src/lib/ethics.js');
const { webSearchOn } = await import('../src/lib/webSearch.js');
// Signed in: the store hands its session in; here, a stand-in for it.
setEthicsAuth(async () => ({ accessToken: 't' }));

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('1. web search goes through one gate (on by default since 2026-10-01)', () => {
  beforeEach(() => {
    h.searchMock.mockClear();
  });

  it('sends nothing to a search service until the person allows it', async () => {
    setSearchConsent(async () => false);
    const emitted: unknown[] = [];
    const text = await searchForModel('weather tomorrow', false, (e) => emitted.push(e));
    expect(text).toBe(SEARCH_NOT_ALLOWED);
    expect(h.searchMock).not.toHaveBeenCalled();
    // No "Searching the web" status either: nothing happened.
    expect(emitted).toEqual([]);
  });

  it('searches once allowed, and hands the gate the words it would send', async () => {
    const asked: string[] = [];
    setSearchConsent(async (q) => {
      asked.push(q);
      return true;
    });
    const text = await searchForModel('weather tomorrow', false, () => {});
    expect(asked).toEqual(['weather tomorrow']);
    expect(h.searchMock).toHaveBeenCalledTimes(1);
    expect(text).toMatch(/RESULTS for weather tomorrow/);
  });

  it('tells the model plainly that it did not search, so it cannot pretend', () => {
    expect(SEARCH_NOT_ALLOWED).toMatch(/did not search the web/);
  });

  // Founder, 2026-10-01: web search is on by default, so a curated model
  // answers with current facts out of the box. The gate stays the one seam,
  // and turning it off in Settings still sends nothing.
  it('is on by default, off only when turned off in Settings, with no ask sheet', () => {
    expect(webSearchOn(undefined)).toBe(true);
    expect(webSearchOn('allowed')).toBe(true);
    expect(webSearchOn('declined')).toBe(false);
    const store = read('src', 'state', 'store.ts');
    // The launch wires the gate into the search seam, with the readers a
    // driver checks before it offers the model a search (A4).
    expect(store).toMatch(/setSearchConsent\(webSearchGate, \{\s*allowed: webSearchAllowedNow,/);
    expect(store).toMatch(
      /webSearchOn\(get\(\)\.settings\.webSearchConsent\) \? 'allowed' : 'declined'/,
    );
    // Off in Settings, the desktop engine gets no webSearch tool.
    expect(store).toMatch(
      /webSearchOn\(settings\.webSearchConsent\) \? \{\} : \{ webSearch: false \}/,
    );
    expect(store).not.toMatch(/webSearchAsk|answerWebSearch/);
    expect(existsSync(join(process.cwd(), 'src', 'components', 'WebSearchAsk.tsx'))).toBe(false);
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    expect(settings).toMatch(/Let models search the web/);
    expect(settings).toMatch(/checked=\{webSearchOn\(settings\.webSearchConsent\)\}/);
  });

  it('carries the answer to the engine through the bridge and the daemon', () => {
    expect(read('electron', 'main.ts')).toMatch(/webSearch: optBool\(o\.webSearch, 'webSearch'\)/);
    expect(read('electron', 'engineHost.ts')).toMatch(/opts\.webSearch === false/);
    expect(read('src', 'drivers', 'remoteDriver.ts')).toMatch(/opts\.webSearch === false/);
    expect(read('..', 'os-code', 'src', 'daemon', 'serve.ts')).toMatch(/body\.webSearch === false/);
  });
});

describe('2. desktop updates ask before downloading', () => {
  const main = read('electron', 'main.ts');

  it('never downloads on its own, on any platform', () => {
    expect(main).toMatch(/autoUpdater\.autoDownload = false;/);
    expect(main).not.toMatch(/autoUpdater\.autoDownload = true/);
  });

  it('downloads only after the person clicks Update', () => {
    // The one downloadUpdate() call runs the updater state machine's
    // 'download' effect (electron/updateState.ts), and the install handler
    // feeds the machine the person's click.
    const calls = [...main.matchAll(/\.downloadUpdate\(\)/g)].map((m) => m.index!);
    expect(calls).toHaveLength(1);
    expect(main.slice(Math.max(0, calls[0]! - 200), calls[0]!)).toMatch(
      /step\.effect === 'download'/,
    );
    const install = main.indexOf("guarded('osc:installUpdate'");
    expect(install).toBeGreaterThan(-1);
    expect(main.slice(install, install + 400)).toMatch(/applyUpdate\(\{ type: 'click' \}\)/);
  });

  it('the state machine asks for a download only once the person has clicked', () => {
    // Every event electron-updater can send, in any order, without a click.
    const events: UpdaterEvent[] = [
      { type: 'available', version: '2.0.0' },
      { type: 'progress', percent: 10 },
      { type: 'not-available' },
      { type: 'available', version: '2.0.1' },
      { type: 'check-done', found: true },
      { type: 'error', detail: 'x' },
      { type: 'check-failed', detail: 'y' },
      { type: 'available', version: '2.0.2' },
      { type: 'downloaded', version: '2.0.2' },
    ];
    let state = IDLE_UPDATER;
    for (const event of events) {
      const step = stepUpdater(state, event);
      expect(step.effect, event.type).not.toBe('download');
      state = step.state;
    }
    const offered = stepUpdater(IDLE_UPDATER, { type: 'available', version: '2.0.0' }).state;
    expect(stepUpdater(offered, { type: 'click' }).effect).toBe('download');
  });
});

describe('3. the guardrail record keeps the named person on this device', () => {
  it('uploads the record with no subject, and keeps it in the device copy', async () => {
    h.inserts.length = 0;
    await recordEthicsEvent({
      category: 'likeness',
      tier: 2,
      timestamp: '2026-09-27T12:00:00.000Z',
      requestHash: 'a'.repeat(64),
      modelPath: 'local',
      action: 'blocked',
      side: 'input',
      signals: ['named-person'],
      subject: 'Jordan Example',
    } as never);
    const row = h.inserts.find((i) => i.table === 'guardrail_events')?.row;
    expect(row).toBeDefined();
    expect(row!.subject).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/Jordan/i);
    const { knownRecords } = await import('../src/lib/ethics.js');
    expect(knownRecords().at(-1)?.subject).toBe('Jordan Example');
  });
});

describe('4. the repository sign-in exchange keeps nothing', () => {
  const fn = read('..', 'supabase', 'functions', 'repo-oauth', 'index.ts');

  it('has no database, no key-value store, and no file write', () => {
    expect(fn).not.toMatch(/createClient|\.from\(|\.insert\(|\.upsert\(|Deno\.openKv/);
    expect(fn).not.toMatch(/Deno\.writeTextFile|Deno\.writeFile|localStorage/);
  });

  it('never writes a code or a token into a log line', () => {
    const logs = [...fn.matchAll(/console\.(log|info|warn|error|debug)\(([\s\S]*?)\);/g)].map(
      (m) => m[2]!,
    );
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toMatch(
        /access_token|refresh_token|accessToken|refreshToken|tokens|payload|code_verifier|codeVerifier|form\b/,
      );
    }
  });

  it('hands the tokens straight back to the app that asked', () => {
    expect(fn).toMatch(/return json\(tokens, 200, req\)/);
  });
});
