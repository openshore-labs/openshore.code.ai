// Connecting the Claude account.
//   - API key: the dependable, documented, marketed path. Implemented for real.
//   - Subscription sign-in: an EXPERIMENTAL, clearly labeled stub. Driving a
//     consumer subscription from a third-party client is a ToS gray area and
//     an overnight-breakage risk, so it appears on no marketing surface and
//     does nothing except explain itself.
import { deleteCredential, getCredential, setCredential, type StoreBackend } from './store.js';

const KEY_NAME = 'anthropic-api-key';
const WORKSPACE_NAME = 'anthropic-workspace-id';

/** Resolution order: credential store, then the standard env var. */
export function getAnthropicKey(): string | undefined {
  return getCredential(KEY_NAME) ?? process.env.ANTHROPIC_API_KEY ?? undefined;
}

/** The workspace an identity-linked key acts in (sent as the
 *  anthropic-workspace-id header). Optional for a workspace-scoped key. */
export function getAnthropicWorkspace(): string | undefined {
  return getCredential(WORKSPACE_NAME) ?? process.env.ANTHROPIC_WORKSPACE_ID ?? undefined;
}

/** Headers for a request on the connected key, with the workspace when set. */
export function anthropicAuthHeaders(key: string, workspaceId?: string): Record<string, string> {
  const ws = (workspaceId ?? getAnthropicWorkspace())?.trim();
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    ...(ws ? { 'anthropic-workspace-id': ws } : {}),
  };
}

/** True when the API says this key needs a workspace id to act. */
export function needsWorkspaceId(errorText: string): boolean {
  return /anthropic-workspace-id/i.test(errorText);
}

export const WORKSPACE_HINT =
  'This key is linked to your identity, so the API needs the id of the workspace it acts in. Find it in the Anthropic Console under Settings, Workspaces (it starts with wrkspc_), and add it next to the key.';

export function isClaudeConnected(): boolean {
  return Boolean(getAnthropicKey());
}

export interface LoginResult {
  ok: boolean;
  detail: string;
  backend?: StoreBackend;
  /** The key is identity-linked and the API wants a workspace id with it. */
  needsWorkspace?: boolean;
}

/** Validate the key against the API, then store it locally. */
export async function loginWithApiKey(
  key: string,
  baseUrl = 'https://api.anthropic.com',
  workspaceId?: string,
): Promise<LoginResult> {
  const trimmed = key.trim();
  const ws = workspaceId?.trim();
  if (!/^sk-ant-/.test(trimmed)) {
    return {
      ok: false,
      detail:
        'That does not look like an Anthropic API key (they start with sk-ant-). Copy it from console.anthropic.com under API Keys.',
    };
  }
  try {
    const res = await fetch(`${baseUrl}/v1/models?limit=1`, {
      headers: anthropicAuthHeaders(trimmed, ws),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 400 && needsWorkspaceId(await res.clone().text())) {
      return { ok: false, detail: WORKSPACE_HINT, needsWorkspace: true };
    }
    if (res.status === 401) {
      return {
        ok: false,
        detail: 'The API rejected that key. Check for a missing character, or create a fresh key.',
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        detail: `The Anthropic API answered ${res.status}; try again in a moment.`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      detail: `Could not reach the Anthropic API to validate the key: ${(err as Error).message}`,
    };
  }
  const backend = setCredential(KEY_NAME, trimmed);
  if (ws) setCredential(WORKSPACE_NAME, ws);
  else deleteCredential(WORKSPACE_NAME);
  return { ok: true, detail: 'Claude is connected.', backend };
}

export function logoutClaude(): void {
  deleteCredential(KEY_NAME);
  deleteCredential(WORKSPACE_NAME);
}

/**
 * EXPERIMENTAL STUB. The subscription OAuth token exchange needs a hosted
 * component OS Code does not ship; this records nothing and explains why.
 */
export function subscriptionSignInStub(): string {
  return [
    'Subscription sign-in is experimental and not wired up.',
    'Using a consumer Claude subscription from a third-party client is a terms-of-service gray area, can break without notice, and could put the account at risk. OS Code does not do it quietly.',
    'The dependable path is an API key from console.anthropic.com: run osc login and paste it. Pay-as-you-go, your own key, no gray areas.',
  ].join('\n');
}
