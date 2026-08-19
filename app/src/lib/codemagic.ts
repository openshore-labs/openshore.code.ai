// Codemagic REST client, plus the two safety stages the CTO required before any
// build log is shown to a model: redact secrets, then extract just the error
// regions. The token is a BYO personal token held in this device's Keychain
// (secretGet), never in the bundle. It can trigger and read across the account,
// so we keep it on-device and only ever send REDACTED, TRUNCATED excerpts to a
// model, even the user's own cloud model.
//
// API surface (https://docs.codemagic.io/rest-api/):
//   POST /builds            {appId, workflowId, branch}  -> {buildId}
//   GET  /builds/{buildId}                               -> {build:{status, ...}}
//   POST /artifacts/:name/public-url                     -> {url}   (temp link)
// Full logs are not a clean endpoint; they arrive as published log artifacts
// (codemagic.yaml already publishes xcodebuild logs). We diagnose from those.
import { secretGet } from './platform.js';
import { nativeFetch } from './nativeFetch.js';

export const CODEMAGIC_BASE = 'https://api.codemagic.io';
export const CODEMAGIC_SECRET_KEY = 'oscode.secret.codemagic';

export type BuildStatus =
  | 'queued'
  | 'preparing'
  | 'building'
  | 'finished'
  | 'failed'
  | 'canceled'
  | 'timeout'
  | 'unknown';

export interface BuildArtifact {
  name: string;
  url?: string;
  type?: string;
}

export interface BuildInfo {
  status: BuildStatus;
  artefacts: BuildArtifact[];
}

const TERMINAL: BuildStatus[] = ['finished', 'failed', 'canceled', 'timeout'];
export function isTerminal(status: BuildStatus): boolean {
  return TERMINAL.includes(status);
}

async function token(): Promise<string | null> {
  return secretGet(CODEMAGIC_SECRET_KEY);
}

function headers(key: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-auth-token': key };
}

/** Kick off a build. Returns the new buildId. */
export async function triggerBuild(input: {
  appId: string;
  workflowId: string;
  branch: string;
}): Promise<string> {
  const key = await token();
  if (!key) throw new Error('Connect Codemagic first (add your API token).');
  const res = await nativeFetch(`${CODEMAGIC_BASE}/builds`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Codemagic could not start the build (${res.status}).`);
  const data = (await res.json()) as { buildId?: string };
  if (!data.buildId) throw new Error('Codemagic did not return a build id.');
  return data.buildId;
}

/** Read a build's current status and its artifacts (logs included). */
export async function getBuild(buildId: string): Promise<BuildInfo> {
  const key = await token();
  if (!key) throw new Error('Connect Codemagic first (add your API token).');
  const res = await nativeFetch(`${CODEMAGIC_BASE}/builds/${buildId}`, { headers: headers(key) });
  if (!res.ok) throw new Error(`Codemagic build lookup failed (${res.status}).`);
  const data = (await res.json()) as { build?: { status?: string; artefacts?: BuildArtifact[] } };
  const raw = (data.build?.status ?? 'unknown').toLowerCase();
  const known: string[] = [
    'queued',
    'preparing',
    'building',
    'finished',
    'failed',
    'canceled',
    'timeout',
  ];
  const status: BuildStatus = known.includes(raw) ? (raw as BuildStatus) : 'unknown';
  return { status, artefacts: data.build?.artefacts ?? [] };
}

/** Fetch a log artifact's text (best-effort), asking for a temp URL if needed. */
export async function fetchLogText(artifact: BuildArtifact): Promise<string> {
  const key = await token();
  if (!key) throw new Error('Connect Codemagic first (add your API token).');
  let url = artifact.url;
  // A bare secureFilename (not an http URL) needs a minted temporary URL.
  if (url && !/^https?:/.test(url)) {
    const res = await nativeFetch(
      `${CODEMAGIC_BASE}/artifacts/${encodeURIComponent(url)}/public-url`,
      { method: 'POST', headers: headers(key) },
    );
    if (res.ok) url = ((await res.json()) as { url?: string }).url;
  }
  if (!url) throw new Error('That log has no reachable URL.');
  // Send the token: an api.codemagic.io artifact URL requires it (else 401), and
  // a temporary signed URL simply ignores it.
  const res = await nativeFetch(url, { responseType: 'text', headers: { 'x-auth-token': key } });
  if (!res.ok) throw new Error(`Could not download the log (${res.status}).`);
  return res.text();
}

/** Pick the artifacts that look like build logs. */
export function logArtifacts(artefacts: BuildArtifact[]): BuildArtifact[] {
  return artefacts.filter((a) => /\.log$|log|xcodebuild|gradle/i.test(`${a.name} ${a.type ?? ''}`));
}

// ---------------------------------------------------------------------------
// Safety stages. Redact first, then extract. Order matters: never extract from
// unredacted text.
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
  [/([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CERTIFICATE)[A-Z0-9_]*)\s*[:=]\s*\S+/gi, '$1=[redacted]'],
  // Provisioning-profile / cert UUIDs.
  [/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '[redacted uuid]'],
  // Long opaque base64 / base64url blobs (40+ chars).
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted blob]'],
];

/** Strip secrets from a build log. Always run before showing a log anywhere. */
export function redactLog(text: string): string {
  let out = text;
  for (const [re, sub] of REDACTIONS) out = out.replace(re, sub);
  return out;
}

const SIGNAL = /error[: ]|BUILD FAILED|FAILURE|Code Sign|provisioning|fastlane|altool|xcodebuild|❌|Exit code [1-9]|fatal/i;

/**
 * Pull just the interesting regions out of a (already redacted) log: windows
 * around each error signal, plus the tail, capped so a model sees the failure
 * and not megabytes. Returns a compact excerpt.
 */
export function extractErrors(redacted: string, opts?: { window?: number; maxChars?: number }): string {
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

/** One call: fetch a build's logs, redact, and extract a model-ready excerpt. */
export async function buildLogExcerpt(build: BuildInfo): Promise<string> {
  const logs = logArtifacts(build.artefacts);
  if (!logs.length) return 'No log artifacts were published for this build.';
  const texts: string[] = [];
  for (const a of logs.slice(0, 3)) {
    try {
      texts.push(extractErrors(redactLog(await fetchLogText(a))));
    } catch {
      // Skip a log we cannot read; others may still help.
    }
  }
  return texts.filter(Boolean).join('\n\n---\n\n') || 'The published logs could not be read.';
}
