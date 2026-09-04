// Tokens and Secrets: a per-project note of the credentials the project uses,
// kept so the person does not have to hunt them down or rotate them for lack of
// a record, and so a LOCAL coding model can use them to run commands without
// asking for a paste again.
//
// Privacy is the whole point, so the storage is deliberate:
//  - It lives in the SEALED, device-local store (secretGet/secretSet), which is
//    encrypted at rest and, on iOS, in the secure enclave. It is NOT a vault
//    note (a vault can be moved to iCloud or Drive) and NOT in the repo (the
//    repo is pushed to a remote). It never leaves the device.
//  - It is off by default; the person turns it on in Settings.
//  - Only a local model ever sees it. A cloud or BYOM model never receives it,
//    and while it is enabled the session runs fully on-device (the engine
//    disables web tools and cloud escalation for it). That gating lives in the
//    os-code harness; this module is only the store and the template.
// No em dashes anywhere in this file (repo policy is total here).
import { secretGet, secretSet, secretDelete } from './platform.js';

/** The note's display title, shown in the Vault. */
export const SECRETS_NOTE_TITLE = 'Tokens and Secrets';

/** The sealed-store key for a project's secrets. Keyed by project id so a
 *  renamed project keeps its secrets. */
export function projectSecretsKey(projectId: string): string {
  return `oscode.projectSecrets.${projectId}`;
}

/** The scaffold a fresh secrets note starts from. Placeholders are descriptive
 *  on purpose (no real token shapes), so a secret scanner never trips on it. */
export function secretsTemplate(): string {
  return `# Tokens and Secrets

Private to this device. Encrypted at rest. Never pushed to your repo, and never synced.
Your local coding model can read these so it does not have to ask you to paste a
credential again. A cloud model never receives them, and while this is on the
session stays fully on-device: web tools and cloud escalation are turned off for it.

## Credentials
- name: value

## Notes
- Where each credential is used, and when it was last rotated.
`;
}

/** The project's secrets markdown, or '' when none is stored yet. */
export async function readProjectSecrets(projectId: string): Promise<string> {
  return (await secretGet(projectSecretsKey(projectId))) ?? '';
}

/** Save the project's secrets. Empty text deletes the entry, so an emptied note
 *  leaves nothing sealed on the device rather than an empty record. */
export async function writeProjectSecrets(projectId: string, text: string): Promise<void> {
  const key = projectSecretsKey(projectId);
  if (!text.trim()) {
    await secretDelete(key);
    return;
  }
  await secretSet(key, text);
}

/** Whether a project has any non-empty secrets stored. */
export async function hasProjectSecrets(projectId: string): Promise<boolean> {
  return Boolean((await secretGet(projectSecretsKey(projectId)))?.trim());
}
