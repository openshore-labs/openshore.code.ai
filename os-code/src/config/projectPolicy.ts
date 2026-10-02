// Project trust, the policy half (v1 Phase 0; docs/zed-proposal.md "Fix now").
//
// A repository's own os-code.config.json is read as a proposal, not as the
// person's settings. Every key it can carry is classified here, once:
//
//   project  applies from any folder: it only shapes prompts or display.
//   tighten  applies from any folder when it makes OpenShore stricter (a
//            lower limit, a feature switched off, an ask or deny rule); a
//            loosening waits until the person trusts the folder.
//   trusted  applies only once the person trusts the folder on this machine
//            (its check command, its model choices, its allow rules).
//   machine  never comes from a project file, trusted or not: where model
//            servers live, which environment variables hold keys, the vault
//            folder, the catalog. A repo that could set these could send the
//            person's key or code to a host of its choosing.
//
// The trust record itself lives on the machine (trust.ts), never in the repo.
// `test/projectTrust.test.ts` holds one test per attack vector, and a guard
// test fails on any schema key this table does not classify.
import type { OscConfig } from './schema.js';

type Leaf = 'project' | 'trusted' | 'machine' | 'off-only' | 'lower-only';
type Special = 'egress' | 'permissions';
export type KeyPolicy = Leaf | Special | { [key: string]: KeyPolicy };

export const PROJECT_POLICY: Record<keyof OscConfig, KeyPolicy> = {
  providers: 'machine',
  imageGen: 'machine',
  stack: 'trusted',
  routing: {
    mode: 'trusted',
    escalation: { enabled: 'off-only', afterToolFailures: 'trusted', onModelRequest: 'trusted' },
  },
  resourceBudget: 'trusted',
  search: {
    backend: 'trusted',
    searxngUrl: 'trusted',
    braveKeyEnv: 'machine',
    tavilyKeyEnv: 'machine',
    perplexityKeyEnv: 'machine',
    resultCount: 'trusted',
    fetchMaxChars: 'trusted',
  },
  egress: 'egress',
  permissions: 'permissions',
  guardrails: {
    maxSteps: 'lower-only',
    maxRepeats: 'lower-only',
    wallClockSeconds: 'lower-only',
    maxTokens: 'lower-only',
    maxDollars: 'lower-only',
  },
  // The daemon's bind, its outbox roots, its session retention (H1), and the
  // push host are this computer's: a repo can neither keep sessions longer or
  // shorter nor point a push grant at a host of its choosing.
  daemon: 'machine',
  catalog: 'machine',
  license: 'machine',
  ui: 'project',
  // Whether a Crew routine may search the web is the person's own switch,
  // never a repo's (founder, 2026-10-01).
  routines: { webSearch: 'machine' },
  // The vault folder and which notes are hidden or stay on this computer are
  // the person's own (a repo never names their private folders); the context
  // pack may only be turned off from a project (Vault M4, CTO I3), and so may
  // the handoff (Vault M5, CTO J18). Room for notes, its ceiling and
  // provenance are the machine's own (Vault M7, CTO L14): a repo never sends
  // more of the person's notes, and never hides who wrote one.
  vault: {
    dir: 'machine',
    exclude: 'machine',
    localOnly: 'machine',
    context: 'off-only',
    handoff: 'off-only',
    packSize: 'machine',
    packMaxTokens: 'machine',
    provenance: 'machine',
  },
  ux: 'project',
  humanizer: 'project',
  chainOfThought: { enabled: 'off-only' },
  // On, projectMemoryWrite saves into the repo without asking, so turning it
  // on is a loosening; turning it off applies from any folder.
  memory: { enabled: 'off-only' },
  sync: { autoPush: 'off-only', autoPushDefaultBranch: 'trusted' },
  // The two harness lifts (CTO 6) cost time on this computer (prefill, and
  // grammar sampling on a CPU), so like Chain of Thought a project may turn
  // them off from any folder and on only once trusted.
  harness: {
    profiles: 'project',
    decoding: { constrainForSmallModels: 'project', union: 'off-only' },
    retrieval: { firstTurn: 'off-only' },
    verify: 'trusted',
  },
  // A process the agent starts keeps running after its step, so turning the
  // tools on over a machine that has them off waits for trust; turning them
  // off applies from any folder.
  tools: { processes: 'off-only', webFetch: 'machine' },
};

