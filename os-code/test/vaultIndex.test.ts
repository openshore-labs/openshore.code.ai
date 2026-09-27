// The Vault index, pure core (Vault M3, CTO H3): the tokenizer, reconcile,
// incremental resolution by folded basename, BM25, serialize and load, the
// limits, and the CI trip wire on the seeded 5,000-note corpus.
//
// The index is fed its grammar and resolution as an injected core. These tests
// load the real shared core when stream A's files are on the tree and the test
// stand-in otherwise (test/helpers/vaultIndexCore.ts), and only lean on cases
// both read the same way.
import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  BM25_B,
  BM25_K1,
  CORE_VERSION,
  INDEX_MAX_BODY_TERMS,
  PREFIX_EXPANSIONS,
  VaultIndex,
  compareCodePoints,
  loadIndex,
  planReconcile,
  serializeIndex,
  utf8Bytes,
} from '../src/harness/vault/index.js';
import { BODY_STOPWORDS, queryTerms, tokenize } from '../src/harness/vault/tokenize.js';
import type { VaultListedNote } from '../src/harness/vault/types.js';
import { vaultCorpus } from './fixtures/vaultCorpus.js';
import { loadVaultIndexCore } from './helpers/vaultIndexCore.js';
import type { VaultIndexCore } from '../src/harness/vault/index.js';

const { core, coreKind } = await loadVaultIndexCore();

let clock = 0;
function meta(path: string, version?: string): VaultListedNote {
  clock++;
  return {
    path,
    updatedAt: new Date(Date.UTC(2026, 8, 1) + clock * 1000).toISOString(),
    size: 1,
    version: version ?? `v${clock}`,
  };
}

function indexOf(notes: Record<string, string>): VaultIndex {
  const idx = new VaultIndex(core);
  for (const [path, text] of Object.entries(notes)) idx.applyWrite(meta(path), text);
  return idx;
}

describe('tokenize', () => {
  it('folds with NFKC and lowercase, keeps letter and digit runs of 2 to 32', () => {
    expect(tokenize('Ｆｕｌｌ Width, x Café-42 a')).toEqual(['full', 'width', 'café', '42']);
    expect(tokenize(`ok ${'z'.repeat(32)} ${'y'.repeat(33)}`)).toEqual(['ok', 'z'.repeat(32)]);
  });

  it('turns Han, Kana and Hangul runs into bigrams', () => {
    expect(tokenize('東京都')).toEqual(['東京', '京都']);
    expect(tokenize('한국어')).toEqual(['한국', '국어']);
    expect(tokenize('iphone15の設計')).toEqual(['iphone15', 'の設', '設計']);
  });

  it('drops stopwords from a query unless it is only stopwords', () => {
    expect(queryTerms('the plan of record')).toEqual(['plan', 'record']);
    expect(queryTerms('the who')).toEqual(['who']);
    expect(queryTerms('of the')).toEqual(['of', 'the']);
    expect(BODY_STOPWORDS.size).toBeGreaterThanOrEqual(25);
  });
});

describe('planReconcile', () => {
  const entries = [
    { path: 'a.md', version: '1' },
    { path: 'b.md', version: '1' },
    { path: 'gone.md', version: '1' },
    { path: 'cold.md', version: '1' },
  ];

  it('compares versions only, never mtime or size', () => {
    const plan = planReconcile(entries, [
      { path: 'a.md', version: '1', updatedAt: '2030-01-01T00:00:00Z', size: 999 },
      { path: 'b.md', version: '2', updatedAt: '2000-01-01T00:00:00Z', size: 1 },
      { path: 'new.md', updatedAt: 't', size: 1 },
      { path: 'cold.md', version: '9', updatedAt: 't', size: 1, evicted: true },
      { path: 'far.md', updatedAt: 't', size: 1, evicted: true },
      { path: 'pic.png', updatedAt: 't', size: 1 },
    ]);
    expect(plan.keep).toEqual(['a.md', 'cold.md']);
    expect(plan.read).toEqual(['b.md', 'new.md']);
    expect(plan.drop).toEqual(['gone.md']);
    expect(plan.placeholder).toEqual(['far.md']);
    expect(plan.partial).toBe(false);
  });

  it('uses updatedAt as the version when a listing has none', () => {
    const plan = planReconcile(
      [{ path: 'a.md', version: 't1' }],
      [{ path: 'a.md', updatedAt: 't1', size: 1 }],
    );
    expect(plan.keep).toEqual(['a.md']);
  });

  it('over the cap indexes the first notes in path order and says partial', () => {
    const listed = ['c.md', 'a.md', 'b.md', 'd.md'].map((p) => ({
      path: p,
      updatedAt: 't',
      size: 1,
    }));
    const plan = planReconcile([{ path: 'd.md', version: 't' }], listed, { maxNotes: 3 });
    expect(plan.read).toEqual(['a.md', 'b.md', 'c.md']);
    expect(plan.drop).toEqual(['d.md']);
    expect(plan.partial).toBe(true);
  });
});

