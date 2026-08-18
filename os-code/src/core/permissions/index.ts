// Permission engine. The rhythm a Claude Code user knows: reads flow, writes
// ask with a diff, shell asks with the exact command, and anything that spends
// cloud quota gets its own distinct confirmation.
import { minimatch } from '../util/minimatch.js';
import type { SecurityProfile } from '../security/profiles.js';

/** What a tool can do to you, coarse-grained for policy. */
export type ToolRisk = 'read' | 'write' | 'shell' | 'network' | 'push' | 'cloud-spend';

export type Decision = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  /** Tool name or '*' for every tool of the risk class. */
  tool: string;
  decision: Decision;
  /** Optional glob the primary path argument must match (writes and edits). */
  pathGlob?: string;
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
  /** Workspace root, used for the trusted-repo check. */
  cwd?: string;
}

export interface PermissionResult {
  decision: Decision;
  /** One human sentence explaining the decision, shown in approval prompts. */
  reason: string;
}

export class PermissionEngine {
  private sessionAllows = new Set<string>();

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

  decide(q: PermissionQuery): PermissionResult {
    // Session grants never apply to shell or cloud spend on restrictive profiles.
    if (this.sessionAllows.has(q.toolName)) {
      const shellBlocked = q.risk === 'shell' && this.profile && !this.profile.allowShellAutoApprove;
      const cloudBlocked = q.risk === 'cloud-spend' && this.profile && !this.profile.allowCloudAutoApprove;
      if (!shellBlocked && !cloudBlocked) {
        return { decision: 'allow', reason: 'allowed for this session' };
      }
    }

    for (const rule of this.config.rules) {
      if (rule.tool !== '*' && rule.tool !== q.toolName) continue;
      if (rule.pathGlob) {
        if (!q.path || !minimatch(q.path, rule.pathGlob)) continue;
      }
      return { decision: rule.decision, reason: `permission rule for ${rule.tool}` };
    }

    if (q.risk === 'write' && q.cwd && this.config.trustedRepos.includes(q.cwd)) {
      return { decision: 'allow', reason: 'trusted repo, writes flow without asking' };
    }

    const decision = this.config.defaults[q.risk];
    return { decision, reason: `default for ${q.risk} tools` };
  }
}
