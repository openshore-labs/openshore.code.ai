// Vault search, the app side (Vault M6 6.1; tech review K8, K9, K16; UX review X1 to X4).
// What these rows hold:
// - a synthetic 5,000-note vault finds an agent-written note within budget:
//   title hits under 16 ms a keystroke with zero reads, body BM25 with
//   filters under 50 ms warm, the first page of excerpts at most 20 reads,
//   phrase checks at most 200 reads (CI asserts the counters, and time with a
//   4x ceiling; the reference box numbers go into PROGRESS);
// - the next keystroke cancels a search before it reads further;
// - matches are ranges drawn as marks, never an HTML string;
// - Recent merges what this device opened with the agent's notes, and the
//   agent's label shows only where `vaultCopy(...).agent` is defined (X4);
// - every Search copy line passes the house rules.
//
// The query core and the index's `titleMatches` and filtered `search` are
// stream A1's real ones over the real M3 index, so the pipeline and its
// budgets are what is measured.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  VaultIndex,
  buildPathIndex,
  normalizeNotePath,
  parseVaultQuery,
  readFrontmatter,
  resolveMarkdownLink,
  resolveWikilink,
  scanNote,
  type VaultIndexCore,
  type VaultSearchOptions,
  type VaultTitleHit,
} from 'os-code/protocol';
import { vaultCorpus } from '../../os-code/test/fixtures/vaultCorpus.js';
import {
  VAULT_QUERY_CORE,
  VAULT_RECENT_RING,
  VAULT_RECENT_ROWS,
  VAULT_SEARCH_EXCERPT_READS,
  VAULT_SEARCH_PHRASE_READS,
  cleanRanges,
  dropVaultRecent,
  hasExactTitle,
  markedPieces,
  phrasesHold,
  pushVaultRecent,
  renameVaultRecent,
  vaultBodyRows,
  vaultRecentRows,
  vaultSearchIndexState,
  vaultTitleRows,
  type VaultQueryCore,
  type VaultSearchSource,
} from '../src/lib/vaultSearch.js';
import {
  VAULT_COPY_PLATFORMS,
  VAULT_COPY_PROVIDERS,
  VAULT_RECENT_TITLE,
  VAULT_SEARCH_AWAY,
  VAULT_SEARCH_CAPPED,
  VAULT_SEARCH_FAILED,
  VAULT_SEARCH_HINT,
  VAULT_SEARCH_IN_NOTES,
  VAULT_SEARCH_LABEL,
  VAULT_SEARCH_MORE_LOADING,
  VAULT_SEARCH_PLACEHOLDER,
  VAULT_SEARCH_TITLES,
  VAULT_SEARCH_TRY_AGAIN,
  VAULT_SWITCHER_PLACEHOLDER,
  VAULT_SWITCHER_TITLE,
  VAULT_SWITCHER_TODAY,
  vaultCopy,
  vaultRecentAgentLabel,
  vaultSearchCount,
  vaultSearchFolder,
  vaultSearchIndexing,
  vaultSearchNoMatch,
  vaultSearchRowLabel,
  vaultSwitcherNew,
} from '../src/lib/vaultCopy.js';

// The real query core (stream A1), as the room uses it.
const CORE: VaultQueryCore = VAULT_QUERY_CORE;

// ---- the vault: the M3 corpus plus one note the agent wrote -------------------

const INDEX_CORE: VaultIndexCore = {
  scanNote,
  readFrontmatter,
  buildPathIndex,
  resolveWikilink,
  resolveMarkdownLink,
  normalizeNotePath,
};

const AGENT_PATH = 'Crew/Standup digest 2026-09-27.md';
const AGENT_TEXT = [
  '---',
  'tags: [crew]',
  '---',
  '# Standup digest',
  '',
  'The routine read the tickets and wrote this. The zephyrquartz migration is',
  'blocked on the orbital lantern review until Thursday.',
  '',
].join('\n');

interface Vault {
  index: VaultIndex;
  bodies: Map<string, string>;
  source: (counters: { reads: number; titleReads?: number }) => VaultSearchSource;
}

