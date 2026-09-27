// The seeded Vault corpus the index bench and the index tests build (Vault M3
// H3 "Budget and how it's measured"): 5,000 notes by default, about 450 words
// each, 4 links and 2 tags per note, 10% with a code fence, 30% with
// frontmatter. Same seed, same bytes, on every machine, so a bench number on
// the reference box and one in CI measure the same vault.
//
// Every note links to 4 others: mostly bare `[[Title]]`, some folder-qualified
// `[[Folder/Title]]`, some with an alias or a heading, one in 20 a markdown
// link, and one in 25 to a note that does not exist (an unresolved link). A
// note with a fence also carries a `[[...]]` inside it, which the index must
// not count. Pure data, no I/O.

export interface CorpusNote {
  path: string;
  text: string;
  updatedAt: string;
  size: number;
  version: string;
}

export interface CorpusOptions {
  notes?: number;
  seed?: number;
  wordsPerNote?: number;
}

/** mulberry32: small, fast, and the same everywhere. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMMON = (
  'the of and to in is it that for on with as was at by this be from or an are not ' +
  'but have has will were its had'
).split(' ');

const SYLLABLES =
  'ka lo mi ne ra su ti vo ze ba ce do fu ga hi ja ku le mo nu pa qui ro sa te ul ve wy xa yo'.split(
    ' ',
  );

const FOLDERS = [
  'Projects',
  'Projects/Alpha',
  'Projects/Beta',
  'Areas',
  'Areas/Health',
  'Areas/Money',
  'Resources',
  'Resources/Books',
  'Resources/Papers',
  'Journal',
  'Journal/2025',
  'Journal/2026',
  'Meetings',
  'People',
  'Ideas',
  'Archive',
  'Archive/Old',
  'Inbox',
  'Reference',
  'Drafts',
];

/** A deterministic vocabulary of made-up words, a Zipf-ish draw over it. */
function vocabulary(rand: () => number, size: number): string[] {
  const words = new Set<string>();
  while (words.size < size) {
    const n = 2 + Math.floor(rand() * 3);
    let w = '';
    for (let i = 0; i < n; i++) w += SYLLABLES[Math.floor(rand() * SYLLABLES.length)];
    words.add(w);
  }
  return [...words];
}

export function vaultCorpus(opts: CorpusOptions = {}): CorpusNote[] {
  const count = opts.notes ?? 5000;
  const wordsPerNote = opts.wordsPerNote ?? 450;
  const rand = rng(opts.seed ?? 20260927);
  const vocab = vocabulary(rand, 4000);
  const word = (): string => {
    // One word in four is a common English word; the rest skew to the head
    // of the vocabulary, the way real notes reuse their words.
    if (rand() < 0.25) return COMMON[Math.floor(rand() * COMMON.length)]!;
    const r = rand();
    return vocab[Math.floor(r * r * vocab.length)]!;
  };
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

  const notes: Array<{ folder: string; title: string }> = [];
  for (let i = 0; i < count; i++) {
    const folder = FOLDERS[Math.floor(rand() * FOLDERS.length)]!;
    notes.push({ folder, title: `${cap(vocab[i % vocab.length]!)} ${cap(word())} ${i}` });
  }
  const tagPool = Array.from({ length: 60 }, (_, i) => `topic/${vocab[i * 7]!}`);

  const out: CorpusNote[] = [];
  const epoch = Date.UTC(2026, 0, 1);
  for (let i = 0; i < count; i++) {
    const me = notes[i]!;
    const lines: string[] = [];
    const tags = [tagPool[Math.floor(rand() * tagPool.length)]!, tagPool[(i * 13) % 60]!];
    if (rand() < 0.3) {
      lines.push('---');
      lines.push(`created: 2026-01-${String(1 + (i % 28)).padStart(2, '0')}`);
      lines.push(`aliases: [${cap(word())} ${cap(word())}]`);
      lines.push('tags:');
      lines.push(`  - ${tags[0]}`);
      lines.push('status: draft');
      lines.push('---');
      tags.shift();
    }
    lines.push(`# ${me.title}`, '');

    const links: string[] = [];
    for (let k = 0; k < 4; k++) {
      const j = Math.floor(rand() * count);
      const other = notes[j === i ? (j + 1) % count : j]!;
      const roll = rand();
      if (roll < 0.04) links.push(`[[Missing ${word()} ${i}-${k}]]`);
      else if (roll < 0.09) {
        const href = `/${other.folder}/${other.title}.md`.slice(1);
        links.push(`[${other.title}](${encodeURI(relativeHref(me.folder, href))})`);
      } else if (roll < 0.25) links.push(`[[${other.folder}/${other.title}]]`);
      else if (roll < 0.35) links.push(`[[${other.title}|${word()}]]`);
      else if (roll < 0.42) links.push(`[[${other.title}#${cap(word())}]]`);
      else links.push(`[[${other.title}]]`);
    }

    const paragraphs = 6;
    const perPara = Math.floor(wordsPerNote / paragraphs);
    for (let p = 0; p < paragraphs; p++) {
      if (p === 2) lines.push(`## ${cap(word())} ${word()}`, '');
      const ws: string[] = [];
      for (let w = 0; w < perPara; w++) ws.push(word());
      if (p < 4) ws.splice(Math.floor(rand() * ws.length), 0, links[p]!);
      if (p === 5) ws.push(`#${tags[tags.length - 1]}`);
      lines.push(`${cap(ws.join(' '))}.`, '');
      if (p === 3 && i % 10 === 0) {
        lines.push('```ts', `const ${word()} = "[[Not A Link ${i}]]";`, '```', '');
      }
    }
    const text = lines.join('\n');
    const updatedAt = new Date(epoch + i * 60_000).toISOString();
    out.push({
      path: `${me.folder}/${me.title}.md`,
      text,
      updatedAt,
      size: utf8Length(text),
      version: `v${i}-${text.length}`,
    });
  }
  return out;
}

function relativeHref(fromFolder: string, to: string): string {
  const from = fromFolder.split('/');
  const target = to.split('/');
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) {
    common++;
  }
  const up = from.length - common;
  return [...Array(up).fill('..'), ...target.slice(common)].join('/');
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}
