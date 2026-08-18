// Agent events and approval contracts. The TUI, the plain renderer, and the
// daemon all consume this one event stream; approvals flow the other way
// through the Approver callback.
import type { ToolRisk } from '../permissions/index.js';
import type { Citation, ToolOutput } from '../tools/index.js';
import type { ParsedToolCall } from '../tools/parser.js';

export interface ApprovalRequest {
  id: string;
  kind: 'tool' | 'cloud-spend';
  toolName: string;
  risk: ToolRisk;
  /** One line: the exact command, the file and diff stats, the spend estimate. */
  summary: string;
  /** Diff or detail block. */
  detail?: string;
}

export interface ApprovalAnswer {
  approve: boolean;
  /** Ask again next time, or allow this tool for the rest of the session. */
  alwaysThisSession?: boolean;
}

export type Approver = (request: ApprovalRequest) => Promise<ApprovalAnswer>;

export type StopReason =
  | 'complete'
  | 'guardrail'
  | 'aborted'
  | 'declined'
  | 'error';

export type AgentEvent =
  | { type: 'task-start'; input: string }
  | { type: 'turn-start'; turn: number; model: string; providerKind: 'local' | 'cloud' }
  | { type: 'text-delta'; text: string }
  | { type: 'text-final'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-start'; call: ParsedToolCall }
  | { type: 'tool-end'; call: ParsedToolCall; result: ToolOutput; durationMs: number }
  | { type: 'tool-denied'; call: ParsedToolCall; reason: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'status'; message: string }
  | { type: 'note'; message: string }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      dollars: number;
      contextPercent: number;
    }
  | { type: 'model-switch'; model: string; providerKind: 'local' | 'cloud'; reason: string }
  | { type: 'task-done'; reason: StopReason; message?: string };

export type EventSink = (event: AgentEvent) => void;