function buildVault(): Vault {
  const notes = vaultCorpus({ notes: 4999 });
  const index = new VaultIndex(INDEX_CORE);
  const bodies = new Map<string, string>();
  for (const n of notes) {
    index.applyWrite(
      { path: n.path, updatedAt: n.updatedAt, size: n.size, version: n.version },
      n.text,
    );
    bodies.set(n.path, n.text);
  }
  index.applyWrite(
    {
      path: AGENT_PATH,
      updatedAt: '2026-09-27T07:00:00.000Z',
      size: AGENT_TEXT.length,
      version: 'a1',
    },
    AGENT_TEXT,
  );
  bodies.set(AGENT_PATH, AGENT_TEXT);
  return {
    index,
    bodies,
    // The index's own members (stream A1): titles and aliases in memory, and
    // BM25 with the filter clauses, no read of any body.
    source: (counters) => ({
      titleMatches: (q: string, limit: number): VaultTitleHit[] => index.titleMatches(q, limit),
      search: (q: string, opts: VaultSearchOptions) => index.search(q, opts),
      note(path: string) {
        const e = index.entry(path);
        return e ? { title: e.title, updatedAt: e.updatedAt } : undefined;
      },
      async readBody(path: string) {
        counters.reads++;
        return bodies.get(path);
      },
    }),
  };
}

let vault: Vault;
beforeAll(() => {
  vault = buildVault();
}, 60_000);

function timed<T>(run: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = run();
  return { value, ms: performance.now() - t0 };
}

async function timedAsync<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await run();
  return { value, ms: performance.now() - t0 };
}

// CI asserts time with a 4x ceiling over the K16 budgets.
const CEILING = 4;

