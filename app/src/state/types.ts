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
  | { kind: 'mock' };

export interface Conversation {
  id: string;
  title: string;
  source: ConversationSource;
  createdAt: string;
  updatedAt: string;
  thread: ThreadState;
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
    case 'mock':
      return 'Demo';
  }
}

function isProbablyPhone(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
}
