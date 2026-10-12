// The phone's line to the desktop: the daemon's HTTP + SSE surface over the
// tailnet. Every event is journaled on the desktop and replayable from any
// sequence number, so a subway tunnel costs nothing; this driver reconnects
// with backoff and resumes from the last sequence it saw.
import type {
  ApprovalAnswer,
  CurrentsHandles,
  DaemonKeysList,
  DaemonPlaceOrchestratorAnswer,
  DaemonPlaceOrchestratorBody,
  DaemonProviderKey,
  DaemonPutKeyAnswer,
  DaemonPutKeyBody,
  DaemonRemoveKeysAnswer,
  DaemonSessionInfo,
  DriverEvent,
  HarnessCurrentsHandle,
  OfflineReason,
  PermissionMode,
  SessionCreateVaultFields,
  VaultOverrides,
} from 'os-code/protocol';
import { HANDOFF_MAX_BYTES } from 'os-code/protocol';
import {
  dockKindOf,
  dockedNoun,
  machineFactsOf,
  type DockKind,
  type DockPlace,
  type MachineFacts,
} from '../lib/docking.js';
import { isNotePath } from '../lib/gitos/providers.js';
import { PROJECT_VAULT_PINS_MAX } from '../state/types.js';
import type {
  ChatDriver,
  DriverEventSink,
  HubLinkState,
  HubRole,
  RunCommandResult,
  TerminalExit,
  TerminalOpen,
  TerminalWrite,
} from './types.js';
import { HUB_NO_ANSWER, PackLocalOnlyMarker } from './types.js';
import { streamingFetch } from '../lib/streamingFetch.js';
import { thisDeviceNoun } from '../lib/deviceNoun.js';
import { computerOfflineOf } from '../state/offlineOps.js';

export { HUB_NO_ANSWER };
export type { HubLinkState };

/** How long a dropped stream may keep failing to reattach before the link
 *  reads "off or away" rather than "reconnecting". */
export const AWAY_AFTER_MS = 5000;

/** Base64 -> raw bytes, for a terminal stream frame. atob exists in the WebView
 *  and every browser build target. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Raw text -> base64, for terminal stdin (keystrokes). Handles multi-byte
 *  characters by encoding utf8 first. */
function textToB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface DaemonTarget {
  /** e.g. http://100.101.1.2:4816 (the desktop's tailnet address). */
  baseUrl: string;
  token: string;
  /** A friendly name for the hub, shown when more than one is saved. Optional;
   *  the tailnet host stands in when it is absent. */
  name?: string;
  /** What it is, as its /health said when it docked (lib/docking.ts): a
   *  server or the desktop app. Absent on an older daemon. */
  kind?: DockKind;
  /** Where a server lives, as the person said when docking it: at home or
   *  rented (lib/docking.ts). Kept on this device; a server cannot tell. */
  place?: DockPlace;
  /** Its size, as its /health last said (memory, cores, processor family).
   *  Absent from an older daemon. */
  machine?: MachineFacts;
}

function headers(target: DaemonTarget): Record<string, string> {
  return { authorization: `Bearer ${target.token}` };
}

export interface DaemonInstallProgress {
  line: string;
  percent?: number;
  completed?: number;
  total?: number;
  done: boolean;
  ok?: boolean;
  detail?: string;
}