describe('a 5,000-note vault finds the note the agent wrote, within budget (K16)', () => {
  it('holds 5,000 notes', () => {
    expect(vault.index.size).toBe(5000);
  });

  it('title hits land at once, with zero reads, every keystroke', () => {
    const counters = { reads: 0 };
    const src = vault.source(counters);
    let worst = 0;
    let rows = vaultTitleRows(src, CORE, 's');
    for (const q of ['s', 'st', 'sta', 'stan', 'standup', 'standup d', 'standup dig']) {
      const r = timed(() => vaultTitleRows(src, CORE, q));
      worst = Math.max(worst, r.ms);
      rows = r.value;
    }
    expect(counters.reads).toBe(0);
    expect(worst).toBeLessThan(16 * CEILING);
    expect(rows.map((r) => r.path)).toContain(AGENT_PATH);
    const hit = rows.find((r) => r.path === AGENT_PATH)!;
    expect(hit.folder).toBe('Crew');
    expect(hit.group).toBe('title');
    const marked = markedPieces(hit.title.text, hit.title.ranges).filter((p) => p.mark);
    expect(marked.map((p) => p.text.toLowerCase())).toEqual(['standup', 'dig']);
  });

  it('body BM25 with a filter finds it warm, and the first page of excerpts reads at most 20', async () => {
    const q = 'zephyrquartz tag:crew';
    // Warm: once to build anything lazy, then measured.
    await vaultBodyRows(vault.source({ reads: 0 }), CORE, q);
    const counters = { reads: 0 };
    const src = vault.source(counters);
    const search = timed(() =>
      src.search(q, {
        limit: 51,
        filter: parseVaultQuery(q).clauses.filter((c) => c.kind === 'tag'),
      }),
    );
    expect(search.ms).toBeLessThan(50 * CEILING);
    const { value, ms } = await timedAsync(() => vaultBodyRows(src, CORE, q));
    expect(value.cancelled).toBe(false);
    expect(value.rows.map((r) => r.path)).toEqual([AGENT_PATH]);
    const row = value.rows[0]!;
    expect(row.group).toBe('text');
    expect(row.excerpt?.text).toContain('zephyrquartz migration');
    // The excerpt never reaches into the frontmatter.
    expect(row.excerpt?.text).not.toContain('tags:');
    const marks = markedPieces(row.excerpt!.text, row.excerpt!.ranges).filter((p) => p.mark);
    expect(marks.map((p) => p.text)).toEqual(['zephyrquartz']);
    expect(counters.reads).toBeLessThanOrEqual(VAULT_SEARCH_EXCERPT_READS);
    expect(ms).toBeLessThan(50 * CEILING + 50);
  });

  it('a broad query reads excerpts for the first page only', async () => {
    const counters = { reads: 0 };
    const seen: number[] = [];
    const r = await vaultBodyRows(vault.source(counters), CORE, 'the', {
      onRows: (rows) => seen.push(rows.length),
    });
    expect(r.rows.length).toBe(50);
    expect(r.capped).toBe(true);
    expect(counters.reads).toBeLessThanOrEqual(VAULT_SEARCH_EXCERPT_READS);
    expect(r.rows.slice(0, 20).every((row) => row.excerpt)).toBe(true);
    expect(r.rows.slice(20).some((row) => row.excerpt)).toBe(false);
    // Rows arrived before their excerpts did.
    expect(seen[0]).toBe(50);
  });

  it('title rows are left out of the text group', async () => {
    const titles = vaultTitleRows(vault.source({ reads: 0 }), CORE, 'standup');
    const r = await vaultBodyRows(vault.source({ reads: 0 }), CORE, 'standup', {
      exclude: new Set(titles.map((t) => t.path)),
    });
    expect(r.rows.map((row) => row.path)).not.toContain(AGENT_PATH);
  });

  it('a phrase is verified on bodies, at most 200 reads, progressively', async () => {
    const counters = { reads: 0 };
    const progress: string[][] = [];
    const r = await vaultBodyRows(vault.source(counters), CORE, '"orbital lantern review"', {
      onRows: (rows) => progress.push(rows.map((row) => row.path)),
    });
    expect(r.rows.map((row) => row.path)).toEqual([AGENT_PATH]);
    expect(counters.reads).toBeLessThanOrEqual(VAULT_SEARCH_PHRASE_READS);
    expect(progress.some((p) => p.includes(AGENT_PATH))).toBe(true);
    // A phrase in the wrong order does not hold.
    const wrong = await vaultBodyRows(vault.source({ reads: 0 }), CORE, '"lantern orbital review"');
    expect(wrong.rows).toEqual([]);
  });

  it('a filters-only query lists matches newest first', async () => {
    const r = await vaultBodyRows(vault.source({ reads: 0 }), CORE, 'path:crew/');
    expect(r.rows[0]?.path).toBe(AGENT_PATH);
  });

  it('the next keystroke cancels a search before it reads further', async () => {
    const counters = { reads: 0 };
    const signal = { aborted: false };
    const src = vault.source(counters);
    const slow: VaultSearchSource = {
      ...src,
      async readBody(path) {
        signal.aborted = true; // the person typed again during the first read
        return src.readBody(path);
      },
    };
    const r = await vaultBodyRows(slow, CORE, 'the', { signal });
    expect(r.cancelled).toBe(true);
    // Only the reads already in flight when the keystroke landed.
    expect(counters.reads).toBeLessThanOrEqual(4);
  });

  it('a core that throws answers nothing rather than breaking the room', async () => {
    const broken: VaultQueryCore = {
      parseVaultQuery: () => {
        throw new Error('not built');
      },
      highlightRanges: () => {
        throw new Error('not built');
      },
    };
    const src = vault.source({ reads: 0 });
    expect(() => vaultTitleRows(src, broken, 'standup')).not.toThrow();
    const r = await vaultBodyRows(src, broken, 'standup');
    expect(r.rows).toEqual([]);
  });
});

