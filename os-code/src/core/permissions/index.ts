// Permission engine. The rhythm a Claude Code user knows: reads flow, writes
// ask with a diff, shell asks with the exact command, and anything that spends
// cloud quota gets its own distinct confirmation.
import { posix } from 'node:path';
import { minimatch } from '../util/minimatch.js';
import type { SecurityProfile } from '../security/profiles.js';
import { PROJECT_MEMORY_WRITE_TOOL, isMemoryFilePath } from '../agent/projectMemory.js';

/** What a tool can do to you, coarse-grained for policy. */
export type ToolRisk = 'read' | 'write' | 'shell' | 'network' | 'push' | 'cloud-spend';

export type Decision = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  /** Tool name or '*' for every tool of the risk class. */
  tool: string;
  decision: Decision;
  /** Optional glob the primary path argument must match (writes and edits). */
  pathGlob?: string;
  /** For shell rules: the first word every segment of the command must start
   *  with, exactly (see commandMatchesPrefix). */
  commandPrefix?: string;
}

/**
 * Commands that hand control to another program or shell. A prefix rule for
 * one of these would allow anything, so they never match and are never saved
 * as a prefix (ENG-4).
 */
export const SHELL_WRAPPERS: ReadonlySet<string> = new Set([
  'env',
  'sudo',
  'bash',
  'sh',
  'zsh',
  'eval',
  'exec',
  'source',
  '.',
  'xargs',
  'nohup',
  'time',
  'command',
  'nice',
  'doas',
  'su',
]);

/** The boundaries between the simple commands of a shell line. */
const SEGMENT_SPLIT = /\n|;|&&|\|\||\||&/;

/**
 * Does every simple command in `command` start with exactly `prefix`?
 * Segments are split on `;`, `&&`, `||`, `|`, `&`, and newlines. A segment
 * with command substitution (`$(` or a backtick) or a shell-wrapper first
 * word never matches, because its real command is something else.
 */
export function commandMatchesPrefix(command: string, prefix: string): boolean {
  if (!prefix || SHELL_WRAPPERS.has(prefix)) return false;
  const segments = command
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segments.length) return false;
  return segments.every((segment) => {
    if (segment.includes('$(') || segment.includes('`')) return false;
    const first = segment.split(/\s+/)[0] ?? '';
    return first === prefix && !SHELL_WRAPPERS.has(first);
  });
}

export interface PermissionConfig {
  /** Baseline decision per risk class. */
  defaults: Record<ToolRisk, Decision>;
  /** Fine-grained overrides, evaluated top down, first match wins. */
  rules: PermissionRule[];
  /** Repos the user marked trusted: writes inside them flow without asking. */
  trustedRepos: string[];
}

export const DEFAULT_PERMISSIONS: PermissionConfig = {
  defaults: {
    read: 'allow',
    network: 'allow', // web search and fetch, still governed by the egress policy
    write: 'ask',
    shell: 'ask',
    push: 'ask',
    'cloud-spend': 'ask',
  },
  rules: [],
  trustedRepos: [],
};

export interface PermissionQuery {
  toolName: string;
  risk: ToolRisk;
  /** Primary path argument, when the tool has one. */
  path?: string;
  /** The shell command, when the tool runs one (prefix-scoped rules). */
  command?: string;
  /** Workspace root, used for the trusted-repo check. */
  cwd?: string;
  /** The tool declared it must always ask. Overrides every auto-allow path. */
  alwaysAsk?: boolean;
}

export interface PermissionResult {
  decision: Decision;
  /** One human sentence explaining the decision, shown in approval prompts. */
  reason: string;
}

export class PermissionEngine {
  private sessionAllows = new Set<string>();
  /** Scoped allows granted during this session ("always in this project"
   *  before the config is reloaded). Evaluated after the config rules, so a
   *  configured deny still wins. */
  private sessionRules: PermissionRule[] = [];

  constructor(
    private readonly config: PermissionConfig = DEFAULT_PERMISSIONS,
    private readonly profile?: SecurityProfile,
  ) {}