describe('VaultIndex links', () => {
  it('builds entries and backlinks with offsets, never from a code fence', () => {
    const text = 'See [[B]] and [[B|bee]].\n\n```\n[[B]]\n```\n';
    const idx = indexOf({ 'A.md': text, 'B.md': '# B\n' });
    const back = idx.backlinks('B.md');
    expect(back).toEqual([{ source: 'A.md', at: [text.indexOf('[[B]]'), text.indexOf('[[B|')] }]);
    expect(idx.entry('A.md')!.links).toHaveLength(2);
    expect(idx.entry('B.md')!.headings).toEqual([{ level: 1, text: 'B', line: 0 }]);
  });

  it('a new note resolves the links waiting on its basename, and only those', () => {
    const idx = indexOf({
      'A.md': 'to [[Plan]]',
      'C.md': 'to [[Other]]',
      'D.md': 'to [[plan]]',
    });
    expect(idx.backlinks('Ideas/Plan.md')).toEqual([]);
    idx.resolve();
    const before = idx.counters.sourcesResolved;
    idx.applyWrite(meta('Ideas/Plan.md'), '# Plan');
    expect(idx.backlinks('Ideas/Plan.md').map((b) => b.source)).toEqual(['A.md', 'D.md']);
    // The new note itself, plus A and D. C is never touched.
    expect(idx.counters.sourcesResolved - before).toBe(3);
  });

  it('removing a note unresolves links to it and re-resolves by basename', () => {
    const idx = indexOf({ 'A.md': '[[Plan]]', 'x/Plan.md': '', 'y/Plan.md': '' });
    const first = idx.outlinks('A.md')[0]!.resolved;
    expect(first).not.toBeNull();
    idx.applyRemove(first!);
    const second = idx.outlinks('A.md')[0]!.resolved;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    idx.applyRemove(second!);
    expect(idx.outlinks('A.md')[0]!.resolved).toBeNull();
    expect(idx.backlinks(first!)).toEqual([]);
  });

  it('updating one note builds one entry and resolves one source', () => {
    const idx = indexOf({ 'A.md': '[[B]]', 'B.md': '[[A]]', 'C.md': '[[B]]' });
    idx.resolve();
    const built = idx.counters.entriesBuilt;
    const resolved = idx.counters.sourcesResolved;
    const builds = idx.counters.pathIndexBuilds;
    idx.applyWrite(meta('A.md'), 'now [[C]]');
    expect(idx.backlinks('C.md').map((b) => b.source)).toEqual(['A.md']);
    expect(idx.backlinks('B.md').map((b) => b.source)).toEqual(['C.md']);
    expect(idx.counters.entriesBuilt - built).toBe(1);
    expect(idx.counters.sourcesResolved - resolved).toBe(1);
    // An edit changes no path, so the path index is not rebuilt.
    expect(idx.counters.pathIndexBuilds - builds).toBe(0);
  });

  it('resolves markdown links and self links, and leaves attachments out', () => {
    const idx = indexOf({
      'notes/A.md': '[b](../B.md) [pic](img.png) [[#Top]]',
      'B.md': '',
    });
    const out = idx.outlinks('notes/A.md');
    expect(out.map((o) => o.link.kind)).toEqual(['md', 'wiki']);
    expect(out.map((o) => o.resolved)).toEqual(['B.md', 'notes/A.md']);
    expect(idx.backlinks('notes/A.md')).toEqual([]);
  });

  it('reads tags, aliases and frontmatter keys; tags dedupe in lowercase', () => {
    const text = '---\ntags: [Project]\naliases: [Alpha One]\n---\nBody #project #idea ^blk\n';
    const idx = indexOf({ 'A.md': text });
    const e = idx.entry('A.md')!;
    expect(e.tags).toEqual(['Project', 'idea']);
    expect(e.aliases).toEqual(['Alpha One']);
    expect(e.fmKeys).toEqual(['tags', 'aliases']);
    expect(e.fmState).toBe('ok');
    expect(e.blockIds).toEqual(['blk']);
    expect(e.tokens).toBe(Math.ceil(utf8Bytes(text) / 4));
  });
});

