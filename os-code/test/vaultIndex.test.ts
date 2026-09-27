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
