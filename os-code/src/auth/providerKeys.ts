// Keys on your server (2026-10-09; docs/design/byok-any-provider-plan.md,
// part 3). The one module the daemon's key routes and `osc key` share: put a
// provider's key in this machine's credential store and the provider in its
// config, list which providers hold a key here, and remove them again.
//
// Strictly bring your own keys: the key is the person's, stored only on their
// own machine, and spent only with the provider they named. Nothing here
// checks a key against its provider (no outbound call, so a server is never a
// key-checking oracle); the first session that uses it shows whether it works.
// A provider this module did not write (a hand-written endpoint, the default
// Ollama, the desktop's Connect ChatGPT) is never overwritten or removed. A
// key here is for a provider's API off this network: a model server on it
// (a gateway such as LiteLLM included) is set up in the stack, so that a key
// door never makes a cloud seat read as local (tech review 3, D5).
import {
  deleteCredential,
  getCredential,
  readCredential,
  setCredential,
  storedCredentialNames,
} from './store.js';
import type { StoreBackend } from './store.js';
import {
  CLAUDE_API_BASE,
  CLAUDE_KEY_NAME,
  CLAUDE_WORKSPACE_NAME,
  getAnthropicKey,
  isClaudeAddress,
} from './claude.js';
import { editGlobalConfig, loadGlobalConfig } from '../config/load.js';
import { ConfigSchema, type OscConfig, type ProviderEndpoint } from '../config/schema.js';
import { isProviderId, isProviderKeyRef, providerKeyRef } from '../config/providerKeyRef.js';
import { isLocalHost, isLocalUrl } from '../core/security/egress.js';
import { redactSecrets } from '../core/security/redaction.js';
import { ProviderRegistry } from '../providers/registry.js';
import { seatLeaves } from '../providers/types.js';

/**
 * The providers OpenShore names, with the OpenAI-compatible base each serves
 * on, so `osc key add groq` needs no --base-url. These MUST AGREE with the
 * app's PROVIDERS (app/src/lib/providers.ts, each `openaiBaseUrl`): the app
 * sends its own base with every key it puts here, and test/providerKeys.test.ts
 * compares the two for every id both name. Claude is not on this wire; its
 * key goes only to Anthropic's own address.
 */
