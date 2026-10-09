// Keys on your server (2026-10-09), the daemon's half. serve.ts answers these
// only on a server and only to an admin device; this file is what they do,
// over the one module `osc key` shares (auth/providerKeys.ts). A key arrives
// in a PUT body over the docked link, goes to this machine's credential
// store, and is never answered, logged or kept anywhere else. Every error is
// scrubbed of it before it leaves this file.
import {
  ProviderKeyError,
  listProviderKeys,
  placeOrchestrator,
  putProviderKey,
  removeAllProviderKeys,
  removeProviderKey,
  scrubSecrets,
} from '../auth/providerKeys.js';
import type {
  DaemonKeysList,
  DaemonPlaceOrchestratorAnswer,
  DaemonPutKeyAnswer,
  DaemonRemoveKeysAnswer,
} from '../protocol.js';
import { logger } from '../util/log.js';

const log = logger('daemon-keys');

/** A key, its address, a label and a workspace id fit in far less. */
export const KEY_BODY_MAX_BYTES = 8 * 1024;

/** Key writes per device credential: a few at once (turning several
 *  providers on), then one every few seconds. */
export const KEY_WRITE_BUCKET = { capacity: 10, refillMs: 6_000 };

export interface KeyRouteRequest {
  method: string;
  /** The path's segments, e.g. ['keys', 'openrouter'] or ['stack', 'orchestrator']. */
  parts: readonly string[];
  /** The body as a JSON object (serve.ts's bounded reader). */
  readBody(maxBytes?: number): Promise<Record<string, unknown>>;
  /** Spend one write for the credential presenting this request. */
  takeWrite(): { ok: true } | { ok: false; retryAfterMs: number };
}

export interface KeyRouteAnswer {
  status: number;
  json: unknown;
}

/** Whether a path is one of these routes, so serve.ts can gate it first. */
export function isKeyRoute(parts: readonly string[]): boolean {
  return (
    parts[0] === 'keys' ||
    (parts.length === 2 && parts[0] === 'stack' && parts[1] === 'orchestrator')
  );
}

const fail = (status: number, error: string): KeyRouteAnswer => ({ status, json: { error } });

function slowDown(retryAfterMs: number): KeyRouteAnswer {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const wait = seconds === 1 ? 'a second' : `${seconds} seconds`;
  return fail(429, `Too many key changes at once. Try again in ${wait}.`);
}

/** Answer a key route. An admin and a server are checked by the caller. */
export async function keyRoute(req: KeyRouteRequest): Promise<KeyRouteAnswer> {
  const { method, parts } = req;
  // The body is read before anything else can fail, so a refusal below can
  // name the key it must scrub. A bad body throws to serve.ts, whose answer
  // is fixed text.
  const body =
    method === 'PUT' || method === 'POST' ? await req.readBody(KEY_BODY_MAX_BYTES) : undefined;
  const key = typeof body?.key === 'string' ? body.key : undefined;
  try {
    if (parts[0] === 'stack') {
      if (method !== 'POST') return fail(405, 'Place the model with POST.');
      const placed = placeOrchestrator({
        provider: body?.provider,
        model: body?.model,
        contextTokens: body?.contextTokens,
      });
      log.info('placed the orchestrator', { provider: placed.provider, kind: placed.kind });
      return {
        status: 200,
        json: { ok: true, orchestrator: placed } satisfies DaemonPlaceOrchestratorAnswer,
      };
    }
    if (parts.length === 1) {
      if (method === 'GET') {
        return { status: 200, json: { keys: listProviderKeys() } satisfies DaemonKeysList };
      }
      if (method === 'DELETE') {
        const gone = removeAllProviderKeys();
        log.info('removed every provider key', { count: gone.removed.length });
        return { status: 200, json: { ok: true, ...gone } satisfies DaemonRemoveKeysAnswer };
      }
      return fail(405, 'List keys with GET, or remove every one with DELETE.');
    }
    if (parts.length !== 2) return fail(404, 'Not found.');
    let id: string;
    try {
      id = decodeURIComponent(parts[1]!);
    } catch {
      return fail(400, 'That is not a provider id.');
    }
    if (method === 'PUT') {
      const turn = req.takeWrite();
      if (!turn.ok) return slowDown(turn.retryAfterMs);
      const row = putProviderKey(id, {
        key: body?.key,
        baseUrl: body?.baseUrl,
        label: body?.label,
        workspaceId: body?.workspaceId,
      });
      log.info('stored a provider key', { provider: row.id, host: row.host });
      const answer: DaemonPutKeyAnswer = {
        ok: true,
        provider: { id: row.id, label: row.label, host: row.host },
      };
      return { status: 200, json: answer };
    }
    if (method === 'DELETE') {
      const turn = req.takeWrite();
      if (!turn.ok) return slowDown(turn.retryAfterMs);
      const gone = removeProviderKey(id);
      log.info('removed a provider key', { provider: id, slots: gone.slotsCleared.length });
      return { status: 200, json: { ok: true, ...gone } satisfies DaemonRemoveKeysAnswer };
    }
    return fail(405, 'Put a key with PUT, or remove it with DELETE.');
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), key);
    if (err instanceof ProviderKeyError) return fail(err.status, message);
    log.warn('a key route failed', { err: message });
    return fail(500, `The server could not change its keys: ${message}`);
  }
}
