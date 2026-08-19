// App-level models. Every conversation, whatever powers it, renders through
// the same ThreadState so the UI has exactly one chat implementation.
import type { ApprovalRequest } from 'os-code/protocol';
import { isHarbor } from '../lib/harbor.js';

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

export function sourceLabel(source: ConversationSource): string {
  switch (source.kind) {
    case 'desktop':
      return source.repoName ? `Desktop · ${source.repoName}` : 'Desktop stack';
    case 'device':
      return isHarbor(source.modelId)
        ? 'Harbor · built-in guide'
        : `On this ${isProbablyPhone() ? 'iPhone' : 'device'} · ${source.modelName}`;
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