/** A project setting that was not applied, and why. */
export interface SetAside {
  /** Dotted path in the config, e.g. "harness.verify". */
  path: string;
  /** One plain sentence fragment for the person, e.g. "runs `npm test` ...". */
  plain: string;
  /** True when trusting the folder would apply it; false for machine config. */
  trustable: boolean;
}

export interface PermissionRuleLike {
  tool: string;
  decision: 'allow' | 'ask' | 'deny';
  pathGlob?: string;
  commandPrefix?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v;
    return out;
  }
  return over === undefined ? base : over;
}

const RISK_NOUN: Record<string, string> = {
  read: 'file reads',
  network: 'network requests',
  write: 'edits',
  shell: 'commands',
  push: 'pushes',
  'cloud-spend': 'cloud spending',
};

const RANK: Record<string, number> = { allow: 0, ask: 1, deny: 2 };

function hostOf(url: unknown): string {
  if (typeof url !== 'string') return 'another server';
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** The plain words for one set-aside project value. */
function describe(path: string, value: unknown): string {
  const v = value as Record<string, unknown> | undefined;
  switch (path) {
    case 'harness.verify':
      return typeof v?.command === 'string'
        ? `runs \`${v.command}\` to check the agent's work after changes`
        : "changes how the agent's work is checked";
    case 'stack': {
      const orch = isPlainObject(v?.orchestrator) ? v.orchestrator : undefined;
      return orch && typeof orch.model === 'string'
        ? `picks its own models (${orch.model})`
        : 'picks its own models';
    }
    case 'routing.mode':
      return 'changes how steps are handed between models';
    case 'routing.escalation.enabled':
      return 'hands hard steps to a cloud model';
    case 'routing.escalation.afterToolFailures':
    case 'routing.escalation.onModelRequest':
      return 'changes when steps go to a cloud model';
    case 'resourceBudget':
      return 'changes how models load on this computer';
    case 'search.backend':
      return `sends web searches to ${String(value)}`;
    case 'search.searxngUrl':
      return `sends web searches to ${hostOf(value)}`;
    case 'search.resultCount':
    case 'search.fetchMaxChars':
      return 'changes web search limits';
    case 'sync.autoPushDefaultBranch':
      return 'pushes the main branch on its own';
    case 'sync.autoPush':
      return 'pushes commits on its own';
    case 'chainOfThought.enabled':
      return 'turns on Chain of Thought';
    case 'harness.decoding.union':
      return 'holds small models to a stricter reply format, which can make replies slower';
    case 'harness.retrieval.firstTurn':
      return 'reads matching code into each new task before the model starts, which makes the first reply slower';
    case 'vault.context':
      return value === 'full'
        ? 'turns on the full Vault context, so more of your notes reach the model'
        : 'turns the Vault context back on';
    case 'vault.handoff':
      return 'turns the handoff back on, so a summary of earlier work reaches the model';
    case 'memory.enabled':
      return 'turns on project memory, so the agent saves notes into this repo without asking';
    case 'tools.processes':
      return 'lets the agent start programs that keep running, like your app';
    case 'guardrails.maxDollars':
      return `raises the spending limit to $${String(value)}`;
    case 'guardrails.maxSteps':
      return `raises the step limit to ${String(value)}`;
    case 'guardrails.wallClockSeconds':
      return `raises the time limit to ${String(value)} seconds`;
    case 'guardrails.maxTokens':
      return `raises the token limit to ${String(value)}`;
    case 'guardrails.maxRepeats':
      return `allows more repeated steps (${String(value)})`;
    case 'egress.webEnabled':
      return 'turns web access on';
    default:
      return `changes ${path}`;
  }
}

function describeRule(rule: PermissionRuleLike): string {
  if (rule.tool === '*') return 'lets every step run without asking';
  if (rule.commandPrefix) return `lets \`${rule.commandPrefix}\` commands run without asking`;
  if (rule.pathGlob) return `lets ${rule.tool} run without asking in ${rule.pathGlob}`;
  return `lets ${rule.tool} run without asking`;
}

interface Walk {
  trusted: boolean;
  setAside: SetAside[];
  /** "Always allow in this project" grants from this machine's trust store. */
  grants: PermissionRuleLike[];
}

function isRule(v: unknown): v is PermissionRuleLike {
  return (
    isPlainObject(v) &&
    typeof v.tool === 'string' &&
    (v.decision === 'allow' || v.decision === 'ask' || v.decision === 'deny')
  );
}

function applyPermissions(base: unknown, project: unknown, walk: Walk): unknown {
  const b = (isPlainObject(base) ? base : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b };
  const p = isPlainObject(project) ? project : {};

  // Defaults: a stricter default applies from any folder; a looser one waits.
  if (isPlainObject(p.defaults)) {
    const baseDefaults = (isPlainObject(b.defaults) ? b.defaults : {}) as Record<string, string>;
    const nextDefaults: Record<string, unknown> = { ...baseDefaults };
    for (const [risk, value] of Object.entries(p.defaults)) {
      if (typeof value !== 'string' || !(value in RANK)) continue;
      const current = baseDefaults[risk] ?? 'ask';
      if (walk.trusted || RANK[value]! >= RANK[current]!) {
        nextDefaults[risk] = value;
      } else {
        const noun = RISK_NOUN[risk] ?? risk;
        walk.setAside.push({
          path: `permissions.defaults.${risk}`,
          plain:
            value === 'allow'
              ? `lets ${noun} run without asking`
              : `lets ${noun} ask instead of being refused`,
          trustable: true,
        });
      }
    }
    out.defaults = nextDefaults;
  }

  // Rules are first match wins. A project's ask and deny rules go first (they
  // can only make OpenShore stricter); then the person's own rules; then the
  // person's "always allow in this project" grants from this machine; then, only
  // for a trusted folder, the project's allow rules. A project's list never
  // replaces the person's rules, so it cannot drop their deny rules either.
  const projectRules = Array.isArray(p.rules) ? p.rules.filter(isRule) : [];
  const tighten = projectRules.filter((r) => r.decision !== 'allow');
  const allows = projectRules.filter((r) => r.decision === 'allow');
  const baseRules = Array.isArray(b.rules) ? b.rules.filter(isRule) : [];
  if (!walk.trusted) {
    for (const rule of allows) {
      walk.setAside.push({ path: 'permissions.rules', plain: describeRule(rule), trustable: true });
    }
  }
  out.rules = [...tighten, ...baseRules, ...walk.grants, ...(walk.trusted ? allows : [])];

  // Which repos may take writes without asking is the person's call alone.
  if ('trustedRepos' in p) {
    walk.setAside.push({
      path: 'permissions.trustedRepos',
      plain: machinePlain('permissions.trustedRepos'),
      trustable: false,
    });
  }
  return out;
}

function applyEgress(base: unknown, project: unknown, walk: Walk): unknown {
  const b = (isPlainObject(base) ? base : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b };
  const p = isPlainObject(project) ? project : {};

  if (typeof p.webEnabled === 'boolean') {
    if (walk.trusted || p.webEnabled === false || p.webEnabled === b.webEnabled) {
      out.webEnabled = p.webEnabled;
    } else {
      walk.setAside.push({
        path: 'egress.webEnabled',
        plain: describe('egress.webEnabled', true),
        trustable: true,
      });
    }
  }

  // A blocklist only ever narrows, so a project's entries always join it.
  const baseBlock = Array.isArray(b.blocklist) ? (b.blocklist as string[]) : [];
  if (Array.isArray(p.blocklist)) {
    const extra = p.blocklist.filter((h): h is string => typeof h === 'string');
    out.blocklist = [...new Set([...baseBlock, ...extra])];
  }

  // A non-empty allowlist restricts ("only these hosts"). From an untrusted
  // folder it may add a restriction where there was none, or narrow an existing
  // one to the hosts both lists share; it never adds a host the person's list
  // leaves out, and never empties a list (empty means "no restriction").
  if (Array.isArray(p.allowlist)) {
    const proposed = p.allowlist.filter((h): h is string => typeof h === 'string');
    const baseAllow = Array.isArray(b.allowlist) ? (b.allowlist as string[]) : [];
    if (walk.trusted) {
      out.allowlist = proposed;
    } else if (baseAllow.length === 0) {
      if (proposed.length) out.allowlist = proposed;
    } else {
      const shared = proposed.filter((h) => baseAllow.includes(h));
      if (shared.length) out.allowlist = shared;
      const added = proposed.filter((h) => !baseAllow.includes(h));
      if (added.length) {
        walk.setAside.push({
          path: 'egress.allowlist',
          plain: `lets the agent reach ${added.join(', ')}`,
          trustable: true,
        });
      }
    }
  }
  return out;
}

function machinePlain(path: string): string {
  return `${path} is this computer's own setting`;
}

function applyPolicy(
  policy: KeyPolicy,
  base: unknown,
  project: unknown,
  path: string,
  walk: Walk,
): unknown {
  if (policy === 'permissions') return applyPermissions(base, project, walk);
  if (policy === 'egress') return applyEgress(base, project, walk);
  if (typeof policy === 'object') {
    if (!isPlainObject(project)) return base;
    const out: Record<string, unknown> = { ...(isPlainObject(base) ? base : {}) };
    for (const [key, value] of Object.entries(project)) {
      const child = policy[key];
      if (child === undefined) continue; // Not a config key; the schema drops it too.
      out[key] = applyPolicy(child, out[key], value, `${path}.${key}`, walk);
    }
    return out;
  }
  switch (policy) {
    case 'project':
      return deepMerge(base, project);
    case 'trusted':
      if (walk.trusted) return deepMerge(base, project);
      walk.setAside.push({ path, plain: describe(path, project), trustable: true });
      return base;
    case 'machine':
      walk.setAside.push({ path, plain: machinePlain(path), trustable: false });
      return base;
    case 'off-only':
      // Off is `false` for a switch and `'off'` for a mode (vault.context).
      if (walk.trusted || project === false || project === 'off' || project === base) {
        return project;
      }
      walk.setAside.push({ path, plain: describe(path, project), trustable: true });
      return base;
    case 'lower-only':
      if (typeof project !== 'number') return base;
      if (walk.trusted || typeof base !== 'number' || project <= base) return project;
      walk.setAside.push({ path, plain: describe(path, project), trustable: true });
      return base;
  }
}

/**
 * The effective config for a folder: the person's own config with the
 * project file applied under the policy above. `trusted` is the machine's
 * trust record for this folder (trust.ts). `grants` are the person's "always
 * allow in this project" rules for this folder, from the same store.
 */
export function applyProjectConfig(
  base: OscConfig,
  project: unknown,
  trusted: boolean,
  grants: PermissionRuleLike[] = [],
): { config: Record<string, unknown>; setAside: SetAside[] } {
  const walk: Walk = { trusted, setAside: [], grants };
  const out: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  const p = isPlainObject(project) ? project : {};
  for (const [key, value] of Object.entries(p)) {
    const policy = PROJECT_POLICY[key as keyof OscConfig];
    if (policy === undefined) continue;
    out[key] = applyPolicy(policy, out[key], value, key, walk);
  }
  // Grants apply even when the folder has no project file at all.
  if (!('permissions' in p) && grants.length) {
    const perms = out.permissions as Record<string, unknown>;
    const rules = Array.isArray(perms.rules) ? perms.rules : [];
    out.permissions = { ...perms, rules: [...rules, ...grants] };
  }
  return { config: out, setAside: walk.setAside };
}

function stripForHash(policy: KeyPolicy, project: unknown): unknown {
  if (policy === 'project' || policy === 'machine') return undefined;
  if (typeof policy !== 'object' || !isPlainObject(project)) return project;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    const child = policy[key];
    if (child === undefined) continue;
    const kept = stripForHash(child, value);
    if (kept !== undefined) out[key] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The part of a project file that trust vouches for: everything but the
 * always-applied (prompt and display) keys and the machine-only keys, which
 * trust never changes. The trust record stores a digest of this, so a pull
 * that changes the check command or an allow rule asks again, while an edit
 * to the UX notes does not.
 */
export function trustableSubset(project: unknown): Record<string, unknown> {
  if (!isPlainObject(project)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    const policy = PROJECT_POLICY[key as keyof OscConfig];
    if (policy === undefined) continue;
    const kept = stripForHash(policy, value);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/** Canonical JSON (sorted keys), so the digest does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
