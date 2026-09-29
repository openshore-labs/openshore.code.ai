// The v1 review's four privacy calls (founder, 2026-09-27, DECISIONS), each
// held by a test so none of them drifts back:
//   1. Web search asks once: nothing reaches a search service until the person
//      allows it, and a "Not now" is answered honestly to the model.
//   2. Desktop updates ask before downloading on every platform: the check
//      stays (it is listed), the download waits for the Update click.
//   3. The guardrail record never uploads the name of a person a request was
//      about; that stays in the device's copy.
//   4. The repository sign-in exchange passes the token through once and keeps
//      nothing: no database, no storage, no token in a log line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  searchMock: vi.fn(async () => [{ title: 'T', url: 'https://example.com', snippet: 's' }]),
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('../src/lib/webSearch.js', () => ({
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
// Signed in: the store hands its session in; here, a stand-in for it.
setEthicsAuth(async () => ({ accessToken: 't' }));

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('1. web search asks once', () => {
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

  it('is asked in one sheet, remembered once allowed, and switchable in Settings', () => {
    const store = read('src', 'state', 'store.ts');
    // The launch wires the real question into the search seam.
    expect(store).toMatch(/setSearchConsent\(askWebSearch\)/);
    // Allowed is saved; a decline holds for this run only, so it asks again
    // next launch rather than never.
    expect(store).toMatch(/webSearchConsent: 'allowed'/);
    expect(store).toMatch(/webSearchDeclinedThisRun = true/);
    // The desktop engine gets no webSearch tool until the person allows it.
    expect(store).toMatch(/webSearchConsent === 'allowed' \? \{\} : \{ webSearch: false \}/);
    const sheet = read('src', 'components', 'WebSearchAsk.tsx');
    expect(sheet).toMatch(/Allow web search/);
    expect(sheet).toMatch(/Not now/);
    expect(read('src', 'App.tsx')).toMatch(/<WebSearchAsk \/>/);
    expect(read('src', 'screens', 'SettingsScreen.tsx')).toMatch(/Let models search the web/);
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
    // Every downloadUpdate() call sits behind the person's click: in the
    // install handler, or in update-available once that click has been made.
    const calls = [...main.matchAll(/autoUpdater\.downloadUpdate\(\)/g)].map((m) => m.index!);
    expect(calls.length).toBeGreaterThan(0);
    const install = main.indexOf("guarded('osc:installUpdate'");
    expect(install).toBeGreaterThan(-1);
    for (const at of calls) {
      const before = main.slice(Math.max(0, at - 600), at);
      expect(before, 'a download not behind the click').toMatch(
        /installWhenReady|osc:installUpdate/,
      );
    }
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
