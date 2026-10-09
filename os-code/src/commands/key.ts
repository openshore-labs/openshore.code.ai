// osc key: keep a provider's API key on this machine for its coding sessions
// (keys on your server, founder 2026-10-09). The key is read from the terminal
// without echo, or from a pipe, and never from the command line, where ps and
// the shell history would keep it. It is stored the way the daemon's key
// routes store it (auth/providerKeys.ts), so a key added over SSH never
// passes through a phone, and the next session picks it up with no restart.
// Nothing checks it with the provider; the first session that uses it does.
import { t } from '../brand/theme.js';
import {
  KNOWN_PROVIDERS,
  listProviderKeys,
  putProviderKey,
  removeProviderKey,
  scrubSecrets,
} from '../auth/providerKeys.js';
import { isProviderId } from '../config/providerKeyRef.js';
import {
  SecretCancelled,
  header,
  okLine,
  out,
  readSecret,
  warnLine,
  type SecretIo,
} from './util.js';

/** The server's own account, as install-server.sh makes it. */
export const SERVER_ACCOUNT_PREFIX = 'sudo -u openshore env HOME=/var/lib/openshore';

/** `osc key --help`: where a server's keys must go, and how to pipe one. */
export const KEY_HELP = [
  '',
  "On a server, run it as the server's own account, so its sessions find the key:",
  `  ${SERVER_ACCOUNT_PREFIX} osc key add openrouter`,
  '',
  'The key is read from this terminal (nothing shows as you paste it) or from a pipe:',
  `  printf '%s' "$OPENROUTER_API_KEY" | ${SERVER_ACCOUNT_PREFIX} osc key add openrouter`,
  '',
  `Known providers (no --base-url needed): ${Object.keys(KNOWN_PROVIDERS).join(', ')}.`,
  'Keys serve coding sessions here. Crew routines and the free chat stay on a local model.',
].join('\n');

const ID_HINT = 'A provider id is lower-case letters, numbers and dashes, like openrouter.';

export interface KeyAddOptions {
  baseUrl?: string;
  label?: string;
  workspace?: string;
}

export async function keyAddCommand(
  id: string,
  options: KeyAddOptions = {},
  io?: SecretIo,
): Promise<void> {
  if (!isProviderId(id)) {
    warnLine(ID_HINT);
    process.exitCode = 1;
    return;
  }
  const known = KNOWN_PROVIDERS[id];
  if (!known && !options.baseUrl) {
    warnLine(
      `OpenShore does not know where ${id} answers. Add --base-url with its OpenAI-compatible address, the base its API docs give (it often ends in /v1).`,
    );
    process.exitCode = 1;
    return;
  }
  const label = options.label?.trim() || known?.label || id;
  const tty = (io?.stdin ?? process.stdin).isTTY === true;
  if (tty) {
    header(`Add a ${label} key`);
    out(t.text(`Paste your ${label} API key. Nothing shows as you paste it.`));
    out(
      t.muted(
        'It is stored on this machine only, sent only to that provider, and used by the coding sessions here. OpenShore does not check it; the first session that uses it shows whether it works.',
      ),
    );
  }
  let key: string;
  try {
    key = await readSecret('API key:', io);
  } catch (err) {
    if (err instanceof SecretCancelled) {
      process.exitCode = 130;
      return;
    }
    warnLine((err as Error).message);
    process.exitCode = 1;
    return;
  }
  if (!key) {
    warnLine('Nothing entered, nothing changed.');
    return;
  }
  try {
    const row = putProviderKey(id, {
      key,
      baseUrl: options.baseUrl,
      label: options.label,
      workspaceId: options.workspace,
    });
    const where = row.backend === 'keychain' ? 'the OS keychain' : 'the encrypted local store';
    okLine(`The ${row.label} key is stored on this machine, in ${where}.`);
    out();
    out(t.muted('Place one of its models for the sessions here, as this same account:'));
    out(`  osc stack use <model> ${row.id}`);
  } catch (err) {
    warnLine(scrubSecrets((err as Error).message, key));
    process.exitCode = 1;
  }
}

export function keyListCommand(): void {
  let rows;
  try {
    rows = listProviderKeys();
  } catch (err) {
    warnLine(scrubSecrets((err as Error).message));
    process.exitCode = 1;
    return;
  }
  header('Provider keys on this machine');
  if (!rows.length) {
    warnLine('None yet. Add one with: osc key add <provider>');
    return;
  }
  for (const row of rows) okLine(`${row.id.padEnd(12)} ${row.label}  ${t.muted(row.host)}`);
}

export function keyRemoveCommand(id: string): void {
  if (!isProviderId(id)) {
    warnLine(ID_HINT);
    process.exitCode = 1;
    return;
  }
  try {
    const label = listProviderKeys().find((r) => r.id === id)?.label ?? KNOWN_PROVIDERS[id]?.label;
    const gone = removeProviderKey(id);
    if (!gone.removed.length) {
      warnLine(`No ${label ?? id} key is kept on this machine.`);
      return;
    }
    okLine(`The ${label ?? id} key is gone from this machine.`);
    if (gone.slotsCleared.length) {
      out(
        t.muted(
          `Its models are off your stack (${gone.slotsCleared.join(', ')}). Choose another in OpenShore, or with:`,
        ),
      );
      out('  osc stack use <model> <provider>');
    }
  } catch (err) {
    warnLine(scrubSecrets((err as Error).message));
    process.exitCode = 1;
  }
}
