// The embedding index. Retrieval accuracy is core correctness on
// small-context local models: bad retrieval feeds the wrong context and
// causes the wrong edit. Chunks live under ~/.os-code/index/<repo-hash>/ and
// refresh incrementally by file mtime. With no embedder enabled, callers fall
// back to grep, which is a supported (degraded) mode, not an error.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { oscHome } from '../config/load.js';
import type { EmbeddingProvider } from '../providers/types.js';
import { walkFiles } from '../core/tools/walk.js';

interface Chunk {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
  vector: number[];
}

interface IndexMeta {
  model: string;
  files: Record<string, number>; // rel path -> mtimeMs at embed time
}

const CHUNK_LINES = 100;
const CHUNK_OVERLAP = 20;
const EMBED_BATCH = 16;
const MAX_FILE_BYTES = 250_000;

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|scala|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|html|css|scss|json|yaml|yml|toml|md|txt|vue|svelte)$/;

export class RepoIndex {
  private readonly dir: string;
  private chunks: Chunk[] = [];
  private meta: IndexMeta = { model: '', files: {} };
  private loaded = false;

  constructor(
    private readonly root: string,
    private readonly embedder: EmbeddingProvider,
    private readonly model: string,
  ) {
    const hash = createHash('sha1').update(root).digest('hex').slice(0, 16);
    this.dir = join(oscHome(), 'index', hash);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.meta = JSON.parse(readFileSync(join(this.dir, 'meta.json'), 'utf8'));
      const raw = readFileSync(join(this.dir, 'chunks.jsonl'), 'utf8');
      this.chunks = raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      this.meta = { model: this.model, files: {} };
      this.chunks = [];
    }
    if (this.meta.model !== this.model) {
      // Different embedder: start fresh, vectors are not comparable.
      this.meta = { model: this.model, files: {} };
      this.chunks = [];
    }
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'meta.json'), JSON.stringify(this.meta));
    writeFileSync(join(this.dir, 'chunks.jsonl'), this.chunks.map((c) => JSON.stringify(c)).join('\n'));
  }

  /** How stale the index is: files changed since last refresh. */
  staleFiles(): string[] {
    this.load();
    const stale: string[] = [];
    for (const rel of walkFiles(this.root)) {
      if (!TEXT_EXT.test(rel)) continue;
      try {
        const mtime = statSync(join(this.root, rel)).mtimeMs;
        if (this.meta.files[rel] !== mtime) stale.push(rel);
      } catch {}
    }
    return stale;
  }

  /** Incrementally (re)embed changed files. Returns how many were refreshed. */
  async refresh(onProgress?: (done: number, total: number) => void): Promise<number> {
    this.load();
    const stale = this.staleFiles();
    let done = 0;
    for (const rel of stale) {
      const full = join(this.root, rel);
      let text: string;
      let mtime: number;
      try {
        const stat = statSync(full);
        if (stat.size > MAX_FILE_BYTES) {
          done++;
          continue;
        }
        mtime = stat.mtimeMs;
        text = readFileSync(full, 'utf8');
        if (text.includes('\u0000')) {
          done++;
          continue;
        }
      } catch {
        done++;
        continue;
      }
      this.chunks = this.chunks.filter((c) => c.file !== rel);
      const pieces = chunkText(rel, text);
      for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
        const batch = pieces.slice(i, i + EMBED_BATCH);
        const vectors = await this.embedder.embed(this.model, batch.map((p) => p.text));
        batch.forEach((p, j) => {
          const vector = vectors[j];
          if (vector) this.chunks.push({ ...p, vector });
        });
      }
      this.meta.files[rel] = mtime;
      done++;
      onProgress?.(done, stale.length);
    }
    if (stale.length) this.save();
    return stale.length;
  }

  /** Cosine top-k retrieval, formatted for a model observation. */
  async search(query: string, k: number): Promise<string> {
    this.load();
    if (!this.chunks.length) {
      return '';
    }
    const [queryVector] = await this.embedder.embed(this.model, [query]);
    if (!queryVector) return '';
    const scored = this.chunks
      .map((c) => ({ c, score: cosine(queryVector, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return scored
      .map(({ c, score }) => `### ${c.file}:${c.startLine}-${c.endLine} (relevance ${score.toFixed(2)})\n${c.text}`)
      .join('\n\n');
  }

  get chunkCount(): number {
    this.load();
    return this.chunks.length;
  }

  get location(): string {
    return this.dir;
  }
}

function chunkText(file: string, text: string): Array<Omit<Chunk, 'vector'>> {
  const lines = text.split('\n');
  const chunks: Array<Omit<Chunk, 'vector'>> = [];
  for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
    const end = Math.min(lines.length, start + CHUNK_LINES);
    const body = lines.slice(start, end).join('\n').trim();
    if (body) {
      chunks.push({ file, startLine: start + 1, endLine: end, text: body.slice(0, 4000) });
    }
    if (end >= lines.length) break;
  }
  return chunks;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Keyword fallback when no embedder is enabled: grep-ranked snippets. */
export function keywordSearch(root: string, query: string, k: number): string {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
  if (!terms.length) return '';
  const scores = new Map<string, number>();
  for (const rel of walkFiles(root)) {
    if (!TEXT_EXT.test(rel)) continue;
    let text: string;
    try {
      if (statSync(join(root, rel)).size > MAX_FILE_BYTES) continue;
      text = readFileSync(join(root, rel), 'utf8').toLowerCase();
    } catch {
      continue;
    }
    let score = 0;
    for (const term of terms) {
      let idx = -1;
      let hits = 0;
      while ((idx = text.indexOf(term, idx + 1)) !== -1 && hits < 50) hits++;
      score += hits;
    }
    if (score > 0) scores.set(rel, score);
  }
  const top = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  return top.map(([rel, score]) => `${rel} (keyword score ${score})`).join('\n');
}
