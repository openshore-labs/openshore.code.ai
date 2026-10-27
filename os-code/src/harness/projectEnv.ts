// Project Wayfinder (founder, 2026-10-27): every project carries its own
// environment, the way an environment is set up in Claude Code. Its standing
// instructions, its network access, its environment variables and a setup
// script. This is the pure half the app and the daemon share: the `.env`
// text a person types, the limits a session create is held to, and the
// network levels. Pure and Node-free (tenet 5), through os-code/protocol.

/** How much of the network a project's agent may reach through its own
 *  tools. A shell command is the shell's: copy never claims more. */
export type ProjectNetwork = 'full' | 'search' | 'none';

export const PROJECT_NETWORKS: readonly ProjectNetwork[] = ['full', 'search', 'none'];

export function isProjectNetwork(v: unknown): v is ProjectNetwork {
  return typeof v === 'string' && (PROJECT_NETWORKS as readonly string[]).includes(v);
}

/** The most variables one project carries. */
export const PROJECT_ENV_MAX_VARS = 100;
/** The longest value one variable carries. */
export const PROJECT_ENV_MAX_VALUE = 8_192;
/** The longest setup script a session create carries. */
export const SETUP_SCRIPT_MAX_CHARS = 16_384;

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function isEnvName(name: string): boolean {
  return NAME.test(name);
}

/** The variables in `.env` text: one `NAME=value` a line, `#` comments and
 *  blank lines skipped, an optional `export `, and a value in matching
 *  quotes unquoted. Lines that are not a variable are returned as `skipped`
 *  (their line numbers), so the sheet can say which. */
export function parseEnvText(text: string): {
  env: Record<string, string>;
  skipped: number[];
} {
  const env: Record<string, string> = {};
  const skipped: number[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!m || !isEnvName(m[1]!)) {
      skipped.push(i + 1);
      return;
    }
    let value = m[2]!;
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) {
      value = value.slice(1, -1);
    }
    if (value.length > PROJECT_ENV_MAX_VALUE || Object.keys(env).length >= PROJECT_ENV_MAX_VARS) {
      skipped.push(i + 1);
      return;
    }
    env[m[1]!] = value;
  });
  return { env, skipped };
}

/** A session create's variables: a plain object of string values under the
 *  limits, anything else dropped. Undefined when none are left. */
export function cleanProjectEnv(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= PROJECT_ENV_MAX_VARS) break;
    if (!isEnvName(name) || typeof value !== 'string') continue;
    if (value.length > PROJECT_ENV_MAX_VALUE) continue;
    out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A session create's setup script, or undefined when blank or too long. */
export function cleanSetupScript(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim() || v.length > SETUP_SCRIPT_MAX_CHARS) return undefined;
  return v;
}

/** The line the model reads about its project's network, or undefined for
 *  full access (nothing to say). */
export function projectNetworkNote(network: ProjectNetwork | undefined): string | undefined {
  if (network === 'search')
    return "This project's network access is search only: you may search the web, never open pages.";
  if (network === 'none')
    return "This project's network access is none: you do not search the web or open pages. Say so when that limits your answer.";
  return undefined;
}
