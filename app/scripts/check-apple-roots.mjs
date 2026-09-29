// Release check for the Apple receipt path (next build E0, finding 11). The
// backend verifies every App Store receipt against Apple's root certificates
// in supabase/functions/_shared/apple.ts, and the repo ships them as
// PASTE_REAL_BASE64_DER_HERE_ placeholders. With a placeholder, a real
// purchase charges the buyer and the unlock is refused, so an iOS build that
// can sell must not ship while the load-bearing root (AppleRootCA-G3) is
// still one.
//
// A build "can sell" when app/src/state/store.ts has PAY_GATES_ENABLED = true,
// or when the pipeline says so with OPENSHORE_STORE_RELEASE=1. Anything else
// (every TestFlight build while the gates are off) gets a warning, not a
// failure, so ordinary CI and the founder's push-to-TestFlight stay green.
// The roots may live in the function secrets instead of the file
// (APPLE_ROOT_CA_G3_DER_BASE64); a build machine cannot see those, so
// APPLE_ROOTS_IN_SECRETS=1 says they are set there.
//
// Codemagic's ios-testflight workflow runs this before it builds. Run it by
// hand with: node app/scripts/check-apple-roots.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const APPLE_TS = resolve(REPO, 'supabase', 'functions', '_shared', 'apple.ts');
export const STORE_TS = resolve(REPO, 'app', 'src', 'state', 'store.ts');

const SENTINEL = 'PASTE_REAL_BASE64_DER_HERE_';
const ROOTS = [
  'APPLE_ROOT_CA_G3_DER_BASE64',
  'APPLE_ROOT_CA_G2_DER_BASE64',
  'APPLE_ROOT_INC_DER_BASE64',
  'APPLE_ROOT_COMPUTER_DER_BASE64',
];

/** Which root constants in apple.ts are still the placeholder. */
export function placeholderRoots(appleSource) {
  const left = [];
  for (const name of ROOTS) {
    const m = appleSource.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
    // A constant that is gone or still built from the sentinel is not a root.
    if (!m || /\bPASTE\b/.test(m[1]) || m[1].includes(SENTINEL)) left.push(name);
  }
  return left;
}

/** Whether this build can take money: the pay gates are on in the store, or
 *  the pipeline marks it a store release. */
export function buildCanSell(storeSource, env) {
  if (env.OPENSHORE_STORE_RELEASE === '1') return true;
  return /export const PAY_GATES_ENABLED = true\b/.test(storeSource);
}

/** The verdict: 'ok', 'warn' (placeholders, but nothing can be bought yet),
 *  or 'fail'. */
export function appleRootsVerdict(appleSource, storeSource, env) {
  const left = placeholderRoots(appleSource);
  if (!left.includes('APPLE_ROOT_CA_G3_DER_BASE64')) return { verdict: 'ok', left };
  if (env.APPLE_ROOTS_IN_SECRETS === '1') return { verdict: 'ok', left };
  return { verdict: buildCanSell(storeSource, env) ? 'fail' : 'warn', left };
}

function main() {
  const { verdict, left } = appleRootsVerdict(
    readFileSync(APPLE_TS, 'utf8'),
    readFileSync(STORE_TS, 'utf8'),
    process.env,
  );
  if (verdict === 'ok') {
    console.log('Apple receipt roots: AppleRootCA-G3 is configured.');
    return;
  }
  const lines = [
    `Apple receipt roots: still placeholders in supabase/functions/_shared/apple.ts: ${left.join(', ')}.`,
    'A real purchase would charge the buyer and stay locked. Paste the base64 DER from',
    'https://www.apple.com/certificateauthority/ (AppleRootCA-G3 at least), or set the',
    'APPLE_ROOT_CA_G3_DER_BASE64 function secret and APPLE_ROOTS_IN_SECRETS=1 here.',
  ];
  if (verdict === 'warn') {
    console.warn(
      ['Warning (pay gates are off, so nothing can be bought yet):', ...lines].join('\n'),
    );
    return;
  }
  console.error(['This build can sell Personal, so it stops here.', ...lines].join('\n'));
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