describe('Recent (K9, X4)', () => {
  it('keeps a ring of 20, newest first, each path once', () => {
    let ring = pushVaultRecent([], 'a.md', '2026-09-27T01:00:00Z');
    for (let i = 0; i < 30; i++)
      ring = pushVaultRecent(ring, `n${i}.md`, `2026-09-27T02:${String(i).padStart(2, '0')}:00Z`);
    ring = pushVaultRecent(ring, 'n5.md', '2026-09-27T03:00:00Z');
    expect(ring).toHaveLength(VAULT_RECENT_RING);
    expect(ring[0]!.path).toBe('n5.md');
    expect(ring.filter((e) => e.path === 'n5.md')).toHaveLength(1);
  });

  it('re-keys on a rename and drops on a delete', () => {
    const ring = [
      { path: 'Old.md', at: '2026-09-27T02:00:00Z' },
      { path: 'New.md', at: '2026-09-27T01:00:00Z' },
      { path: 'Other.md', at: '2026-09-27T00:00:00Z' },
    ];
    expect(renameVaultRecent(ring, 'Old.md', 'New.md').map((e) => e.path)).toEqual([
      'New.md',
      'Other.md',
    ]);
    expect(dropVaultRecent(ring, 'Other.md').map((e) => e.path)).toEqual(['Old.md', 'New.md']);
  });

  it('merges the agent-written note in, newest first, and marks it', () => {
    const opened = [
      { path: 'Work/Plan.md', at: '2026-09-27T06:00:00.000Z' },
      { path: 'Gone.md', at: '2026-09-27T08:00:00.000Z' },
    ];
    const agent = [
      { path: AGENT_PATH, title: 'Standup digest', updatedAt: '2026-09-27T07:00:00.000Z' },
    ];
    const known = new Set(['Work/Plan.md', AGENT_PATH]);
    const rows = vaultRecentRows(opened, agent, (p) => (known.has(p) ? {} : undefined));
    expect(rows.map((r) => r.path)).toEqual([AGENT_PATH, 'Work/Plan.md']);
    expect(rows[0]).toMatchObject({ agent: true, title: 'Standup digest', folder: 'Crew' });
    expect(rows[1]).toMatchObject({ agent: false, title: 'Plan', folder: 'Work' });
  });

  it('a note both opened and agent-written is one row, marked, at its newer time', () => {
    const rows = vaultRecentRows(
      [{ path: AGENT_PATH, at: '2026-09-27T09:00:00.000Z' }],
      [{ path: AGENT_PATH, updatedAt: '2026-09-27T07:00:00.000Z' }],
    );
    expect(rows).toEqual([
      {
        path: AGENT_PATH,
        title: 'Standup digest 2026-09-27',
        folder: 'Crew',
        at: '2026-09-27T09:00:00.000Z',
        agent: true,
      },
    ]);
  });

  it('shows eight rows', () => {
    const opened = Array.from({ length: 20 }, (_, i) => ({
      path: `n${i}.md`,
      at: `2026-09-27T01:${String(i).padStart(2, '0')}:00Z`,
    }));
    expect(vaultRecentRows(opened, [])).toHaveLength(VAULT_RECENT_ROWS);
  });

  it('labels an agent row only where vaultCopy(...).agent is defined', () => {
    const devices = [{}, { paired: true }, { paired: true, hubMember: true }];
    let labelled = 0;
    for (const on of VAULT_COPY_PLATFORMS) {
      for (const id of VAULT_COPY_PROVIDERS) {
        for (const opts of devices) {
          const c = vaultCopy(on, id, opts);
          const label = vaultRecentAgentLabel(c);
          if (c.agent) {
            expect(label, `${on}/${id}`).toBe('From your agent');
            labelled++;
          } else {
            expect(label, `${on}/${id} ${JSON.stringify(opts)}`).toBeUndefined();
          }
        }
      }
    }
    // Desktop This folder, and a paired phone (or web) on Your computer.
    expect(labelled).toBeGreaterThan(0);
    expect(vaultRecentAgentLabel(vaultCopy('electron', 'files'))).toBe('From your agent');
    expect(vaultRecentAgentLabel(vaultCopy('ios', 'local'))).toBeUndefined();
    expect(vaultRecentAgentLabel(vaultCopy('ios', 'hub', { paired: true }))).toBe(
      'From your agent',
    );
    expect(vaultRecentAgentLabel(vaultCopy('electron', 'org'))).toBeUndefined();
  });
});

describe('ranges and marks', () => {
  it('clamps, sorts and merges ranges', () => {
    expect(
      cleanRanges('abcdef', [
        { start: 4, end: 9 },
        { start: 0, end: 2 },
        { start: 1, end: 3 },
        { start: 3, end: 3 },
      ]),
    ).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ]);
  });

  it('cuts text into plain and marked pieces, keeping every character', () => {
    const text = 'a <b>bold</b> & more';
    const pieces = markedPieces(text, [{ start: 2, end: 13 }]);
    expect(pieces.map((p) => p.text).join('')).toBe(text);
    expect(pieces.filter((p) => p.mark).map((p) => p.text)).toEqual(['<b>bold</b>']);
  });

  it('checks phrases folded, and negated phrases', () => {
    const body = 'The Orbital\nLantern review';
    expect(phrasesHold(body, [{ kind: 'phrase', value: 'orbital lantern', negated: false }])).toBe(
      true,
    );
    expect(phrasesHold(body, [{ kind: 'phrase', value: 'orbital lantern', negated: true }])).toBe(
      false,
    );
  });

  it('knows an exact title when it sees one', () => {
    const rows = vaultTitleRows(vault.source({ reads: 0 }), CORE, 'standup digest 2026-09-27');
    expect(hasExactTitle(rows, 'Standup digest 2026-09-27')).toBe(true);
    expect(hasExactTitle(rows, 'Standup')).toBe(false);
  });
});

