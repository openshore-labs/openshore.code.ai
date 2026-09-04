// Codemagic build-log safety, shared by every surface that lets a model see a
// build. There are two stages and the order is load bearing: redact secrets
// first, then extract just the error regions. A model, even the person's own
// cloud model, only ever sees REDACTED, TRUNCATED excerpts of a build log.
//
// This module is pure (no Node built-ins, no I/O), so it rides the browser-safe
// 'os-code/protocol' barrel and is the one source of truth for both the engine
// tool (os-code) and the app-side Launch flow (app). No em dashes anywhere.

export type BuildStatus =
  'queued' | 'preparing' | 'building' | 'finished' | 'failed' | 'canceled' | 'timeout' | 'unknown';

export interface BuildArtifact {
  name: string;
  url?: string;
  type?: string;
}

export interface BuildInfo {
  status: BuildStatus;
  artefacts: BuildArtifact[];
}

const KNOWN_STATUSES: BuildStatus[] = [
  'queued',
  'preparing',
  'building',
  'finished',
  'failed',
  'canceled',
  'timeout',
];

const TERMINAL: BuildStatus[] = ['finished', 'failed', 'canceled', 'timeout'];

/** Whether a status is one a build stops at (nothing more will happen). */
export function isTerminal(status: BuildStatus): boolean {
  return TERMINAL.includes(status);
}

/** Normalize a raw status string from the API into the known vocabulary. */
export function normalizeStatus(raw: string | undefined): BuildStatus {
  const lower = (raw ?? 'unknown').toLowerCase();
  return (KNOWN_STATUSES as string[]).includes(lower) ? (lower as BuildStatus) : 'unknown';
}

/** Pick the artifacts that look like build logs. */
export function logArtifacts(artefacts: BuildArtifact[]): BuildArtifact[] {
  return artefacts.filter((a) => /\.log$|log|xcodebuild|gradle/i.test(`${a.name} ${a.type ?? ''}`));
}

// ---------------------------------------------------------------------------
// Safety stage 1: redaction. Always run before showing a log anywhere.
// ---------------------------------------------------------------------------

const REDACTIONS: Array<[RegExp, string]> = [
  // PEM private keys / certificates.
  [/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[redacted key block]'],
  // JWTs.
  [/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[redacted token]'],
  // Authorization / auth-token headers, incl. an optional Bearer prefix and its
  // token, so the token is consumed rather than left dangling after "Bearer".
  [/(authorization|x-auth-token)\s*[:=]\s*(?:bearer\s+)?\S+/gi, '$1: [redacted]'],
  // A standalone bearer token anywhere else.
  [/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  // Named secrets: FOO_KEY=..., API_TOKEN: ..., PASSWORD=..., SECRET=...
  [
    /([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CERTIFICATE)[A-Z0-9_]*)\s*[:=]\s*\S+/gi,
    '$1=[redacted]',
  ],
  // Provisioning-profile / cert UUIDs.
  [
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    '[redacted uuid]',
  ],
  // Long opaque base64 / base64url blobs (40+ chars).
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted blob]'],
];

/** Strip secrets from a build log. Always run before showing a log anywhere. */
export function redactLog(text: string): string {
  let out = text;
  for (const [re, sub] of REDACTIONS) out = out.replace(re, sub);
  return out;
}

// ---------------------------------------------------------------------------
// Safety stage 2: extraction. Never run on unredacted text.
// ---------------------------------------------------------------------------

const SIGNAL =
  /error[: ]|BUILD FAILED|FAILURE|Code Sign|provisioning|fastlane|altool|xcodebuild|❌|Exit code [1-9]|fatal/i;

/**
 * Pull just the interesting regions out of a (already redacted) log: windows
 * around each error signal, plus the tail, capped so a model sees the failure
 * and not megabytes. Returns a compact excerpt.
 */
export function extractErrors(
  redacted: string,
  opts?: { window?: number; maxChars?: number },
): string {
  const window = opts?.window ?? 6;
  const maxChars = opts?.maxChars ?? 6000;
  const lines = redacted.split('\n');
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (!SIGNAL.test(line)) return;
    for (let j = Math.max(0, i - window); j <= Math.min(lines.length - 1, i + window); j++) {
      keep.add(j);
    }
  });
  // Always include the tail, where the final failure usually prints.
  for (let j = Math.max(0, lines.length - 12); j < lines.length; j++) keep.add(j);

  const ordered = [...keep].sort((a, b) => a - b);
  const out: string[] = [];
  let prev = -2;
  for (const idx of ordered) {
    if (idx !== prev + 1 && out.length) out.push('  ...');
    out.push(lines[idx]!);
    prev = idx;
  }
  let excerpt = out.join('\n').trim();
  if (!excerpt) excerpt = lines.slice(-40).join('\n').trim(); // no signal: show the tail
  if (excerpt.length > maxChars) excerpt = `...\n${excerpt.slice(excerpt.length - maxChars)}`;
  return excerpt;
}

/** One call over an already-fetched log text: redact, then extract. The caller
 *  owns fetching (the app uses nativeFetch + the Keychain token; the engine
 *  tool uses its injected token), but the safety guarantee lives here. */
export function safeLogExcerpt(rawLog: string): string {
  return extractErrors(redactLog(rawLog));
}