describe('VaultIndex search (BM25)', () => {
  it('weights the title over the body', () => {
    const idx = indexOf({
      'Zebra.md': 'nothing here',
      'Other.md': 'a zebra went by',
    });
    expect(idx.search('zebra').map((h) => h.path)).toEqual(['Zebra.md', 'Other.md']);
  });

  it('scores by the pinned formula and breaks ties by path', () => {
    const idx = indexOf({ 'n1.md': 'apple', 'n2.md': 'apple', 'n3.md': 'pear' });
    const hits = idx.search('apple');
    expect(hits.map((h) => h.path)).toEqual(['n1.md', 'n2.md']);
    // Each doc: title term n1/n2/n3 at weight 3, one body term at weight 1.
    const n = 3;
    const df = 2;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    const tf = 1;
    const dl = 4;
    const avgdl = 4;
    const want =
      (idf * (tf * (BM25_K1 + 1))) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * dl) / avgdl));
    expect(hits[0]!.score).toBeCloseTo(want, 10);
    expect(hits[0]!.score).toBe(hits[1]!.score);
  });

  it('indexes code, not %% comments, and keeps stopwords out of the body only', () => {
    const idx = indexOf({
      'A.md': 'x %%secretword%% y\n```\nfunctionname()\n```\n',
      'The Who.md': 'band',
      'B.md': 'the the the',
    });
    expect(idx.search('secretword')).toEqual([]);
    expect(idx.search('functionname').map((h) => h.path)).toEqual(['A.md']);
    expect(idx.search('the').map((h) => h.path)).toEqual(['The Who.md']);
  });

  it('caps distinct body terms per note', () => {
    const words = Array.from({ length: INDEX_MAX_BODY_TERMS + 50 }, (_, i) => `w${i.toString(36)}`);
    const idx = indexOf({ 'Big.md': words.join(' ') });
    expect(idx.search(words[0]!).length).toBe(1);
    expect(idx.search(words[words.length - 1]!)).toEqual([]);
  });

  it('indexes a body over 2 MB for metadata only', () => {
    const body = `[[B]] needle ${'filler '.repeat(310_000)}`;
    const idx = indexOf({ 'Huge.md': body, 'B.md': '' });
    expect(idx.search('needle')).toEqual([]);
    expect(idx.search('huge').map((h) => h.path)).toEqual(['Huge.md']);
    expect(idx.backlinks('B.md').map((b) => b.source)).toEqual(['Huge.md']);
  });
});

describe('VaultIndex listing, placeholders and limits', () => {
  it('applyListing drops, keeps placeholders title-only, and returns what to read', () => {
    const idx = indexOf({ 'A.md': 'alpha', 'Old.md': 'x' });
    const a = idx.entry('A.md')!;
    const plan = idx.applyListing([
      { path: 'A.md', updatedAt: a.updatedAt, size: 1, version: a.version },
      { path: 'Cloud Note.md', updatedAt: 't', size: 5, evicted: true },
      { path: 'New.md', updatedAt: 't', size: 1 },
    ]);
    expect(plan.read).toEqual(['New.md']);
    expect(idx.has('Old.md')).toBe(false);
    const ph = idx.entry('Cloud Note.md')!;
    expect(ph.evicted).toBe(true);
    expect(ph.version).toBe('');
    expect(idx.search('cloud').map((h) => h.path)).toEqual(['Cloud Note.md']);
    // Downloaded later: the empty version never matches, so it is read.
    const again = idx.applyListing([
      { path: 'A.md', updatedAt: a.updatedAt, size: 1, version: a.version },
      { path: 'Cloud Note.md', updatedAt: 't', size: 5, version: 'v1' },
    ]);
    expect(again.read).toEqual(['Cloud Note.md']);
  });

  it('stops at the note cap and says partial', () => {
    const idx = new VaultIndex(core, { maxNotes: 2 });
    const plan = idx.applyListing(['c.md', 'a.md', 'b.md'].map((p) => meta(p)));
    expect(plan.read).toEqual(['a.md', 'b.md']);
    for (const p of plan.read) idx.applyWrite(meta(p), 'x');
    expect(idx.applyWrite(meta('c.md'), 'x')).toBeUndefined();
    expect(idx.size).toBe(2);
    expect(idx.state).toBe('partial');
  });

  it('reports its state', () => {
    const idx = new VaultIndex(core);
    expect(idx.state).toBe('empty');
    idx.beginBuild();
    expect(idx.state).toBe('building');
    idx.applyWrite(meta('a.md'), 'x');
    idx.endBuild();
    expect(idx.state).toBe('ready');
  });

  it('orders by code point', () => {
    expect(['b', '\u{1F600}', '～', 'a'].sort(compareCodePoints)).toEqual([
      'a',
      'b',
      '～',
      '\u{1F600}',
    ]);
  });
});

