// App-level models. Every conversation, whatever powers it, renders through
// the same ThreadState so the UI has exactly one chat implementation.
import type { ApprovalRequest } from 'os-code/protocol';
import type { BuildStatus } from '../lib/codemagic.js';
import type { AccountType, PlanTierId } from '../lib/plans.js';
import { isHarbor } from '../lib/harbor.js';
import { isHarborMini } from '../lib/harborMini.js';

export type ThreadItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: string;
      name: string;
      summary: string;
      state: 'running' | 'ok' | 'fail' | 'denied';
      durationMs?: number;
      detail?: string;
    }
  | { kind: 'status'; id: string; text: string }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'stopped'; id: string; message: string };

export interface CitationItem {
  title: string;
  url: string;
}

export interface ThreadState {
  items: ThreadItem[];
  citations: CitationItem[];
  busy: boolean;
  /** Active model shown in the top bar, updated by turn-start events. */
  model?: { name: string; kind: 'local' | 'cloud' };
  contextPercent: number;
  dollars: number;
  pendingApprovals: ApprovalRequest[];
  /** Highest daemon sequence number seen, for SSE resume. */
  lastSeq: number;
}

export function emptyThread(): ThreadState {
  return {
    items: [],
    citations: [],
    busy: false,
    contextPercent: 0,
    dollars: 0,
    pendingApprovals: [],
    lastSeq: 0,
  };
}

/** Where a conversation's brain lives. */
export type ConversationSource =
  | { kind: 'desktop'; sessionId?: string; cwd?: string; repoName?: string }
  | { kind: 'device'; modelId: string; modelName: string }
  | { kind: 'cloud'; provider: 'anthropic'; model: string }
  | { kind: 'stack' }
  | { kind: 'mock' };

export interface Conversation {
  id: string;
  title: string;
  source: ConversationSource;
  /** The project this chat belongs to, if any. */
  projectId?: string;
  /** A throwaway quick chat: never persisted, gone when it closes. */
  ephemeral?: boolean;
  /** Explicitly unfiled (its project was deleted), as opposed to a legacy chat
   *  that predates projects. The init orphan-migration adopts only the latter,
   *  so an intentionally unfiled chat is never re-adopted on the next launch. */
  unfiled?: boolean;
  createdAt: string;
  updatedAt: string;
  thread: ThreadState;
}

// A project buckets related chats and keeps their context together. Repos can
// be shared across projects, so what was built is available where it is needed.
export interface Project {
  id: string;
  name: string;
  /** Standing instructions/context injected into every chat in the project. */
  instructions?: string;
  /** Repos attached to this project (shareable across projects). */
  repoIds: string[];
  createdAt: string;
}

// One member of "My Crew": a user-authored agent with a name, a persona, and a
// rule for how and when it is called. Crew members can be scoped to specific
// projects, or left to run across all of them.
export type CrewActivityLevel = 'review' | 'auto' | 'request';

export interface CrewAgent {
  id: string;
  name: string;
  /** Who this agent is and how it should think and speak. */
  persona: string;
  /** How and when the agent is brought in, in the user's own words. */
  whenCalled?: string;
  /**
   * review  - runs automatically before a feature deploys (build review).
   * auto    - the Reasoning LLM may call it on its own when useful.
   * request - dormant until the user asks for it by name in chat.
   */
  activityLevel: CrewActivityLevel;
  /** Projects this agent is active in. Empty means all projects. */
  projectIds: string[];
  createdAt: string;
}

// Account and organization. OpenShore is used solo (Personal) or by a company
// (Commercial). A commercial org has an admin who provisions members by email
// and owns the shared stack and storage locations. Members use everything else
// as their own (chats, projects, crew), but see the stack read-only.
//
// IMPORTANT: this model is a local-first scaffold. Client-side roles are a UX
// affordance, not a security boundary. Real identity, billing, and role
// enforcement must live server-side later; the shapes here are chosen so a
// backend can enforce them without a rewrite.
export type OrgRole = 'admin' | 'member';

export interface OrgMember {
  id: string;
  email: string;
  displayName?: string;
  role: OrgRole;
  addedAt: string;
  /** The org_members row id on the server, once this member is synced. */
  serverId?: string;
  /** Server seat state: 'invited' until the person signs in and claims it. */
  status?: 'invited' | 'active';
}