  /** Grant "always allow for this session" for one tool. Profile-gated. */
  allowForSession(toolName: string): boolean {
    if (this.profile && !this.profile.allowSessionAutoApprove) return false;
    this.sessionAllows.add(toolName);
    return true;
  }

  /** Add a scoped rule for the rest of this session. Profile-gated the same
   *  way as a session grant; the restrictive-profile check on shell and cloud
   *  allows applies at decision time as for every rule. */
  addSessionRule(rule: PermissionRule): boolean {
    if (this.profile && !this.profile.allowSessionAutoApprove) return false;
    this.sessionRules.push(rule);
    return true;
  }

  /** On a restrictive profile, no allow (session grant, rule, or configured
   *  default) may make a shell, push, or cloud-spend step silent. */
  private autoAllowBlocked(risk: ToolRisk): boolean {
    if (!this.profile) return false;
    if (risk === 'shell') return !this.profile.allowShellAutoApprove;
    if (risk === 'cloud-spend') return !this.profile.allowCloudAutoApprove;
    if (risk === 'push') return !this.profile.allowPushAutoApprove;
    return false;
  }

  decide(q: PermissionQuery): PermissionResult {
    // An always-ask tool prompts every time, before any auto-allow path: no
    // session grant, permission rule, or trusted repo can make it silent. This
    // is the "never silent" guarantee for agent vault writes.
    if (q.alwaysAsk) {
      return { decision: 'ask', reason: 'this action always asks first' };
    }

    // Belt and braces under the loop's jail-based normalization (ENG-3): a
    // dotted spelling (`./secrets/k`, `src/../secrets/k`) must match the same
    // globs as the plain one, whoever built the query.
    const path = q.path === undefined ? undefined : posix.normalize(q.path);

    // Narrow, built-in exception (founder ruling): the coding agent keeps each
    // project's five memory notes current, and those writes land silently but
    // visibly. Only this dedicated tool, and only a managed memory file under
    // Projects/<project>/, is auto-allowed here; every general vault write stays
    // always-ask above. The write tool is itself hard-scoped to those five
    // files, so this is defense in depth, not the only guard.
    if (q.toolName === PROJECT_MEMORY_WRITE_TOOL && path !== undefined && isMemoryFilePath(path)) {
      return { decision: 'allow', reason: 'project memory note, kept current by the agent' };
    }

    // Session grants never apply to shell or cloud spend on restrictive profiles.
    if (this.sessionAllows.has(q.toolName) && !this.autoAllowBlocked(q.risk)) {
      return { decision: 'allow', reason: 'allowed for this session' };
    }

    for (const rule of [...this.config.rules, ...this.sessionRules]) {
      if (rule.tool !== '*' && rule.tool !== q.toolName) continue;
      if (rule.pathGlob) {
        if (!path || !minimatch(path, rule.pathGlob)) continue;
      }
      if (rule.commandPrefix) {
        if (!q.command || !commandMatchesPrefix(q.command, rule.commandPrefix)) continue;
      }
      // A configured allow is no louder than a session grant: on the phone or
      // headless profile it cannot make shell or cloud spend silent (ENG-4).
      if (rule.decision === 'allow' && this.autoAllowBlocked(q.risk)) continue;
      return { decision: rule.decision, reason: `permission rule for ${rule.tool}` };
    }

    if (q.risk === 'write' && q.cwd && this.config.trustedRepos.includes(q.cwd)) {
      return { decision: 'allow', reason: 'trusted repo, writes flow without asking' };
    }

    const decision = this.config.defaults[q.risk];
    // The configured default is no louder than a rule: a config that sets
    // shell (or push, or cloud spend) to allow cannot make it silent on the
    // phone or headless profile. A routine running at 3am asks, or is denied
    // when no one answers; it never runs a shell command unattended (the CTO's
    // must-fix for unattended crew).
    if (decision === 'allow' && this.autoAllowBlocked(q.risk)) {
      return {
        decision: 'ask',
        reason: `${q.risk} never runs silently on the ${this.profile?.name ?? 'restricted'} profile`,
      };
    }
    return { decision, reason: `default for ${q.risk} tools` };
  }
}