describe('serializeIndex and loadIndex', () => {
  const notes = {
    'A.md': '# Alpha\n[[B]] apple #fruit',
    'B.md': '---\naliases: [Bee]\n---\nbanana [[A#Alpha]]',
    'sub/C.md': 'cherry [[B|bee]]',
  };

  it('round-trips: same entries, same backlinks, same scores', () => {
    const idx = indexOf(notes);
    const ser = serializeIndex(idx);
    expect(ser.withTerms).toBe(true);
    expect(ser.fits).toBe(true);
    const file = JSON.parse(ser.json);
    expect(file.coreVersion).toBe(CORE_VERSION);
    // Nothing derived is persisted.
    expect(Object.keys(file).sort()).toEqual(['coreVersion', 'dict', 'entries', 'state']);
    expect(file.entries[0]).not.toHaveProperty('resolved');
    const { index, status } = loadIndex(ser.json, core);
    expect(status).toBe('loaded');
    expect(index.paths()).toEqual(idx.paths());
    for (const p of idx.paths()) {
      expect(index.entry(p)).toEqual(idx.entry(p));
      expect(index.backlinks(p)).toEqual(idx.backlinks(p));
    }
    for (const q of ['apple', 'banana bee', 'cherry', 'alpha']) {
      expect(index.search(q)).toEqual(idx.search(q));
    }
  });

  it('a CORE_VERSION mismatch or a broken file forces a rebuild', () => {
    const ser = JSON.parse(serializeIndex(indexOf(notes)).json);
    expect(loadIndex({ ...ser, coreVersion: CORE_VERSION + 1 }, core).status).toBe('rebuild');
    expect(loadIndex('{not json', core).status).toBe('rebuild');
    expect(loadIndex(null, core).status).toBe('rebuild');
    expect(loadIndex('[]', core).index.size).toBe(0);
  });

  it("keeps a note's oscode marks through a save and a load (CORE_VERSION 2)", () => {
    const idx = indexOf({
      ...notes,
      'Pinned.md': '---\noscode: [Pin, local-only, nonsense]\n---\nkept close',
    });
    expect(idx.entry('Pinned.md')?.oscode).toEqual(['pin', 'local-only']);
    expect(idx.entry('A.md')).not.toHaveProperty('oscode');
    const { index } = loadIndex(serializeIndex(idx).json, core);
    expect(index.entry('Pinned.md')?.oscode).toEqual(['pin', 'local-only']);
  });

  it('drops malformed entries one by one', () => {
    const ser = JSON.parse(serializeIndex(indexOf(notes)).json);
    ser.entries.push({ path: 'bad.md' }, { ...ser.entries[0], path: '../x.txt' }, 7);
    ser.entries.push({ ...ser.entries[0] });
    ser.entries[1].terms = 'zz:zz,!!:1,0:';
    const { index, dropped, status } = loadIndex(JSON.stringify(ser), core);
    expect(status).toBe('loaded');
    expect(dropped).toBe(4);
    expect(index.paths()).toEqual(['A.md', 'B.md', 'sub/C.md']);
  });

  it('over the cap saves without vectors and asks for them back', () => {
    const idx = indexOf(notes);
    const full = serializeIndex(idx);
    const slim = serializeIndex(idx, { maxBytes: full.bytes - 1 });
    expect(slim.withTerms).toBe(false);
    expect(slim.fits).toBe(true);
    const file = JSON.parse(slim.json);
    expect(file.dict).toEqual([]);
    expect(file.entries.every((e: { terms: string }) => e.terms === 'memory')).toBe(true);
    const { index } = loadIndex(slim.json, core);
    expect(index.search('apple')).toEqual([]);
    expect(index.backlinks('B.md')).toEqual(idx.backlinks('B.md'));
    expect(index.missingTerms()).toEqual(['A.md', 'B.md', 'sub/C.md']);
    for (const p of index.missingTerms()) index.applyWrite(meta(p), notes[p as keyof typeof notes]);
    expect(index.missingTerms()).toEqual([]);
    expect(index.search('apple').map((h) => h.path)).toEqual(['A.md']);
    expect(serializeIndex(idx, { maxBytes: 10 }).fits).toBe(false);
  });
});