/** Start a model install on the paired desktop (MP-F2). Output is polled. */
export async function daemonInstallModel(target: DaemonTarget, modelId: string): Promise<void> {
  const res = await fetch(`${target.baseUrl}/models/install`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify({ modelId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Your computer answered ${res.status}.`);
  }
}

/** Poll a desktop install's progress; undefined once it is no longer tracked. */
export async function daemonInstallProgress(
  target: DaemonTarget,
  modelId: string,
): Promise<DaemonInstallProgress | undefined> {
  const res = await fetch(
    `${target.baseUrl}/models/install/${encodeURIComponent(modelId)}/progress`,
    { headers: headers(target), signal: AbortSignal.timeout(10_000) },
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Your computer answered ${res.status}.`);
  return (await res.json()) as DaemonInstallProgress;
}

/** What the hub says this device's token may do. Absent on a daemon that
 *  predates roles, which the app treats as "nothing hidden". */
function roleOf(body: unknown): HubRole | undefined {
  const role = (body as { role?: unknown } | null)?.role;
  return role === 'admin' || role === 'member' ? role : undefined;
}

export async function daemonHealth(target: DaemonTarget): Promise<{
  ok: boolean;
  detail: string;
  role?: HubRole;
  offline?: OfflineReason;
  kind?: DockKind;
  /** It keeps provider keys for its sessions (GET /keys): a server, never
   *  the desktop app. Absent from an older daemon. */
  keysOnServer?: true;
  /** Its size (memory, cores, processor family). Absent from an older
   *  daemon. */
  machine?: MachineFacts;
}> {
  try {
    const res = await fetch(`${target.baseUrl}/health`, {
      headers: headers(target),
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 401) {
      // The daemon's own error names the specific cause (a stale claim, a
      // revoked device, a wrong token) when it can; only fall back to the
      // generic line if that body did not come through.
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return {
        ok: false,
        detail:
          typeof body.error === 'string'
            ? body.error
            : 'Your computer rejected the pairing token. Copy it again from OpenShore on your computer.',
      };
    }
    if (!res.ok) return { ok: false, detail: `Your computer answered ${res.status}.` };
    const body: unknown = await res.json().catch(() => ({}));
    const role = roleOf(body);
    // Desktop Offline: the computer says when it works offline, and why.
    const offline = computerOfflineOf(body);
    // What it is, a server or the desktop app (connect-anywhere, 2026-10-07).
    const kind = dockKindOf(body);
    // Keys on your server (2026-10-09): only a server says it keeps them.
    const keysOnServer = (body as { keysOnServer?: unknown } | null)?.keysOnServer === true;
    // Its size, so several docked machines read apart (2026-10-12).
    const machine = machineFactsOf(body);
    return {
      ok: true,
      detail: kind === 'server' ? 'Docked to your server.' : 'Connected to your computer.',
      ...(role ? { role } : {}),
      ...(offline ? { offline } : {}),
      ...(kind ? { kind } : {}),
      ...(keysOnServer ? { keysOnServer: true as const } : {}),
      ...(machine ? { machine } : {}),
    };
  } catch {
    // A rejected credential answers 401 with no CORS headers (DAE-15), which a
    // WebView reports as a failed fetch, the same as an unreachable hub. Tell
    // the two apart with the one route that needs no credential: an empty
    // pairing claim is refused with a readable 400 (with CORS) and redeems
    // nothing, so any answer at all means the computer is there and it is this
    // device's pairing that was turned down.
    return (await hubAnswers(target.baseUrl))
      ? { ok: false, detail: PAIRING_REJECTED }
      : { ok: false, detail: HUB_UNREACHABLE };
  }
}

/** The computer answered, but not to this device's credential. */
export const PAIRING_REJECTED =
  'Your computer answered, but it no longer accepts this device. The pairing was revoked or has expired. Dock again from Computer.';

/** Nothing answered at the computer's address. */
export const HUB_UNREACHABLE =
  "Can't reach your computer. Check that it is awake with OpenShore open, and that Tailscale is on for both devices.";

/** Whether anything at this address answers as an OpenShore daemon, using the
 *  credential-free pairing route with an empty claim (a 400, never a redeem). */
async function hubAnswers(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(4000),
    });
    return res.status === 400;
  } catch {
    return false;
  }
}

/** This phone forgetting its computer: ask the computer to revoke this
 *  device's own credential (DELETE /pair/self), so its Paired devices list
 *  never keeps a row nothing uses (CX 2026-10-01). Best effort: a computer
 *  that is off or away keeps the row until it is revoked there. */
