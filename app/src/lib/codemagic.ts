// Codemagic REST client for the app (on-device). The two safety stages the CTO
// required before any build log is shown to a model (redact secrets, then
// extract just the error regions) now live in one shared place,
// 'os-code/protocol', so the engine's codemagic tool applies the identical
// guarantee. This file keeps only the I/O: the token is a BYO personal token
// held in this device's Keychain (secretGet), never in the bundle. It can
// trigger and read across the account, so we keep it on-device and only ever
// send REDACTED, TRUNCATED excerpts to a model, even the user's own cloud model.
//
// API surface (https://docs.codemagic.io/rest-api/):
//   POST /builds            {appId, workflowId, branch}  -> {buildId}
//   GET  /builds/{buildId}                               -> {build:{status, ...}}
//   POST /artifacts/:name/public-url                     -> {url}   (temp link)
// Full logs are not a clean endpoint; they arrive as published log artifacts
// (codemagic.yaml already publishes xcodebuild logs). We diagnose from those.
import { secretGet } from './platform.js';
import { nativeFetch } from './nativeFetch.js';
import {
  type BuildArtifact,
  type BuildInfo,
  logArtifacts,
  normalizeStatus,
  safeLogExcerpt,
} from 'os-code/protocol';

// Re-export the shared pure surface so existing app imports of these from this
// module keep working (store.ts, tests, types.ts's BuildStatus).
export {
  isTerminal,
  logArtifacts,
  redactLog,
  extractErrors,
  normalizeStatus,
  safeLogExcerpt,
} from 'os-code/protocol';
export type { BuildStatus, BuildArtifact, BuildInfo } from 'os-code/protocol';

export const CODEMAGIC_BASE = 'https://api.codemagic.io';
export const CODEMAGIC_SECRET_KEY = 'oscode.secret.codemagic';
/** Where a person creates the API token: Teams, then the personal account,
 *  then Integrations, then Codemagic API. Shown as an in-app link on Launch. */
export const CODEMAGIC_TOKEN_URL = 'https://codemagic.io/teams';

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
  return { status: normalizeStatus(data.build?.status), artefacts: data.build?.artefacts ?? [] };
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

/** One call: fetch a build's logs, redact, and extract a model-ready excerpt.
 *  The redact-then-extract guarantee lives in the shared safety module. */
export async function buildLogExcerpt(build: BuildInfo): Promise<string> {
  const logs = logArtifacts(build.artefacts);
  if (!logs.length) return 'No log artifacts were published for this build.';
  const texts: string[] = [];
  for (const a of logs.slice(0, 3)) {
    try {
      texts.push(safeLogExcerpt(await fetchLogText(a)));
    } catch {
      // Skip a log we cannot read; others may still help.
    }
  }
  return texts.filter(Boolean).join('\n\n---\n\n') || 'The published logs could not be read.';
}