describe(`the seeded 5,000-note corpus (${coreKind})`, () => {
  const corpus = vaultCorpus();

  it('has the shape the bench promises', () => {
    expect(corpus).toHaveLength(5000);
    const withFm = corpus.filter((n) => n.text.startsWith('---\n')).length;
    const withFence = corpus.filter((n) => n.text.includes('```')).length;
    expect(withFm / 5000).toBeGreaterThan(0.25);
    expect(withFm / 5000).toBeLessThan(0.35);
    expect(withFence).toBe(500);
    const words = corpus[1]!.text.split(/\s+/).length;
    expect(words).toBeGreaterThan(400);
    expect(words).toBeLessThan(520);
    expect(vaultCorpus({ notes: 3 })).toEqual(vaultCorpus({ notes: 3 }));
  });

  it('CI trip wire: the pure-core build stays under 20 s; warm backlinks under 100 ms', () => {
    const t0 = performance.now();
    const idx = new VaultIndex(core);
    idx.beginBuild();
    for (const n of corpus) idx.applyWrite(n, n.text);
    idx.resolve();
    idx.endBuild();
    const buildMs = performance.now() - t0;
    expect(buildMs).toBeLessThan(20_000);
    expect(idx.size).toBe(5000);

    const target = corpus[42]!.path;
    const b0 = performance.now();
    const back = idx.backlinks(target);
    expect(performance.now() - b0).toBeLessThan(100);
    expect(Array.isArray(back)).toBe(true);

    // No link inside a fence is ever counted.
    for (const n of corpus.slice(0, 50)) {
      expect(idx.entry(n.path)!.links.some((l) => l.target.startsWith('Not A Link'))).toBe(false);
    }
    // Every note carries its 4 links (plus the fence's, which is skipped).
    const linked = corpus.slice(0, 200).filter((n) => idx.entry(n.path)!.links.length === 4);
    expect(linked.length).toBe(200);
    // Updating one note touches one entry.
    const built = idx.counters.entriesBuilt;
    idx.applyWrite({ ...corpus[7]!, version: 'edited' }, `${corpus[7]!.text}\nmore words`);
    idx.resolve();
    expect(idx.counters.entriesBuilt - built).toBe(1);
  }, 60_000);
});