export interface Org {
  id: string;
  name: string;
  /** Raw declared seat count; drives the plan band (see plans.ts). */
  seatCount: number;
  /** Plan snapshot chosen at signup, persisted so pricing stays auditable. */
  tierId: PlanTierId;
  /** Priced snapshot in whole dollars/year at signup (auditable). */
  priceYear: number;
  members: OrgMember[];
  createdAt: string;
  /** The orgs row id on the server, once this org is synced. */
  serverId?: string;
}

/** The org's billing entitlement, written by the Stripe webhook and read here.
 *  The status vocabulary mirrors the server constraint (webhook-owned); only
 *  'active'/'trialing' grant paid access (see isEntitled in store.ts). */
export interface Entitlement {
  tierId: string;
  status:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'unpaid'
    | 'canceled'
    | 'incomplete'
    | 'incomplete_expired'
    | 'paused';
  /** ISO end of the current paid period, when known. */
  validUntil?: string;
}

export interface Account {
  type: AccountType;
  /** The commercial org, when type is 'commercial'. */
  org?: Org;
  /** The email this device signed in as (which member "I" am). */
  selfEmail?: string;
  /** Admin-only preview of the member (read-only) experience. */
  previewAsMember?: boolean;
}

// Launch: getting a built app to the App Store or Google Play through
// Codemagic, guided from inside the app. A target names the Codemagic app and
// workflow; each build attempt is a run whose result the model reads directly.
// The status vocabulary is owned by the Codemagic client (one source of truth).
export interface LaunchTarget {
  id: string;
  platform: 'ios' | 'android';
  /** Codemagic application id. */
  appId: string;
  /** Codemagic workflow id within that app. */
  workflowId: string;
  branch: string;
  label?: string;
}

export interface BuildRun {
  id: string;
  buildId?: string;
  status: BuildStatus;
  startedAt: string;
  finishedAt?: string;
  /** Redacted, extracted log excerpt for a failed build (model-ready). */
  excerpt?: string;
  /** The chat where the model diagnosed this run, if opened. */
  diagnosisConvId?: string;
  error?: string;
}

export interface LaunchState {
  target?: LaunchTarget;
  runs: BuildRun[];
}

export function sourceLabel(source: ConversationSource): string {
  switch (source.kind) {
    case 'desktop':
      return source.repoName ? `Desktop · ${source.repoName}` : 'Desktop stack';
    case 'device':
      if (isHarborMini(source.modelId)) return 'Harbor Mini · built-in guide';
      if (isHarbor(source.modelId)) return 'Harbor · built-in guide';
      return `On this ${isProbablyPhone() ? 'iPhone' : 'device'} · ${source.modelName}`;
    case 'cloud':
      return `Claude · ${source.model}`;
    case 'stack':
      return 'Your stack';
    case 'mock':
      return 'Demo';
  }
}

function isProbablyPhone(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

// One prior turn handed to a freshly built driver so a mid-chat model switch
// carries the conversation forward, the way Claude keeps the thread when you
// change models. Only the spoken turns cross over; tool/status/note artifacts
// are execution detail the new model does not need.
export interface SeedTurn {
  role: 'user' | 'assistant';
  text: string;
}

export function seedFromTranscript(items: ThreadItem[]): SeedTurn[] {
  const out: SeedTurn[] = [];
  for (const it of items) {
    if (it.kind === 'user') out.push({ role: 'user', text: it.text });
    else if (it.kind === 'assistant' && it.text.trim())
      out.push({ role: 'assistant', text: it.text });
  }
  return out;
}

// Can this brain actually see an attached image? Resolved at send time, per the
// CTO's ruling: default false everywhere, opt in only where vision genuinely
// works, so an image is never silently dropped into a text-only model. Today
// that is Claude on its own driver (every current Claude 5 model reads images).
// Extend here when a direct BYOM/OpenAI/Gemini vision chat or a vision pocket
// model lands, or when the desktop daemon carries image blocks; keep the
// default false.
export function sourceSupportsVision(source?: ConversationSource): boolean {
  if (!source) return false;
  return source.kind === 'cloud' && source.provider === 'anthropic';
}
