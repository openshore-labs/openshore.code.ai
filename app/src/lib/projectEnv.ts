// Project Wayfinder's environment variables (founder, 2026-10-27), the app's
// half. A project's variables are kept as the `.env` text the person typed,
// sealed on this device (the store projectSecrets.ts uses), never in
// settings, never synced to another device and never in a vault or a repo.
// They leave this device only for the machine the project runs on, when a
// coding session opens there (the person's own computer or server, over the
// tailnet), where they are set on the commands that session runs and a
// secret-looking value is cut from what the model reads back.
import { parseEnvText } from 'os-code/protocol';
import { secretDelete, secretGet, secretSet } from './platform.js';

/** The sealed-store key for a project's variables, by id so a rename keeps
 *  them. */
export function projectEnvKey(projectId: string): string {
  return `oscode.projectEnv.${projectId}`;
}

/** The project's `.env` text, or '' when none is kept. */
export async function readProjectEnvText(projectId: string): Promise<string> {
  return (await secretGet(projectEnvKey(projectId)).catch(() => null)) ?? '';
}

/** Keep the project's `.env` text; empty text deletes the entry. */
export async function writeProjectEnvText(projectId: string, text: string): Promise<void> {
  const key = projectEnvKey(projectId);
  if (!text.trim()) {
    await secretDelete(key);
    return;
  }
  await secretSet(key, text);
}

/** The project's variables, ready for a session create, or undefined when
 *  it has none. */
export async function projectEnvFor(
  projectId: string,
): Promise<Record<string, string> | undefined> {
  const { env } = parseEnvText(await readProjectEnvText(projectId));
  return Object.keys(env).length ? env : undefined;
}
