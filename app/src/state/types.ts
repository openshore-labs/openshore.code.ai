// App-level models. Every conversation, whatever powers it, renders through
// the same ThreadState so the UI has exactly one chat implementation.
import type { ApprovalRequest, PermissionMode } from 'os-code/protocol';
import type { BuildStatus } from '../lib/codemagic.js';
import type { AccountType, PlanTierId } from '../lib/plans.js';
import { isHarbor } from '../lib/harbor.js';
import { isHarborMini } from '../lib/harborMini.js';
import { claudeModelLabel } from '../lib/claudeModels.js';

export type ThreadItem =
  | { kind: 'user'; id: string; text: string }
  | {
      kind: 'assistant';
      id: string;
      text: string;
      streaming: boolean;
      /** The model that wrote this bubble, so a specialist's answer is named. */
      model?: string;
    }
  // The model's reasoning, collapsed to "Thought for Ns" and expandable.
  | {
      kind: 'thinking';
      id: string;
      text: string;
      streaming: boolean;
      startedAt: number;
      endedAt?: number;
    }
  // Plan mode's proposal, with the buttons that approve it or ask for changes.
  | { kind: 'plan'; id: string; text: string; status: 'proposed' | 'approved' | 'revising' }
  // The end-of-turn record of what changed, one row per file.
  | { kind: 'changed'; id: string; files: ChangedFile[] }
  | {
      kind: 'tool';
      id: string;
      name: string;
      summary: string;
      state: 'running' | 'ok' | 'fail' | 'denied';
      /** When the tool started, for the live elapsed counter. */
      startedAt?: number;
      durationMs?: number;
      /** The path this tool touched, when it has one (tap to open). */
      path?: string;
      /** Additions and deletions for an edit, once known. */
      stats?: { added: number; removed: number };
      detail?: string;
      // How to render `detail` when expanded: a unified diff (edit tools) gets
      // the +/- colorizing, plain command output is shown verbatim in a mono
      // block. Shell output run through the diff renderer mis-colors every line
      // that happens to start with + or -, so the kind is tracked explicitly.
      detailKind?: 'diff' | 'output';
    }
  | { kind: 'status'; id: string; text: string }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'stopped'; id: string; message: string }
  // A command the user ran through the chat-to-terminal bridge: its live output
  // streams in, then an exit badge. Distinct from a tool card (which is the
  // agent's own action) so the transcript reads as "I ran this," not "it did."
  | {
      kind: 'command';
      id: string;
      runId: string;
      command: string;
      output: string;
      state: 'running' | 'done' | 'killed';
      exitCode?: number | null;
      durationMs?: number;
      truncated?: boolean;
    };

export interface CitationItem {
  title: string;
  url: string;
}

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
  /** The tool card that holds the diff, for a tap-through. */
  toolItemId?: string;
}

export interface TodoRow {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface RepoInfo {
  cwd: string;
  branch?: string;
  dirty?: boolean;
}

export interface ThreadState {
  items: ThreadItem[];
  citations: CitationItem[];
  busy: boolean;
  /** When the current task started, for the working indicator's counter. */
  busySince?: number;
  /** What the agent is doing right now ("Thinking", "readFile src/x.ts"). */
  stepNote?: string;
  /** Active model shown in the top bar, updated by turn-start events. */
  model?: { name: string; kind: 'local' | 'cloud' };
  contextPercent: number;
  dollars: number;
  /** Tokens for the latest turn, shown in the turn footer. */
  lastTurn?: { promptTokens: number; completionTokens: number };
  pendingApprovals: ApprovalRequest[];
  /** The agent's live task list (todoWrite), replaced whole each update. */
  todos: TodoRow[];
  /** Messages typed while the agent was working, sent in order when it is free. */
  queued: string[];
  /** Files touched so far this task, folded into a card at task-done. */
  changedFiles: ChangedFile[];
  /** Where the session works and its branch, from repo-info events. */
  repo?: RepoInfo;
  /** The permission mode the engine reports for this session. */
  mode?: PermissionMode;
  /** A title the engine generated after the first exchange. */
  title?: string;
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
    todos: [],
    queued: [],
    changedFiles: [],
    lastSeq: 0,
  };
}

/** Where a conversation's brain lives. */
export type ConversationSource =
  | { kind: 'desktop'; sessionId?: string; cwd?: string; repoName?: string }
  // Free, read-only chat with the paired desktop's local models (no repo, no
  // tools, no agent). A distinct kind, not a flag on 'desktop', so it can never
  // reach the session-creating path that opens the full paid agent (CTO ruling).
  | { kind: 'desktop-chat'; model?: string }
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
  /** The repositories this chat works with (lib/chatRepos.ts ids: a workspace
   *  path or "github:owner/name"), picked in the header. Seeded from the
   *  project's repoIds when the chat starts; the chat keeps its own list. */
  repoIds?: string[];
  /** Explicitly unfiled (its project was deleted), as opposed to a legacy chat
   *  that predates projects. The init orphan-migration adopts only the latter,
   *  so an intentionally unfiled chat is never re-adopted on the next launch. */
  unfiled?: boolean;
  createdAt: string;
  updatedAt: string;
  thread: ThreadState;
  /** True once the person named this chat themselves, so the engine's
   *  generated title never overwrites a deliberate name. */
  renamed?: boolean;
  /** How many transcript items a desktop chat had at its last persist. The
   *  transcript itself lives in the engine journal; this shapes the resume
   *  skeleton so it matches what is about to replay. */
  lastItemCount?: number;
  /** True once any turn in this chat carried an image. The transcript stores
   *  only text, so a mid-chat model switch cannot carry images forward; this
   *  lets the switch disclose that earlier images are dropped from context. */
  hadVisionInput?: boolean;
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
    case 'desktop-chat':
      return 'Your desktop · chat';
    case 'device':
      if (isHarborMini(source.modelId)) return 'Harbor Mini · built-in guide';
      if (isHarbor(source.modelId)) return 'Harbor · built-in guide';
      return `On this ${isProbablyPhone() ? 'iPhone' : 'device'} · ${source.modelName}`;
    case 'cloud':
      return `Claude · ${claudeModelLabel(source.model)}`;
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
