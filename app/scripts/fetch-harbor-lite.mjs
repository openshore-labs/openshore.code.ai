// Fetch Harbor Lite's weights for the desktop build (founder, 2026-10-19: the
// desktop's first open is the phone's, so the guide ships inside the desktop
// app too). The one pinned source is HARBOR_MINI_MODEL_URL in
// src/lib/harborMini.ts, read here so it never drifts, the same way the iOS
// build step reads it (codemagic.yaml). The file lands in build/models, which
// electron-builder copies into the app's resources (package.json, build
// .extraResources), where electron/harborLite.ts finds it.
//
// A build without the weights fails rather than ship a guide that cannot
// answer. A file already there at full size is kept.
//
// Usage: node scripts/fetch-harbor-lite.mjs
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(appRoot, 'build', 'models', 'harbor-mini.gguf');
/** SmolLM2-135M at Q4_K_M is about 105 MB; anything far under that is an
 *  error page or a cut-off transfer, never the model. */
const MIN_BYTES = 50 * 1024 * 1024;

const source = readFileSync(join(appRoot, 'src', 'lib', 'harborMini.ts'), 'utf8');
const url = source.match(/https:\/\/huggingface\.co\/[^']*\.gguf/)?.[0];
if (!url) {
  console.error(
    'fetch-harbor-lite: no Harbor Lite URL in src/lib/harborMini.ts; refusing to build without it.',
  );
  process.exit(1);
}

if (existsSync(dest) && statSync(dest).size >= MIN_BYTES) {
  console.log(`fetch-harbor-lite: kept ${dest} (${statSync(dest).size} bytes)`);
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });
const partial = `${dest}.part`;
let lastError;
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
    const size = statSync(partial).size;
    if (size < MIN_BYTES) throw new Error(`only ${size} bytes`);
    renameSync(partial, dest);
    console.log(`fetch-harbor-lite: bundled ${size} bytes from ${url}`);
    process.exit(0);
  } catch (err) {
    lastError = err;
    rmSync(partial, { force: true });
    console.error(`fetch-harbor-lite: attempt ${attempt} failed: ${err.message}`);
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
  }
}
console.error(
  `fetch-harbor-lite: could not fetch Harbor Lite's weights (${lastError?.message}); refusing to build without them.`,
);
process.exit(1);