describe('VaultIndex search with the K8 grammar (Vault M6)', () => {
  const paths = (hits: Array<{ path: string }>) => hits.map((h) => h.path);
  const notes = () =>
    indexOf({
      'Work/Plans/Budget.md':
        '---\ntags: [finance/q3]\n---\nThe budget plan for the quarter. #draft',
      'Work/Roadmap.md': 'A roadmap and a plan, no money talk. #idea',
      'Home/Garden.md': 'Planting tomatoes and a budget for seeds. #idea/garden',
      'Journal/2026-09-01.md': 'Today I planned the garden. Exact phrase here.',
      'Archive/Old Budget.md': 'The old budget, retired. #draft',
    });

  it('keeps the M3 any-word search when called with a number', () => {
    const idx = notes();
    expect(paths(idx.search('roadmap tomatoes', 10))).toEqual(
      expect.arrayContaining(['Work/Roadmap.md', 'Home/Garden.md']),
    );
  });

  it('needs every term in the note', () => {
    const idx = notes();
    expect(paths(idx.search('budget seeds ', {}))).toEqual(['Home/Garden.md']);
    expect(paths(idx.search('roadmap tomatoes ', {}))).toEqual([]);
    expect(paths(idx.search('nosuchword budget ', {}))).toEqual([]);
  });

  it('matches the last open word as a prefix, the best expansion scoring', () => {
    const idx = notes();
    expect(paths(idx.search('garden plan', {})).sort()).toEqual([
      'Home/Garden.md',
      'Journal/2026-09-01.md',
    ]);
    // With a trailing space the word is whole again.
    expect(paths(idx.search('garden plan ', {}))).toEqual([]);
    expect(idx.search('zzq', {})).toEqual([]);
  });

  it('expands a prefix to at most 50 terms, the most common first', () => {
    const body = Array.from({ length: 80 }, (_, i) => `pre${i.toString(36).padStart(2, '0')}`);
    const idx = indexOf({ 'A.md': body.join(' '), 'B.md': 'pre00 pre01', 'C.md': 'pre01' });
    const got = idx.expandPrefix('PRE');
    expect(got).toHaveLength(PREFIX_EXPANSIONS);
    expect(got.slice(0, 2)).toEqual(['pre01', 'pre00']);
    expect(idx.expandPrefix('pre', 3)).toEqual(['pre01', 'pre00', 'pre02']);
    expect(idx.expandPrefix('')).toEqual([]);
    expect(idx.expandPrefix('nope')).toEqual([]);
  });

  it('narrows by tag:, matching a tag and anything under it, case-insensitive', () => {
    const idx = notes();
    expect(paths(idx.search('#IDEA', {})).sort()).toEqual(['Home/Garden.md', 'Work/Roadmap.md']);
    expect(paths(idx.search('tag:idea/garden', {}))).toEqual(['Home/Garden.md']);
    expect(paths(idx.search('tag:finance budget ', {}))).toEqual(['Work/Plans/Budget.md']);
    // A tag never matches a longer sibling name.
    expect(paths(idx.search('tag:ide', {}))).toEqual([]);
  });

  it('narrows by path: and file:, with .md optional', () => {
    const idx = notes();
    expect(paths(idx.search('budget path:work ', {}))).toEqual(['Work/Plans/Budget.md']);
    expect(paths(idx.search('file:budget.md', {})).sort()).toEqual([
      'Archive/Old Budget.md',
      'Work/Plans/Budget.md',
    ]);
    expect(paths(idx.search('file:"old budget"', {}))).toEqual(['Archive/Old Budget.md']);
  });

  it('excludes with -, on terms, tags, paths and files', () => {
    const idx = notes();
    const all = paths(idx.search('budget ', {})).sort();
    expect(all).toEqual(['Archive/Old Budget.md', 'Home/Garden.md', 'Work/Plans/Budget.md']);
    expect(paths(idx.search('budget -seeds ', {})).sort()).toEqual([
      'Archive/Old Budget.md',
      'Work/Plans/Budget.md',
    ]);
    expect(paths(idx.search('budget -tag:draft ', {}))).toEqual(['Home/Garden.md']);
    expect(paths(idx.search('budget -path:archive -file:budget ', {}))).toEqual(['Home/Garden.md']);
  });

  it('lists a filters-only query newest first', () => {
    const idx = notes();
    // indexOf feeds notes in order, each a second newer than the last.
    const got = idx.search('tag:draft', {});
    expect(paths(got)).toEqual(['Archive/Old Budget.md', 'Work/Plans/Budget.md']);
    expect(got.every((h) => h.score === 0)).toBe(true);
    expect(paths(idx.search('-tag:draft -tag:idea', {}))).toEqual(['Journal/2026-09-01.md']);
    expect(idx.search('', {})).toEqual([]);
  });

  it('adds filter clauses from the options to the typed query', () => {
    const idx = notes();
    const filter = [{ kind: 'path' as const, value: 'home', negated: false }];
    expect(paths(idx.search('budget ', { filter }))).toEqual(['Home/Garden.md']);
    expect(paths(idx.search('', { filter }))).toEqual(['Home/Garden.md']);
    expect(idx.search('budget ', { limit: 1 })).toHaveLength(1);
  });

  it('uses a phrase as a candidate filter by its words; the host checks the phrase', () => {
    const idx = notes();
    expect(paths(idx.search('"exact phrase"', {}))).toEqual(['Journal/2026-09-01.md']);
    expect(paths(idx.search('"phrase exact"', {}))).toEqual(['Journal/2026-09-01.md']);
    expect(idx.search('"missing words"', {})).toEqual([]);
    // A phrase of stopwords alone cannot be ranked, so every note is a
    // candidate, newest first.
    expect(idx.search('"of the"', {})).toHaveLength(5);
  });
});

