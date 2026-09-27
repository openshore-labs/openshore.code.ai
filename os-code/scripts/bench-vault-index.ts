// The Vault index bench, pure core (Vault M3 H3 "Budget and how it's
// measured", part a). Builds the seeded 5,000-note corpus into a VaultIndex
// three times and reports the median: the build (every note scanned, read for
// frontmatter, tokenized, and every link resolved), then serialize and load.
// Target on the reference box: the build in 5 s or less. CI asserts only the
// trip wire (under 20 s, test/vaultIndex.test.ts).
//
//   pnpm --filter os-code bench:vault-index [notes] [trials]
//
// It runs the real shared core when stream A's files are on the tree, and the
// test stand-in otherwise; the report says which, since only the shared-core
// number is the one to record.
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { VaultIndex, loadIndex, serializeIndex } from '../src/harness/vault/index.js';
import { vaultCorpus } from '../test/fixtures/vaultCorpus.js';
import { loadVaultIndexCore } from '../test/helpers/vaultIndexCore.js';

const notes = Number(process.argv[2] ?? 5000);
const trials = Number(process.argv[3] ?? 3);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

async function main(): Promise<void> {
  const { core, coreKind } = await loadVaultIndexCore();
  const corpus = vaultCorpus({ notes });
  const mb = corpus.reduce((n, c) => n + c.size, 0) / 1024 / 1024;
  const build: number[] = [];
  const longest: number[] = [];
  const save: number[] = [];
  const load: number[] = [];
  const backlinks: number[] = [];
  const search: number[] = [];
  let fileMb = 0;
  for (let t = 0; t < trials; t++) {
    const t0 = performance.now();
    const index = new VaultIndex(core);
    index.beginBuild();
    let worst = 0;
    for (const n of corpus) {
      const a = performance.now();
      index.applyWrite(n, n.text);
      worst = Math.max(worst, performance.now() - a);
    }
    index.resolve();
    index.endBuild();
    build.push(performance.now() - t0);
    longest.push(worst);

    const s0 = performance.now();
    const ser = serializeIndex(index);
    save.push(performance.now() - s0);
    fileMb = ser.bytes / 1024 / 1024;

    const l0 = performance.now();
    const loaded = loadIndex(ser.json, core).index;
    loaded.resolve();
    load.push(performance.now() - l0);

    const b0 = performance.now();
    for (let i = 0; i < 100; i++) loaded.backlinks(corpus[(i * 37) % corpus.length]!.path);
    backlinks.push((performance.now() - b0) / 100);

    const q0 = performance.now();
    loaded.search('kalo mine');
    search.push(performance.now() - q0);
  }
  const fmt = (n: number) => `${n.toFixed(1)} ms`;
  console.log(`vault index bench, pure core (${coreKind})`);
  console.log(
    `  machine: ${cpus()[0]?.model ?? 'unknown'} x${cpus().length}, node ${process.version}`,
  );
  console.log(`  corpus: ${corpus.length} notes, ${mb.toFixed(1)} MB; ${trials} trials, median`);
  console.log(`  build:            ${fmt(median(build))}  (trials ${build.map(fmt).join(', ')})`);
  console.log(`  longest applyWrite: ${fmt(median(longest))}`);
  console.log(`  serialize:        ${fmt(median(save))}  (${fileMb.toFixed(1)} MB)`);
  console.log(`  load + resolve:   ${fmt(median(load))}`);
  console.log(`  warm backlinks:   ${fmt(median(backlinks))} per note`);
  console.log(`  search:           ${fmt(median(search))}`);
}

void main();
