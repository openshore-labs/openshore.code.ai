// Context compaction for small local windows. Two stages, cheapest first:
//   1. Trim old tool observations down to a stub (the file can be re-read).
//   2. Summarize the oldest half of the conversation into one note, using the
//      orchestrator itself.
// The estimator is deliberately rough (4 chars per token) and errs high.
import type { ChatMessage } from '../providers/types.js';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessages(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => p.text ?? '[image]').join(' ');
    total += estimateTokens(text) + 8;
    if (m.toolCalls) total += estimateTokens(JSON.stringify(m.toolCalls));
  }
  return total;
}

const TRIMMED_NOTE =
  '[an earlier tool output was trimmed to save context; re-run the tool if it is needed again]';

/** The JSON-in-text bridge feeds observations back as user messages with this
 *  prefix (loop.ts pushObservation), so stage 1 must recognize them too. */
const TEXT_BRIDGE_OBSERVATION = /^\[[^\]\n]+ result\]\n/;

function isObservation(m: ChatMessage): boolean {
  if (m.role === 'tool') return true;
  return (
    m.role === 'user' && typeof m.content === 'string' && TEXT_BRIDGE_OBSERVATION.test(m.content)
  );
}

/** Stage 1: replace old, large tool observations with a stub. */
export function trimOldObservations(messages: ChatMessage[], keepRecent = 6): ChatMessage[] {
  const cutoff = Math.max(0, messages.length - keepRecent);
  return messages.map((m, i) => {
    if (i >= cutoff) return m;
    if (!isObservation(m)) return m;
    const text = typeof m.content === 'string' ? m.content : '';
    if (text.length <= 800) return m;
    return { ...m, content: `${text.slice(0, 400)}\n${TRIMMED_NOTE}` };
  });
}

export interface CompactionResult {
  messages: ChatMessage[];
  compacted: boolean;
}

/**
 * Bring the transcript under budget. `summarize` runs the model; when it
 * fails (offline, mid-restart) the fallback is dropping oldest turns with a
 * marker, which is honest and cheap.
 */
export async function compactHistory(
  messages: ChatMessage[],
  contextTokens: number,
  summarize: (text: string) => Promise<string>,
): Promise<CompactionResult> {
  const budget = Math.floor(contextTokens * 0.7);
  if (estimateMessages(messages) <= budget) return { messages, compacted: false };

  let out = trimOldObservations(messages);
  if (estimateMessages(out) <= budget) return { messages: out, compacted: true };

  // Keep the system prompt and the most recent exchanges; summarize the middle.
  const system = out.filter((m) => m.role === 'system');
  const rest = out.filter((m) => m.role !== 'system');
  const keepTail = 8;
  if (rest.length <= keepTail) return { messages: out, compacted: true };
  // The cut must never separate a tool result from the assistant call it
  // answers: an orphaned tool_result 400s the next Anthropic turn (ENG-6).
  // Start the tail on the next user message when one is near; failing that,
  // at least step past any leading tool results.
  let cut = rest.length - keepTail;
  const nextUser = rest.findIndex((m, i) => i >= cut && m.role === 'user');
  if (nextUser !== -1) cut = nextUser;
  else while (cut < rest.length && rest[cut]!.role === 'tool') cut += 1;
  const toSummarize = rest.slice(0, cut);
  const tail = rest.slice(cut);

  const transcript = toSummarize
    .map((m) => {
      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) => p.text ?? '[image]').join(' ');
      return `${m.role}: ${text.slice(0, 1500)}`;
    })
    .join('\n');

  let summary: string;
  try {
    summary = await summarize(
      `Summarize this coding-session history in under 300 words. Keep: the user's goal, decisions made, files touched and how, and anything still unresolved.\n\n${transcript}`,
    );
  } catch {
    summary =
      '(earlier turns were dropped to fit the context window; ask the user to restate anything missing)';
  }

  out = [
    ...system,
    {
      role: 'user',
      content: `[Conversation so far, summarized to fit the context window]\n${summary}`,
    },
    ...tail,
  ];
  return { messages: out, compacted: true };
}