describe('VaultIndex.titleMatches (Vault M6, the switcher)', () => {
  const idx = () => {
    const i = new VaultIndex(core);
    i.applyWrite(meta('Projects/Budget.md'), 'x');
    i.applyWrite(meta('Budget Review.md'), 'x');
    i.applyWrite(meta('Old/My Budget 2025.md'), 'x');
    i.applyWrite(meta('Recipes.md'), '---\naliases: [Cookbook]\ntags: [food]\n---\nbody');
    i.applyWrite(meta('Nobudgetword.md'), 'x');
    return i;
  };

  it('ranks the exact name, then a name that starts with it, then a word start', () => {
    const hits = idx().titleMatches('budget');
    expect(hits.map((h) => h.path)).toEqual([
      'Projects/Budget.md',
      'Budget Review.md',
      'Old/My Budget 2025.md',
      'Nobudgetword.md',
    ]);
    expect(hits[0]!.field).toBe('title');
    expect(hits[0]!.ranges).toEqual([{ start: 0, end: 6 }]);
    expect(hits[2]!.ranges).toEqual([{ start: 3, end: 9 }]);
  });

  it('needs every word, marks each, and takes the filters and negations', () => {
    const i = idx();
    const hits = i.titleMatches('rev bud');
    expect(hits.map((h) => h.path)).toEqual(['Budget Review.md']);
    expect(hits[0]!.ranges).toEqual([
      { start: 0, end: 3 },
      { start: 7, end: 10 },
    ]);
    expect(i.titleMatches('budget path:old').map((h) => h.path)).toEqual(['Old/My Budget 2025.md']);
    expect(i.titleMatches('budget -review').map((h) => h.path)).not.toContain('Budget Review.md');
    expect(i.titleMatches('tag:food')).toEqual([]);
    expect(i.titleMatches('')).toEqual([]);
    expect(i.titleMatches('budget', 2)).toHaveLength(2);
  });

  it('matches an alias, marked on the alias text', () => {
    const hits = idx().titleMatches('COOK');
    expect(hits).toEqual([
      {
        path: 'Recipes.md',
        field: 'alias',
        text: 'Cookbook',
        score: expect.any(Number),
        ranges: [{ start: 0, end: 4 }],
      },
    ]);
  });
});

describe('VaultIndex.applyRename (Vault M6)', () => {
  it('moves the entry with no text read, and re-titles its terms', () => {
    const idx = indexOf({ 'Old Name.md': 'body words [[Other]]', 'Other.md': 'x' });
    const built = idx.counters.entriesBuilt;
    const moved = idx.applyRename('Old Name.md', {
      path: 'Folder/Fresh Title.md',
      updatedAt: '2026-09-27T00:00:00.000Z',
      size: 20,
      version: 'v-new',
    })!;
    expect(idx.counters.entriesBuilt).toBe(built);
    expect(idx.counters.renames).toBe(1);
    expect(moved.title).toBe('Fresh Title');
    expect(moved.version).toBe('v-new');
    expect(idx.has('Old Name.md')).toBe(false);
    expect(idx.entry('Folder/Fresh Title.md')!.links.map((l) => l.target)).toEqual(['Other']);
    expect(idx.search('fresh').map((h) => h.path)).toEqual(['Folder/Fresh Title.md']);
    expect(idx.search('old')).toEqual([]);
    expect(idx.search('words').map((h) => h.path)).toEqual(['Folder/Fresh Title.md']);
    expect(idx.titleMatches('fresh').map((h) => h.path)).toEqual(['Folder/Fresh Title.md']);
    expect(idx.backlinks('Other.md').map((b) => b.source)).toEqual(['Folder/Fresh Title.md']);
    // The file matches one built from the same text at the new path.
    const fresh = indexOf({ 'Folder/Fresh Title.md': 'body words [[Other]]', 'Other.md': 'x' });
    expect(idx.search('fresh body words')[0]!.score).toBeCloseTo(
      fresh.search('fresh body words')[0]!.score,
      10,
    );
  });

  it('keeps the version given only a path, and resolves only what the move touches', () => {
    const notes: Record<string, string> = { 'Target.md': 'x', 'Linker.md': '[[Target]]' };
    for (let i = 0; i < 50; i++) notes[`Bystander ${i}.md`] = `[[Elsewhere ${i}]]`;
    notes['Waiting.md'] = '[[Renamed]]';
    const idx = indexOf(notes);
    idx.resolve();
    const version = idx.entry('Target.md')!.version;
    const before = idx.counters.sourcesResolved;
    idx.applyRename('Target.md', 'Renamed.md');
    expect(idx.entry('Renamed.md')!.version).toBe(version);
    // The old link no longer reaches the note; the waiting link now does.
    expect(idx.backlinks('Renamed.md').map((b) => b.source)).toEqual(['Waiting.md']);
    expect(idx.backlinks('Target.md')).toEqual([]);
    // Linker, Waiting and the note itself; never the 50 bystanders.
    expect(idx.counters.sourcesResolved - before).toBeLessThanOrEqual(3);
  });

  it('answers undefined for an unknown note, and a non-note target removes it', () => {
    const idx = indexOf({ 'A.md': 'x' });
    expect(idx.applyRename('Nope.md', 'B.md')).toBeUndefined();
    expect(idx.applyRename('A.md', 'A.txt')).toBeUndefined();
    expect(idx.has('A.md')).toBe(false);
  });

  it('survives a serialize and load after a rename', () => {
    const idx = indexOf({ 'A.md': 'alpha words', 'B.md': 'beta' });
    idx.applyRename('A.md', 'Gamma.md');
    const { index } = loadIndex(serializeIndex(idx).json, core);
    expect(index.search('gamma alpha ', {})).toEqual(idx.search('gamma alpha ', {}));
  });
});