export async function daemonForgetSelf(target: DaemonTarget): Promise<boolean> {
  try {
    const res = await fetch(`${target.baseUrl}/pair/self`, {
      method: 'DELETE',
      headers: headers(target),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Trade a one-time pairing claim (from the desktop QR) for this device's own
 *  credential. No bearer is sent: the claim is the proof, spent on first use,
 *  so a photographed QR is worthless a moment later and every phone ends up
 *  with a token it alone holds. Returns the minted token on success. */
export async function redeemPairClaim(
  baseUrl: string,
  claim: string,
  deviceName?: string,
  opts: {
    /** The computer is asking the person to allow this device: show the code. */
    onPending?: (code: string) => void;
    /** How often to ask whether the computer answered (tests shorten it). */
    pollMs?: number;
    /** How long to wait for an answer before giving up. */
    waitMs?: number;
  } = {},
): Promise<{ ok: true; token: string; role?: HubRole } | { ok: false; detail: string }> {
  try {
    let res = await fetch(`${baseUrl}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim, deviceName }),
      signal: AbortSignal.timeout(6000),
    });
    let body = (await res.json().catch(() => ({}))) as {
      token?: unknown;
      role?: unknown;
      error?: unknown;
      request?: unknown;
      secret?: unknown;
      code?: unknown;
    };
    // The computer asks the person first (CTO security review 2026-10-01,
    // F3): the phone shows the same short code and asks until it answers.
    if (res.status === 202 && typeof body.request === 'string' && typeof body.secret === 'string') {
      const pending = { request: body.request, secret: body.secret };
      opts.onPending?.(typeof body.code === 'string' ? body.code : '');
      const until = Date.now() + (opts.waitMs ?? 130_000);
      while (res.status === 202 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 1500));
        res = await fetch(`${baseUrl}/pair/request`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(pending),
          signal: AbortSignal.timeout(6000),
        });
        body = (await res.json().catch(() => ({}))) as typeof body;
      }
      if (res.status === 202) {
        return {
          ok: false,
          detail: 'Nobody allowed this device on your computer in time. Scan the code again.',
        };
      }
    }
    if (res.ok && typeof body.token === 'string') {
      const role = roleOf(body);
      return { ok: true, token: body.token, ...(role ? { role } : {}) };
    }
    const detail =
      typeof body.error === 'string'
        ? body.error
        : `Your computer answered ${res.status} to the pairing code.`;
    return { ok: false, detail };
  } catch {
    return {
      ok: false,
      detail:
        'Could not reach your computer to redeem the pairing code. Check that Tailscale is on for both devices and OpenShore is open on your computer, then scan the QR again.',
    };
  }
}

/** The longest prefix of `text` that fits `maxBytes` of UTF-8, cut on a
 *  code point, never inside one. */
export function capUtf8(text: string, maxBytes: number): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return text;
  let bytes = 0;
  let out = '';
  for (const ch of text) {
    const n = enc.encode(ch).length;
    if (bytes + n > maxBytes) break;
    bytes += n;
    out += ch;
  }
  return out;
}

export async function daemonCreateSession(
  target: DaemonTarget,
  cwd?: string,
  opts: {
    instructions?: string;
    /** The project's name, so the engine files the project's memory notes in
     *  the same "OpenShore Project <name> MDs/" folder a desktop session does
     *  (without it the folder falls back to the workspace's basename). */
    projectName?: string;
    permissionMode?: PermissionMode;
    humanize?: boolean;
    /** Chain of Thought for this session (off unless true). */
    chainOfThought?: boolean;
    /** False until the person allows web search on this device. */
    webSearch?: boolean;
    /** The Wayfinding Memory switch (memoryOverride): false turns project
     *  memory off for this session. Only false goes on the wire, never true,
     *  so a project's own config stays in charge while the switch is on. */
    memory?: boolean;
    /** The Agentic Current that is on, as the handle its engine tool needs. */
    currents?: CurrentsHandles;
    /** The Harness Current that is on (Jev), as its per-session handle. */
    harnessCurrents?: HarnessCurrentsHandle;
    /** A model switch's handoff (Vault M5, CTO J12), prepended to the first
     *  task's preamble only. Cut to `HANDOFF_MAX_BYTES` of UTF-8 before it
     *  goes on the wire, so the daemon never refuses the create over it. */
    handoff?: string;
    /** The project's own pins (`Project.vaultPins`, CTO J14): note paths in
     *  the person's vault, at most `PROJECT_VAULT_PINS_MAX`. Only paths that
     *  name a note go on the wire. */
    vaultPins?: string[];
    /** The app's vault switches (Vault M7, CTO L13): off-only for context and
     *  the handoff, lower-only for the pack size. The daemon parses each
     *  value and drops anything else. */
    vaultOverrides?: VaultOverrides;
  } = {},
): Promise<string> {
  const handoff = opts.handoff ? capUtf8(opts.handoff, HANDOFF_MAX_BYTES) : '';
  const vaultPins = (opts.vaultPins ?? [])
    .filter((p) => typeof p === 'string' && isNotePath(p))
    .slice(0, PROJECT_VAULT_PINS_MAX);
  const res = await fetch(`${target.baseUrl}/sessions`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(cwd ? { cwd } : {}),
      ...(opts.instructions ? { instructions: opts.instructions } : {}),
      ...(opts.projectName ? { projectName: opts.projectName } : {}),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(typeof opts.humanize === 'boolean' ? { humanize: opts.humanize } : {}),
      ...(typeof opts.chainOfThought === 'boolean' ? { chainOfThought: opts.chainOfThought } : {}),
      ...(opts.memory === false ? { memory: false } : {}),
      ...(opts.webSearch === false ? { webSearch: false } : {}),
      ...(opts.currents ? { currents: opts.currents } : {}),
      ...(opts.harnessCurrents ? { harnessCurrents: opts.harnessCurrents } : {}),
      ...(handoff ? { handoff } : {}),
      ...(vaultPins.length ? { vaultPins } : {}),
      ...(opts.vaultOverrides && Object.keys(opts.vaultOverrides).length
        ? { vaultOverrides: opts.vaultOverrides }
        : {}),
    } satisfies SessionCreateVaultFields & Record<string, unknown>),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? `Your computer answered ${res.status}.`);
  return body.id;
}

/** Forget every handoff the computer keeps (Clear conversations, CTO J13).
 *  Owner only on the hub; an older hub without the route answers 404, which
 *  is nothing to clear. Resolves false when the computer did not do it. */
export async function daemonClearHandoffs(target: DaemonTarget): Promise<boolean> {
  try {
    const res = await fetch(`${target.baseUrl}/handoffs`, {
      method: 'DELETE',
      headers: headers(target),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export async function daemonListSessions(target: DaemonTarget): Promise<DaemonSessionInfo[]> {
  const res = await fetch(`${target.baseUrl}/sessions`, {
    headers: headers(target),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Your computer answered ${res.status}.`);
  const body = (await res.json()) as {
    live: Array<{ id: string; cwd: string; busy: boolean }>;
    stored: Array<{ id: string; cwd: string; title: string; updatedAt: string }>;
  };
  const seen = new Set<string>();
  const rows: DaemonSessionInfo[] = [];
  for (const s of body.live) {
    seen.add(s.id);
    rows.push({ id: s.id, cwd: s.cwd, busy: s.busy });
  }
  for (const s of body.stored) {
    if (!seen.has(s.id))
      rows.push({ id: s.id, cwd: s.cwd, title: s.title, updatedAt: s.updatedAt });
  }
  return rows;
}

export async function daemonWorkspaces(target: DaemonTarget) {
  const res = await fetch(`${target.baseUrl}/workspaces`, {
    headers: headers(target),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Your computer answered ${res.status}.`);
  return (
    (await res.json()) as {
      workspaces: Array<{ cwd: string; name: string; remote?: string }>;
    }
  ).workspaces;
}

/** Clone onto the paired computer. `token` is this phone's connected-platform
 *  token for a private repository: the computer uses it for this one clone,
 *  scoped to the platform's host, and never stores it. */
export async function daemonCloneRepo(target: DaemonTarget, url: string, token?: string) {
  const res = await fetch(`${target.baseUrl}/workspaces/clone`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify(token ? { url, token } : { url }),
    // A clone is real work. A big repository takes minutes; a retry after this
    // joins the clone still running on the computer rather than starting over.
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    cwd?: string;
    name?: string;
    error?: string;
  };
  if (!res.ok || !body.cwd) throw new Error(body.error ?? `Clone failed (${res.status}).`);
  return { cwd: body.cwd, name: body.name ?? 'repo' };
}

export async function daemonStack(target: DaemonTarget) {
  const res = await fetch(`${target.baseUrl}/stack`, {
    headers: headers(target),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Your computer answered ${res.status}.`);
  return (await res.json()) as import('os-code/protocol').DaemonStackInfo;
}

// ---- keys on your server (2026-10-09) --------------------------------------
// A docked server keeps a provider's key for its own coding sessions when an
// admin device turns it on (os-code/src/daemon/keyRoutes.ts). Only a server
// answers these, and only to an admin: a desktop and an older server answer
// 404, a member device 403, and the app shows nothing for either. A key goes
// out in one PUT body and is never read back: no answer carries a key, and no
// error made here names one.

/** A key route that did not answer yes. `status` is the server's answer, or
 *  absent when nothing answered at all. The message is the server's own
 *  (scrubbed of keys there) or a plain line made here. */
export class ServerKeyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ServerKeyError';
  }
}

/** This device cannot use the key routes there (a desktop, an older server,
 *  or a member device), which is nothing to show rather than a failure. */
export function keysNotOffered(err: unknown): boolean {
  return err instanceof ServerKeyError && (err.status === 403 || err.status === 404);
}

const KEY_ROUTE_TIMEOUT_MS = 8000;

async function keyRoute<T>(
  target: DaemonTarget,
  path: string,
  init: { method: string; body?: unknown } = { method: 'GET' },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${target.baseUrl}${path}`, {
      method: init.method,
      headers: {
        ...headers(target),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(KEY_ROUTE_TIMEOUT_MS),
    });
  } catch {
    throw new ServerKeyError(`${dockedNoun(target)} did not answer.`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    throw new ServerKeyError(
      typeof body.error === 'string' && body.error
        ? body.error
        : `${dockedNoun(target)} answered ${res.status}.`,
      res.status,
    );
  }
  return body as T;
}

/** The providers holding a key on the server: ids, names and hosts, never a
 *  key. A stray key whose provider entry is gone has host ''. */
export async function daemonListKeys(target: DaemonTarget): Promise<DaemonProviderKey[]> {
  const body = await keyRoute<Partial<DaemonKeysList>>(target, '/keys');
  return Array.isArray(body.keys) ? body.keys : [];
}

/** Put a provider's key on the server, once. Claude goes with its workspace
 *  id; every other provider with its OpenAI-compatible base. */
export async function daemonPutKey(
  target: DaemonTarget,
  id: string,
  put: DaemonPutKeyBody,
): Promise<DaemonProviderKey> {
  const body = await keyRoute<Partial<DaemonPutKeyAnswer>>(
    target,
    `/keys/${encodeURIComponent(id)}`,
    { method: 'PUT', body: put },
  );
  return body.provider ?? { id, label: put.label ?? id, host: '' };
}

/** Remove one provider's key from the server, and every stack slot there
 *  that named it. */
export async function daemonDeleteKey(
  target: DaemonTarget,
  id: string,
): Promise<DaemonRemoveKeysAnswer> {
  const body = await keyRoute<Partial<DaemonRemoveKeysAnswer>>(
    target,
    `/keys/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  return { ok: true, removed: body.removed ?? [], slotsCleared: body.slotsCleared ?? [] };
}

/** Remove every provider key the server keeps, for forgetting it. */
export async function daemonDeleteAllKeys(target: DaemonTarget): Promise<DaemonRemoveKeysAnswer> {
  const body = await keyRoute<Partial<DaemonRemoveKeysAnswer>>(target, '/keys', {
    method: 'DELETE',
  });
  return { ok: true, removed: body.removed ?? [], slotsCleared: body.slotsCleared ?? [] };
}

/** Place a provider's model as the server's own, with the window this device
 *  knows for it (kept there only for a provider off its network). */
export async function daemonPlaceOrchestrator(
  target: DaemonTarget,
  place: DaemonPlaceOrchestratorBody,
): Promise<DaemonPlaceOrchestratorAnswer['orchestrator']> {
  const body = await keyRoute<Partial<DaemonPlaceOrchestratorAnswer>>(
    target,
    '/stack/orchestrator',
    { method: 'POST', body: place },
  );
  if (!body.orchestrator) throw new ServerKeyError(`${dockedNoun(target)} did not say.`);
  return body.orchestrator;
}

// ---- outbox apply (buffered commit-intents land as real commits) ----------

export interface OutboxApplyWire {
  cwd: string;
  clientOpId: string;
  itemId: string;
  deviceId: string;
  branch: string;
  message: string;
  baseCommit: string;
  files: Array<{ path: string; mode: 'upsert' | 'delete'; contentBase64?: string }>;
}

export type OutboxApplyResult =
  | { ok: true; resultCommit: string; idempotentReplay?: boolean }
  | { ok: false; conflict: true; resultCommit: string; rescueBranch: string }
  | { ok: false; error: string };

/** Ask the desktop to materialize one buffered commit-intent into a commit. */
export async function daemonApplyOutbox(
  target: DaemonTarget,
  req: OutboxApplyWire,
): Promise<OutboxApplyResult> {
  const res = await fetch(`${target.baseUrl}/outbox/apply`, {
    method: 'POST',
    headers: { ...headers(target), 'content-type': 'application/json' },
    body: JSON.stringify(req),
    // Applying carries file bodies and runs git; a minute, not the OS default.
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res
    .json()
    .catch(() => ({ ok: false, error: `Apply failed (${res.status}).` }))) as OutboxApplyResult;
  return body;
}

/** Independent confirmation: does the commit exist and sit on the branch? */
export async function daemonVerifyCommit(
  target: DaemonTarget,
  cwd: string,
  commit: string,
  branch?: string,
): Promise<{ exists: boolean; onBranch: boolean }> {
  const qs = new URLSearchParams({ cwd, commit, ...(branch ? { branch } : {}) });
  const res = await fetch(`${target.baseUrl}/outbox/verify?${qs.toString()}`, {
    headers: headers(target),
    signal: AbortSignal.timeout(10_000),
  });
  // A non-OK response is not proof the commit is missing (the lookup itself
  // failed, or the path is not yet allowed). Throw so the caller keeps the item
  // buffered for a retry, rather than reading it as "commit not found".
  if (!res.ok) throw new Error(`Verify failed (${res.status}).`);
  return (await res.json()) as { exists: boolean; onBranch: boolean };
}

/** Parse one SSE frame ("id: N\ndata: {...}") into an event; null if not data. */
export function parseSseFrame(frame: string): { seq: number; event: DriverEvent } | null {
  let seq = 0;
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('id:')) seq = Number(line.slice(3).trim()) || 0;
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { seq, event: JSON.parse(data) as DriverEvent };
  } catch {
    return null;
  }
}

export class RemoteDriver implements ChatDriver {
  readonly kind = 'desktop' as const;
  private sinks = new Set<DriverEventSink>();
  /** Marks a reply grounded in a local-only pack note (I5). */
  private packMarker = new PackLocalOnlyMarker();
  private lastSeq: number;
  private closed = false;
  private abortStream?: AbortController;

  /** The hub's answer to "what may this device do", read from /health at
   *  attach (P0-1). Undefined until it answers, and stays undefined on a daemon
   *  that predates roles, so nothing is hidden for an old hub. */
  hubRole?: HubRole;
  /** Resolves once /health has answered (or failed), with the role. */
  readonly hubRoleReady: Promise<HubRole | undefined>;

  constructor(
    readonly sessionId: string,
    private readonly target: DaemonTarget,
    resumeFromSeq = 0,
    private readonly opts: {
      onLink?: (state: HubLinkState) => void;
      /** Drive only the terminal routes (the plain home shell): no session
       *  event stream and no role probe, since there is no session behind it. */
      terminalOnly?: boolean;
    } = {},
  ) {
    this.lastSeq = resumeFromSeq;
    if (opts.terminalOnly) {
      this.hubRoleReady = Promise.resolve(undefined);
      return;
    }
    this.hubRoleReady = daemonHealth(target)
      .then((h) => {
        this.hubRole = h.role;
        return h.role;
      })
      .catch(() => undefined);
    void this.streamLoop();
  }

  // G5, reshaped by B4: an outage is a link state, not a transcript row. The
  // first failed reattach reports `reconnecting` (the banner's "Connection
  // blipped"); once the failures have run past AWAY_AFTER_MS the link reads
  // `away` (the banner's "off or away"); a stream that connects reports `live`.
  // Each change is reported exactly once, however many attempts it takes. A
  // cleanly-closed stream backs off just like an error would, so a daemon that
  // closes the SSE immediately cannot spin this in a zero-delay hot loop.
  private link: HubLinkState | undefined;
  private outageSince?: number;
  /** This outage has already asked whether the computer refuses this phone. */
  private rejectionChecked = false;
  private notFoundStreak = 0;

  private setLink(state: HubLinkState): void {
    if (this.link === state) return;
    this.link = state;
    this.opts.onLink?.(state);
  }

  // A fatal answer is not a network blip: stop retrying and tell the user what
  // to do, instead of "Connection blipped" forever on a revoked token or a
  // deleted session. It also ends any run the replayed journal left open, so
  // the thread is not stuck busy with every later message quietly queued
  // behind a driver that will never answer (APP-4). The store drops the
  // driver on the same event.
  private emitTerminal(message: string): void {
    this.closed = true;
    for (const sink of [...this.sinks]) {
      sink({ type: 'status', message }, this.lastSeq);
      sink({ type: 'task-done', reason: 'error', message }, this.lastSeq);
    }
  }

  private async streamLoop(): Promise<void> {
    let backoffMs = 600;
    const stepBackoff = async () => {
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 10_000);
    };
    while (!this.closed) {
      this.abortStream = new AbortController();
      try {
        const res = await streamingFetch(
          `${this.target.baseUrl}/sessions/${this.sessionId}/events?since=${this.lastSeq}`,
          { headers: headers(this.target), signal: this.abortStream.signal },
        );
        if (res.status === 401 || res.status === 403) {
          // The door's own words: the person scans a fresh code in Computer.
          this.emitTerminal(
            `Your computer turned down ${thisDeviceNoun()}. Connect your computer again from Computer.`,
          );
          return;
        }
        if (res.status === 404) {
          // Tolerate a transient 404 (a session rehydrating), give up after a few.
          this.notFoundStreak += 1;
          if (this.notFoundStreak >= 3) {
            this.emitTerminal('This session no longer exists on your computer. Start a new one.');
            return;
          }
          throw new Error('session not found yet');
        }
        this.notFoundStreak = 0;
        if (!res.ok || !res.body) throw new Error(`daemon answered ${res.status}`);
        // A successful reconnect (even before the first frame, and even on an
        // idle session that only sends keepalives) means the outage is over.
        // Reset here so backoff and the link do not stay degraded on an idle
        // stream that never emits a productive frame (TS-P2-3).
        this.outageSince = undefined;
        this.rejectionChecked = false;
        this.setLink('live');
        backoffMs = 600;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done || this.closed) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const parsed = parseSseFrame(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 2);
            if (!parsed) continue;
            // A productive frame: the outage (if any) is over. Reset backoff
            // so the next genuine outage steps up from the start again.
            backoffMs = 600;
            this.lastSeq = Math.max(this.lastSeq, parsed.seq);
            // A pack that carried a local-only note marks the reply (I5).
            const event = this.packMarker.mark(parsed.event);
            for (const sink of [...this.sinks]) sink(event, parsed.seq);
          }
        }
      } catch {
        if (this.closed) return;
        const now = Date.now();
        if (this.outageSince === undefined) {
          this.outageSince = now;
          this.setLink('reconnecting');
        } else if (now - this.outageSince >= AWAY_AFTER_MS) {
          this.setLink('away');
          // A revoked phone's 401 carries no CORS headers, so the WebView's
          // stream reports it as a network error and the check above never
          // sees it (pairing review, CX 2026-10-01). Once per outage, ask the
          // credential-free route whether the computer is there and only this
          // phone is refused; if so, say so and stop, instead of "away" forever.
          if (!this.rejectionChecked) {
            this.rejectionChecked = true;
            const health = await daemonHealth(this.target);
            if (health.detail === PAIRING_REJECTED) {
              this.emitTerminal(PAIRING_REJECTED);
              return;
            }
          }
        }
        await stepBackoff();
        continue;
      }
      // Clean close (the daemon ended the response with no error): the run may
      // just be idle. Back off before reattaching. No blip: nothing went wrong.
      if (this.closed) return;
      await stepBackoff();
    }
  }

  subscribe(sink: DriverEventSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  /** Images do not ride this route. A message marked local-only (a private
   *  plan's step, CX and CMO 2026-10-08, J) keeps its mark on the wire, so
   *  the daemon holds the task to the engine's D5 rules; an older daemon
   *  ignores the field, which is why a step goes marked only to a daemon
   *  that says it takes one (GET /stack `acceptsLocalOnly`). */
  send(text: string, _attachments?: unknown, opts: { localOnly?: true } = {}): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/input`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(opts.localOnly ? { localOnly: true } : {}) }),
      // A blackholed tailnet (Tailscale toggled off on the phone) otherwise
      // hangs this for the OS default minute with no feedback.
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      // The store painted the user bubble and marked the thread busy the
      // moment the text left (B3), so this ends that turn honestly: a stopped
      // row with the plain sentence and a Retry, the bubble still on screen.
      for (const sink of [...this.sinks]) {
        sink({ type: 'task-done', reason: 'error', message: HUB_NO_ANSWER }, this.lastSeq);
      }
    });
  }

  abort(): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/abort`, {
      method: 'POST',
      headers: headers(this.target),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  answerApproval(approvalId: string, answer: ApprovalAnswer): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/approvals/${approvalId}`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify(answer),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  // ---- the person's session controls ----
  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/${path}`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  setMode(mode: PermissionMode): void {
    void this.post('mode', { mode }).catch(() => {});
  }

  setInstructions(text?: string): void {
    void this.post('instructions', { text }).catch(() => {});
  }

  async compact(focus?: string): Promise<{ before: number; after: number } | { error: string }> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/compact`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: JSON.stringify(focus ? { focus } : {}),
        // Compaction is a model turn of its own; give it real time.
        signal: AbortSignal.timeout(120_000),
      });
      return (await res.json()) as { before: number; after: number } | { error: string };
    } catch {
      return { error: 'Could not reach your computer to compact.' };
    }
  }

  async listFiles(query: string): Promise<string[]> {
    try {
      const res = await fetch(
        `${this.target.baseUrl}/sessions/${this.sessionId}/files?q=${encodeURIComponent(query)}`,
        { headers: headers(this.target), signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { files?: string[] };
      return body.files ?? [];
    } catch {
      return [];
    }
  }

  async trustFolder(): Promise<{ ok: true; folder: string } | { error: string }> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/trust`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as
        { ok: true; folder: string } | { error: string; message?: string };
      if ('ok' in body && body.ok) return body;
      const failed = body as { error: string; message?: string };
      return { error: failed.message ?? failed.error };
    } catch {
      return { error: 'Could not reach your computer to trust this folder.' };
    }
  }

  async giveMoreRoom(
    provider: string,
  ): Promise<{ ok: true; provider: string } | { error: string }> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/more-room`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as
        { ok: true; provider: string } | { error: string; message?: string };
      if ('ok' in body && body.ok) return body;
      // 403 for a member (the owner's call), 409 for a server the computer
      // does not know; both carry a plain sentence.
      const failed = body as { error: string; message?: string };
      return { error: failed.message ?? failed.error };
    } catch {
      return { error: 'Could not reach your computer to give the model more room.' };
    }
  }

  async restoreCheckpoint(
    id: string,
    direction: 'undo' | 'redo',
    path?: string,
  ): Promise<{ ok: true; paths: string[] } | { error: string }> {
    try {
      const res = await fetch(
        `${this.target.baseUrl}/sessions/${this.sessionId}/checkpoints/${encodeURIComponent(id)}/restore`,
        {
          method: 'POST',
          headers: { ...headers(this.target), 'content-type': 'application/json' },
          body: JSON.stringify(path === undefined ? { direction } : { direction, path }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const body = (await res.json()) as
        { ok: true; paths: string[] } | { error: string; message?: string };
      if ('ok' in body && body.ok) return body;
      const failed = body as { error: string; message?: string };
      return { error: failed.message ?? failed.error };
    } catch {
      return { error: 'Could not reach your computer to put the files back.' };
    }
  }

  async rewind(
    taskSeq: number,
    opts: { files: boolean },
  ): Promise<{ ok: true; paths: string[] } | { error: string }> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/rewind`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: JSON.stringify({ toSeq: taskSeq, files: opts.files }),
        // Putting many files back can take a while on a slow computer.
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json()) as
        { ok: true; paths: string[] } | { error: string; message?: string };
      if ('ok' in body && body.ok) return body;
      const failed = body as { error: string; message?: string };
      return { error: failed.message ?? failed.error };
    } catch {
      return { error: 'Could not reach your computer to rewind.' };
    }
  }

  // ---- chat-to-terminal bridge ----
  // Output for a started run streams back as command-* events on the same SSE
  // subscription, so these methods only kick off / drive a run. A short timeout
  // keeps a blackholed tailnet from hanging the tap.
  async runCommand(command: string): Promise<RunCommandResult> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/commands`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: JSON.stringify({ command }),
        signal: AbortSignal.timeout(10_000),
      });
      // P0-1: a member's shell is refused on purpose, with the hub's own words.
      // Carry them through; every other failure stays "no terminal here".
      if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        if (body.error === 'restricted') {
          return {
            refused: body.message ?? 'Your computer does not allow commands for this device.',
          };
        }
        return undefined;
      }
      if (!res.ok) return undefined;
      const body = (await res.json()) as { runId?: string };
      return body.runId ? { runId: body.runId } : undefined;
    } catch {
      return undefined;
    }
  }

  sendStdin(runId: string, data: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/commands/${runId}/stdin`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  killCommand(runId: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/commands/${runId}/kill`, {
      method: 'POST',
      headers: headers(this.target),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  // ---- interactive PTY terminal (Phase 2 bridge) ----
  // Its own SSE endpoint with offset-based replay, completely separate from the
  // session event journal above. Raw bytes go base64 on the wire.
  async openTerminal(opts: { cols: number; rows: number }): Promise<TerminalOpen> {
    try {
      const res = await fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/term`, {
        method: 'POST',
        headers: { ...headers(this.target), 'content-type': 'application/json' },
        body: JSON.stringify({ cols: opts.cols, rows: opts.rows }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          unavailable: true,
          error: body.error ?? 'Terminal support is not installed on your computer.',
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        termId?: string;
        cols?: number;
        rows?: number;
        error?: string;
      };
      if (!res.ok || !body.termId) {
        return {
          unavailable: true,
          error: body.error ?? `Your computer answered ${res.status}.`,
        };
      }
      return { termId: body.termId, cols: body.cols ?? opts.cols, rows: body.rows ?? opts.rows };
    } catch {
      return { unavailable: true, error: 'Could not reach your computer to open a terminal.' };
    }
  }

  async terminalStream(
    termId: string,
    sinceOffset: number,
    onChunk: (bytes: Uint8Array, endOffset: number) => void,
    signal: AbortSignal,
    onExit?: (info: TerminalExit) => void,
  ): Promise<void> {
    const res = await streamingFetch(
      `${this.target.baseUrl}/sessions/${this.sessionId}/term/${termId}/stream?since=${sinceOffset}`,
      { headers: headers(this.target), signal },
    );
    if (!res.ok || !res.body) throw new Error(`daemon answered ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const payload = JSON.parse(dataLine.slice(5).trim()) as {
            b64?: string;
            offset?: number;
            exit?: number;
          };
          if (payload.b64) onChunk(b64ToBytes(payload.b64), payload.offset ?? sinceOffset);
          // The shell's last word (DAE-5): a final {exit, offset} frame. The
          // stream is over; do not reconnect into a dead terminal.
          if (typeof payload.exit === 'number') {
            onExit?.({ exit: payload.exit, offset: payload.offset ?? sinceOffset });
            return;
          }
        } catch {}
      }
    }
  }

  async terminalStdin(termId: string, data: string): Promise<TerminalWrite> {
    try {
      const res = await fetch(
        `${this.target.baseUrl}/sessions/${this.sessionId}/term/${termId}/stdin`,
        {
          method: 'POST',
          headers: { ...headers(this.target), 'content-type': 'application/json' },
          body: JSON.stringify({ dataBase64: textToB64(data) }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.ok) return { ok: true };
      // 409 is the daemon's "shell exited" (DAE-5): the terminal is real, it is
      // just over. Anything else is a missing terminal or a hub problem.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const exited = res.status === 409;
      return {
        ok: false,
        exited,
        error:
          body.error ??
          (exited ? 'The shell has exited.' : `Your computer answered ${res.status}.`),
      };
    } catch {
      return { ok: false, exited: false, error: 'Could not reach your computer.' };
    }
  }

  terminalResize(termId: string, cols: number, rows: number): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/term/${termId}/resize`, {
      method: 'POST',
      headers: { ...headers(this.target), 'content-type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  terminalKill(termId: string): void {
    void fetch(`${this.target.baseUrl}/sessions/${this.sessionId}/term/${termId}`, {
      method: 'DELETE',
      headers: headers(this.target),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  dispose(): void {
    this.closed = true;
    this.abortStream?.abort();
    this.sinks.clear();
  }
}