export const KNOWN_PROVIDERS: Readonly<Record<string, { label: string; baseUrl: string }>> = {
  anthropic: { label: 'Claude', baseUrl: CLAUDE_API_BASE },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  google: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  moonshot: { label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/v1' },
  perplexity: { label: 'Perplexity', baseUrl: 'https://api.perplexity.ai' },
  // The named providers of 2026-10-09, each base read in its own docs.
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  together: { label: 'Together AI', baseUrl: 'https://api.together.ai/v1' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  xai: { label: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  cerebras: { label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
  huggingface: { label: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1' },
  nebius: { label: 'Nebius Token Factory', baseUrl: 'https://api.tokenfactory.nebius.com/v1' },
  novita: { label: 'Novita AI', baseUrl: 'https://api.novita.ai/openai/v1' },
  minimax: { label: 'MiniMax', baseUrl: 'https://api.minimax.io/v1' },
  nvidia: { label: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1' },
};

/** A provider OpenShore names, by its own id only (never a name the object
 *  inherits, such as "constructor"). */
export function knownProvider(id: string): { label: string; baseUrl: string } | undefined {
  return Object.hasOwn(KNOWN_PROVIDERS, id) ? KNOWN_PROVIDERS[id] : undefined;
}

/** The endpoint configured under `id`, by its own key only. */
function configured(config: OscConfig, id: string): ProviderEndpoint | undefined {
  return Object.hasOwn(config.providers, id) ? config.providers[id] : undefined;
}

/** A refusal with the status a route answers it with. Its message never
 *  carries a key. */
export class ProviderKeyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503 = 400,
  ) {
    super(message);
    this.name = 'ProviderKeyError';
  }
}

/** One provider holding a key here: never the key, a fingerprint, or a date. */
export interface ProviderKeyRow {
  id: string;
  label: string;
  host: string;
}

export interface PutProviderKey {
  key: unknown;
  baseUrl?: unknown;
  label?: unknown;
  workspaceId?: unknown;
}

const KEY_MAX_CHARS = 4096;
const BASE_URL_MAX_CHARS = 300;
const LABEL_MAX_CHARS = 60;
const MODEL_MAX_CHARS = 200;
/** The most listed windows one endpoint keeps; the oldest go first. */
const WINDOWS_KEPT = 32;
/** The windows a placement may keep, in tokens. */
export const WINDOW_MIN = 1024;
export const WINDOW_MAX = 10_000_000;
// Control and format characters (the direction marks and the zero-width ones
// among them), which a label printed in a terminal or a list must never
// carry. The same family as serverPair.ts's device labels.
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/u;

export const ID_HINT = 'A provider id is lower-case letters, numbers and dashes, like openrouter.';

function cleanId(id: unknown): string {
  if (!isProviderId(id)) throw new ProviderKeyError(ID_HINT);
  return id;
}

function cleanKey(key: unknown): string {
  if (typeof key !== 'string' || !key.trim()) {
    throw new ProviderKeyError('Send the API key as {"key": "..."}.');
  }
  const trimmed = key.trim();
  if (trimmed.length > KEY_MAX_CHARS) {
    throw new ProviderKeyError('That is too long to be an API key.');
  }
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    throw new ProviderKeyError(
      'An API key is one line of letters, numbers and symbols, with no spaces.',
    );
  }
  return trimmed;
}

/** A provider's address: https, off this computer's own network (judged by
 *  address), with no credentials, query or fragment in it, and no trailing
 *  slash. A server on this network is refused: it would read as local, so a
 *  gateway on it passing turns to a cloud would get routines, the free chat
 *  and private notes (the forwards-to-a-cloud mark is not built yet). */
export function cleanBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > BASE_URL_MAX_CHARS) {
    throw new ProviderKeyError("Send the provider's address as its full https URL.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ProviderKeyError("That is not an address. Send the provider's full https URL.");
  }
  if (url.protocol !== 'https:') {
    throw new ProviderKeyError("A provider's address starts with https://.");
  }
  if (isLocalHost(url.hostname)) {
    throw new ProviderKeyError(
      "That address is on this machine's own network. A key kept here is for a provider's API off it; set up a model server on this network in the stack instead (osc stack).",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ProviderKeyError(
      "A provider's address carries no name, password, query or fragment. The key goes on its own.",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function cleanLabel(raw: unknown, fallback: string): string {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > LABEL_MAX_CHARS) {
    throw new ProviderKeyError(`A label is a short name, up to ${LABEL_MAX_CHARS} characters.`);
  }
  if (UNPRINTABLE.test(raw)) {
    throw new ProviderKeyError('A label carries no control or direction characters.');
  }
  return raw.trim();
}

function cleanWorkspace(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.trim())) {
    throw new ProviderKeyError(
      'A workspace id looks like wrkspc_ followed by letters and numbers.',
    );
  }
  return raw.trim();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The Claude record this module writes: Anthropic's own address, the Claude
 *  key. `osc login` writes the same one, so the Claude key on a machine is
 *  one key whichever door put it there. */
function claudeShape(endpoint: ProviderEndpoint): boolean {
  return endpoint.kind === 'anthropic' && isClaudeAddress(endpoint.baseUrl);
}

/** Whether this module wrote (and may change) the provider under `id`. */
function managed(id: string, endpoint: ProviderEndpoint): boolean {
  if (id === 'anthropic') return claudeShape(endpoint);
  return endpoint.kind === 'openai-compatible' && endpoint.apiKeyRef === providerKeyRef(id);
}

/** The credential names a provider's key lives under. */
function credentialNames(id: string): string[] {
  return id === 'anthropic' ? [CLAUDE_KEY_NAME, CLAUDE_WORKSPACE_NAME] : [providerKeyRef(id)];
}

function holdsKey(id: string): boolean {
  return Boolean(getCredential(id === 'anthropic' ? CLAUDE_KEY_NAME : providerKeyRef(id)));
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function labelOf(id: string, endpoint: ProviderEndpoint): string {
  return endpoint.label ?? knownProvider(id)?.label ?? id;
}

function lockedStore(): ProviderKeyError {
  return new ProviderKeyError(
    "This computer's keychain is locked, so OpenShore cannot change its keys. Unlock it and try again.",
    503,
  );
}

function setAside(id: string): ProviderKeyError {
  const logout = id === 'anthropic' ? ' To remove the Claude key, run osc login --logout.' : '';
  return new ProviderKeyError(
    `The provider "${id}" is set up another way on this machine, so OpenShore leaves it as it is.${logout}`,
    409,
  );
}

/** The providers record to edit, with the schema's default (Ollama on this
 *  computer) written out first when the file names none, so the first key
 *  never drops the model server every stack starts on. */
function providersOf(raw: Record<string, unknown>): Record<string, Record<string, unknown>> {
  if (!isPlainObject(raw.providers)) {
    raw.providers = structuredClone(ConfigSchema.parse({}).providers);
  }
  return raw.providers as Record<string, Record<string, unknown>>;
}

/** Clear every stack slot that names `id`, so a later session never meets a
 *  provider that is gone (resolveStack would refuse every one). Returns the
 *  slots cleared: 'orchestrator' and each specialist role. */
function clearSlots(raw: Record<string, unknown>, ids: ReadonlySet<string>): string[] {
  const stack = raw.stack;
  if (!isPlainObject(stack)) return [];
  const cleared: string[] = [];
  const names = (ref: unknown): boolean =>
    isPlainObject(ref) && typeof ref.provider === 'string' && ids.has(ref.provider);
  if (names(stack.orchestrator)) {
    delete stack.orchestrator;
    cleared.push('orchestrator');
  }
  if (isPlainObject(stack.specialists)) {
    for (const [role, ref] of Object.entries(stack.specialists)) {
      if (!names(ref)) continue;
      delete stack.specialists[role];
      cleared.push(role);
    }
  }
  return cleared;
}

/** Refuse before anything changes when the store cannot be read: a locked
 *  keychain must never read as "no key" (B1). */
function assertStoreReadable(names: readonly string[]): void {
  for (const name of names) {
    if (readCredential(name).keychainUnreadable) throw lockedStore();
  }
}

/** Every `provider-key:<id>` name in the store, whatever config says. */
function storedProviderKeyNames(): string[] {
  const { names, unreadable } = storedCredentialNames('provider-key:');
  if (unreadable) throw lockedStore();
  return names.filter(isProviderKeyRef);
}

/** The ids of stored provider keys with no provider entry at all (one
 *  removed by hand, or a write that failed half way), so they can still be
 *  listed and removed. */
function strayKeyIds(config: OscConfig): string[] {
  return storedProviderKeyNames()
    .map((name) => name.slice('provider-key:'.length))
    .filter((id) => !configured(config, id));
}

/** Write the credentials, then run the config change; when the config
 *  change fails, put every credential back as it was, so a key is never left
 *  in the store with nothing pointing at it. */
function withCredentials(
  writes: ReadonlyArray<readonly [name: string, value: string | undefined]>,
  commit: () => void,
): StoreBackend {
  const before = writes.map(([name]) => [name, getCredential(name)] as const);
  let backend: StoreBackend = 'encrypted-file';
  const apply = (pairs: ReadonlyArray<readonly [string, string | undefined]>): void => {
    for (const [name, value] of pairs) {
      if (value === undefined) deleteCredential(name);
      else backend = setCredential(name, value);
    }
  };
  apply(writes);
  try {
    commit();
  } catch (err) {
    apply(before);
    throw err;
  }
  return backend;
}

/** Keep a provider's key on this machine and its endpoint in config. */
export function putProviderKey(
  rawId: unknown,
  input: PutProviderKey,
): ProviderKeyRow & { backend: StoreBackend } {
  const id = cleanId(rawId);
  const key = cleanKey(input.key);
  if (id === 'anthropic') return putClaudeKey(key, input);
  if (cleanWorkspace(input.workspaceId) !== undefined) {
    throw new ProviderKeyError('A workspace id goes only with a Claude key.');
  }
  const known = knownProvider(id);
  const given = input.baseUrl === undefined || input.baseUrl === '' ? undefined : input.baseUrl;
  const baseUrl = given !== undefined ? cleanBaseUrl(given) : known?.baseUrl;
  if (!baseUrl) {
    throw new ProviderKeyError(
      `OpenShore does not know where ${id} answers. Send its OpenAI-compatible address with the key, the base its API docs give (it often ends in /v1).`,
    );
  }
  const label = cleanLabel(input.label, known?.label ?? id);
  const ref = providerKeyRef(id);
  const existing = configured(loadGlobalConfig(), id);
  if (existing && !managed(id, existing)) throw setAside(id);
  assertStoreReadable([ref]);
  // A window the app placed a model with holds while the address does.
  const windows =
    existing?.kind === 'openai-compatible' && existing.baseUrl === baseUrl
      ? existing.contextWindows
      : undefined;
  const backend = withCredentials([[ref, key]], () => {
    editGlobalConfig((raw) => {
      const providers = providersOf(raw);
      providers[id] = {
        kind: 'openai-compatible',
        baseUrl,
        apiKeyRef: ref,
        label,
        versionedBase: true,
        ...(windows ? { contextWindows: windows } : {}),
      };
    });
  });
  return { id, label, host: hostOf(baseUrl), backend };
}

/** The Claude key: the names `osc login` uses, so every Claude seat and the
 *  escalation gate read it as they always have, and a provider record at
 *  Anthropic's own address when there is none. */
function putClaudeKey(
  key: string,
  input: PutProviderKey,
): ProviderKeyRow & { backend: StoreBackend } {
  if (!/^sk-ant-/.test(key)) {
    throw new ProviderKeyError(
      'That does not look like an Anthropic API key (they start with sk-ant-).',
    );
  }
  if (input.baseUrl !== undefined && input.baseUrl !== '') {
    if (cleanBaseUrl(input.baseUrl) !== CLAUDE_API_BASE) {
      throw new ProviderKeyError("A Claude key goes only to Anthropic's own address.");
    }
  }
  const workspace = cleanWorkspace(input.workspaceId);
  const label = cleanLabel(input.label, 'Claude');
  const existing = configured(loadGlobalConfig(), 'anthropic');
  if (existing && !claudeShape(existing)) throw setAside('anthropic');
  assertStoreReadable([CLAUDE_KEY_NAME, CLAUDE_WORKSPACE_NAME]);
  const backend = withCredentials(
    [
      [CLAUDE_KEY_NAME, key],
      [CLAUDE_WORKSPACE_NAME, workspace],
    ],
    () => {
      if (existing) return;
      editGlobalConfig((raw) => {
        const providers = providersOf(raw);
        providers.anthropic = { kind: 'anthropic', ...(label !== 'Claude' ? { label } : {}) };
      });
    },
  );
  return {
    id: 'anthropic',
    label: existing ? labelOf('anthropic', existing) : label,
    host: hostOf(CLAUDE_API_BASE),
    backend,
  };
}

function managedIds(config: OscConfig): string[] {
  return Object.entries(config.providers)
    .filter(([id, endpoint]) => isProviderId(id) && managed(id, endpoint))
    .map(([id]) => id);
}

/** The providers holding a key on this machine, in config order, then any
 *  stored key whose provider entry is gone (its host ''). A locked store
 *  refuses (503) rather than read as "none" (B1). */
export function listProviderKeys(config: OscConfig = loadGlobalConfig()): ProviderKeyRow[] {
  const ids = managedIds(config);
  assertStoreReadable([CLAUDE_KEY_NAME, ...ids.flatMap(credentialNames)]);
  const rows: ProviderKeyRow[] = [];
  for (const id of ids) {
    if (!holdsKey(id)) continue;
    const endpoint = config.providers[id]!;
    rows.push({ id, label: labelOf(id, endpoint), host: hostOf(endpoint.baseUrl) });
  }
  for (const id of strayKeyIds(config)) {
    rows.push({ id, label: knownProvider(id)?.label ?? id, host: '' });
  }
  return rows;
}

export interface RemovedKeys {
  /** The providers whose key or endpoint was removed. */
  removed: string[];
  /** The stack slots that named one, now empty. */
  slotsCleared: string[];
}

/** Delete the provider's key and its endpoint, and clear every stack slot
 *  that names it. */
export function removeProviderKey(rawId: unknown): RemovedKeys {
  const id = cleanId(rawId);
  const endpoint = configured(loadGlobalConfig(), id);
  if (endpoint && !managed(id, endpoint)) throw setAside(id);
  return removeMany(endpoint ? [id] : [], [id]);
}

/** Every key this module keeps here, for forgetting a server: each provider
 *  it wrote (and the Claude key, when one is held), with its stack slots,
 *  and every other `provider-key:` name in the store, a stray one too. */
export function removeAllProviderKeys(): RemovedKeys {
  const config = loadGlobalConfig();
  assertStoreReadable(credentialNames('anthropic'));
  const ids = managedIds(config).filter((id) => id !== 'anthropic' || holdsKey(id));
  const ours = new Set(ids.map(providerKeyRef));
  const strays = storedProviderKeyNames().filter((name) => !ours.has(name));
  return removeMany(ids, ids, strays);
}

/** Remove the endpoints under `endpoints` in one atomic config write, then
 *  delete the keys of every id in `keys` and each name in `strays`. */
function removeMany(
  endpoints: readonly string[],
  keys: readonly string[],
  strays: readonly string[] = [],
): RemovedKeys {
  const names = [...keys.flatMap(credentialNames), ...strays];
  assertStoreReadable(names);
  const held = [...keys.filter(holdsKey), ...strays.map((n) => n.slice('provider-key:'.length))];
  let slotsCleared: string[] = [];
  if (endpoints.length) {
    editGlobalConfig((raw) => {
      const providers = isPlainObject(raw.providers) ? raw.providers : {};
      for (const id of endpoints) delete providers[id];
      slotsCleared = clearSlots(raw, new Set(endpoints));
    });
  }
  for (const name of names) deleteCredential(name);
  const removed = [...new Set([...endpoints, ...held])];
  return { removed, slotsCleared };
}

export interface PlaceOrchestratorInput {
  provider: unknown;
  model: unknown;
  contextTokens?: unknown;
}

export interface PlacedOrchestrator {
  provider: string;
  model: string;
  /** Judged by address and model name (seatLeaves). */
  kind: 'local' | 'cloud';
  /** The window kept for it, on an endpoint off this network. */
  contextTokens?: number;
}

/** Place a configured provider's model as this machine's orchestrator. A
 *  window the app knows for it is kept only for an endpoint off this network:
 *  a server here is budgeted against the window it serves. */
export function placeOrchestrator(input: PlaceOrchestratorInput): PlacedOrchestrator {
  const config = loadGlobalConfig();
  const provider = input.provider;
  if (typeof provider !== 'string' || !provider || !configured(config, provider)) {
    throw new ProviderKeyError(
      `There is no provider "${typeof provider === 'string' ? provider.slice(0, 60) : ''}" on this machine. Put its key here first.`,
      404,
    );
  }
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model || model.length > MODEL_MAX_CHARS || UNPRINTABLE.test(model)) {
    throw new ProviderKeyError('A model is named by its id, like deepseek-v4-pro.');
  }
  let window: number | undefined;
  if (input.contextTokens !== undefined && input.contextTokens !== null) {
    const n = input.contextTokens;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < WINDOW_MIN || n > WINDOW_MAX) {
      throw new ProviderKeyError(
        `contextTokens is a whole number of tokens from ${WINDOW_MIN} to ${WINDOW_MAX}.`,
      );
    }
    window = n;
  }
  const registry = new ProviderRegistry(config, getAnthropicKey);
  const leaves = seatLeaves(registry.get(provider), model);
  const endpoint = config.providers[provider]!;
  // Judged by address alone, the rule the window is read by: a cloud tag on
  // this computer's Ollama leaves, but its window is never read from here.
  const keepWindow =
    window !== undefined && endpoint.kind === 'openai-compatible' && !isLocalUrl(endpoint.baseUrl);
  editGlobalConfig((raw) => {
    if (!isPlainObject(raw.stack)) raw.stack = {};
    (raw.stack as Record<string, unknown>).orchestrator = { provider, model };
    if (!keepWindow) return;
    const record = providersOf(raw)[provider]!;
    const windows = isPlainObject(record.contextWindows) ? { ...record.contextWindows } : {};
    delete windows[model];
    windows[model] = window;
    const names = Object.keys(windows);
    for (const old of names.slice(0, Math.max(0, names.length - WINDOWS_KEPT))) {
      delete windows[old];
    }
    record.contextWindows = windows;
  });
  return {
    provider,
    model,
    kind: leaves ? 'cloud' : 'local',
    ...(keepWindow ? { contextTokens: window } : {}),
  };
}

/** Text with every given secret, and anything shaped like a credential,
 *  replaced, for an error or a log line that might have met one. */
export function scrubSecrets(text: string, ...secrets: ReadonlyArray<string | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return redactSecrets(out);
}