describe(`the K16 search budget on 5,000 notes (${coreKind})`, () => {
  it('answers titles, prefixes and filtered BM25 with no read and no core call, in budget', () => {
    const corpus = vaultCorpus();
    // Count every call into the core: search must make none.
    const calls = { n: 0 };
    const counted = Object.fromEntries(
      Object.entries(core).map(([k, fn]) => [
        k,
        (...args: unknown[]) => {
          calls.n++;
          return (fn as (...a: unknown[]) => unknown)(...args);
        },
      ]),
    ) as unknown as VaultIndexCore;
    // The host's reads: the index is fed text in hand, so a search reads none.
    let reads = 0;
    const bodies = new Map(corpus.map((n) => [n.path, n.text]));
    const read = (path: string) => {
      reads++;
      return bodies.get(path)!;
    };
    const idx = new VaultIndex(counted);
    for (const n of corpus) idx.applyWrite(n, read(n.path));
    const agent = {
      path: 'Inbox/Agent run note.md',
      updatedAt: '2027-01-01T00:00:00.000Z',
      size: 60,
      version: 'agent',
    };
    idx.applyWrite(agent, '---\ntags: [crew/run]\n---\nThe quarterly zzyzx reconciliation.');
    idx.resolve();
    const warm = idx.search('warmup ', {});
    expect(Array.isArray(warm)).toBe(true);
    const readsBefore = reads;
    const callsBefore = calls.n;
    const counters = { ...idx.counters };

    // Title hits: one keystroke at a time, each under 4x 16 ms.
    const typed = 'agent run';
    let worstTitle = 0;
    for (let k = 1; k <= typed.length; k++) {
      const t0 = performance.now();
      const hits = idx.titleMatches(typed.slice(0, k));
      worstTitle = Math.max(worstTitle, performance.now() - t0);
      if (k === typed.length) expect(hits[0]!.path).toBe(agent.path);
    }
    expect(worstTitle).toBeLessThan(16 * 4);

    // Body BM25 with filters and a prefix, warm: under 4x 50 ms.
    const queries = [
      'quarterly zzy',
      'zzyzx tag:crew',
      'quarterly reconciliation path:inbox -tag:draft',
      'tag:topic',
      `${corpus[3]!.text.split(/\s+/)[12]!.replace(/[^\p{L}]/gu, '')} ka`,
    ];
    let worstBody = 0;
    for (const q of queries) {
      const t0 = performance.now();
      const hits = idx.search(q, { limit: 50 });
      worstBody = Math.max(worstBody, performance.now() - t0);
      expect(hits.length).toBeLessThanOrEqual(50);
    }
    expect(worstBody).toBeLessThan(50 * 4);
    expect(idx.search('quarterly zzy', {}).map((h) => h.path)).toEqual([agent.path]);
    expect(idx.search('tag:crew', {})[0]!.path).toBe(agent.path);
    expect(idx.expandPrefix('k').length).toBeLessThanOrEqual(PREFIX_EXPANSIONS);

    // No read, no core call, nothing rebuilt or resolved.
    expect(reads).toBe(readsBefore);
    expect(calls.n).toBe(callsBefore);
    expect(idx.counters).toEqual(counters);

    // A rename reads nothing and resolves only what it touches.
    const target = corpus[42]!;
    const back = idx.backlinks(target.path).length;
    const r0 = performance.now();
    idx.applyRename(target.path, 'Inbox/Renamed 42.md');
    idx.resolve();
    expect(performance.now() - r0).toBeLessThan(300);
    expect(reads).toBe(readsBefore);
    expect(idx.counters.entriesBuilt).toBe(counters.entriesBuilt);
    expect(idx.counters.sourcesResolved - counters.sourcesResolved).toBeLessThanOrEqual(back + 60);
  }, 60_000);
});