describe('the index state search says (X2)', () => {
  it('maps the host status', () => {
    expect(vaultSearchIndexState({ state: 'ready', progress: null })).toEqual({ kind: 'ready' });
    expect(
      vaultSearchIndexState({ state: 'building', progress: { done: 12, total: 400, failed: 0 } }),
    ).toEqual({ kind: 'loading', done: 12, total: 400 });
    expect(vaultSearchIndexState({ state: 'ready', progress: null }, true)).toEqual({
      kind: 'failed',
    });
  });
});

describe('the Search copy (UX review X1 to X4, R2)', () => {
  const lines = [
    VAULT_SEARCH_PLACEHOLDER,
    VAULT_SEARCH_LABEL,
    VAULT_SEARCH_HINT,
    VAULT_SEARCH_TITLES,
    VAULT_SEARCH_IN_NOTES,
    VAULT_SEARCH_CAPPED,
    VAULT_SEARCH_MORE_LOADING,
    VAULT_SEARCH_FAILED,
    VAULT_SEARCH_TRY_AGAIN,
    VAULT_SEARCH_AWAY,
    VAULT_SWITCHER_TITLE,
    VAULT_SWITCHER_PLACEHOLDER,
    VAULT_SWITCHER_TODAY,
    VAULT_RECENT_TITLE,
    vaultSearchCount(1),
    vaultSearchCount(12),
    vaultSearchNoMatch('  plan  '),
    vaultSearchIndexing(3, 40),
    vaultSearchFolder('Work/Plans'),
    vaultSearchRowLabel('Plan', 'Work/Plans', 'the excerpt'),
    vaultSwitcherNew('Idea '),
  ];

  it('says exactly what UX review wrote', () => {
    expect(VAULT_SEARCH_PLACEHOLDER).toBe('Search notes');
    expect(VAULT_SEARCH_LABEL).toBe('Search your vault');
    expect(VAULT_SEARCH_HINT).toBe('Try tag:, path:, file:, or "an exact phrase".');
    expect(vaultSearchCount(1)).toBe('1 note');
    expect(vaultSearchCount(12)).toBe('12 notes');
    expect(vaultSearchNoMatch('  plan  ')).toBe('No notes match "plan".');
    expect(vaultSearchIndexing(3, 40)).toBe('Titles are ready. Reading note text, 3 of 40.');
    expect(vaultSearchFolder('Work/Plans')).toBe('Work / Plans');
    expect(vaultSearchFolder('')).toBe('');
    expect(vaultSearchRowLabel('Plan', 'Work/Plans', 'the excerpt')).toBe(
      'Plan, in Work / Plans. the excerpt',
    );
    expect(vaultSearchRowLabel('Plan', '')).toBe('Plan.');
    expect(vaultSwitcherNew('Idea ')).toBe('New note "Idea"');
  });

  it('names the agent in no line but the gated Recent label', () => {
    for (const line of lines) expect(line).not.toMatch(/\bagents?\b/i);
  });

  it('never says Retry, offline, synced, or safe (the dash guards cover dashes)', () => {
    for (const line of lines) {
      expect(line).not.toMatch(/\bRetry\b|\boffline\b|\bsynced\b|\bsafe\b|\bsuccessfully\b/i);
    }
  });

  it('keeps the literal copy out of the components', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    for (const file of ['VaultSearch.tsx', 'VaultSwitcher.tsx']) {
      const src = readFileSync(join(here, '../src/components/vault', file), 'utf8');
      for (const line of lines.slice(0, 14))
        expect(src, `${file}: ${line}`).not.toContain(`'${line}'`);
      expect(src).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});
