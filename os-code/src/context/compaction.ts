// Context compaction for small local windows. Two stages, cheapest first:
//   1. Trim old tool observations down to a stub (the file can be re-read).
//   2. Summarize the oldest half of the conversation into one note, using the
//      orchestrator itself.
// The estimator is deliberately rough (4 chars per token): prose runs a little
// high and code a little low, each within about a quarter of the real count.
import type { ChatMessage, ToolSpec } from '../providers/types.js';
import { carriesLocalOnly } from '../harness/vault/privacy.js';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** What a chat template adds around each message: the role marker and the
 *  separators (Qwen's `<|im_start|>role\n ... <|im_end|>\n` is five). */
export const MESSAGE_TEMPLATE_TOKENS = 8;

/** What a chat template adds around the tool list when native tools ride
 *  along: the preamble that introduces the functions and tells the model how
 *  to call one. Qwen's runs to about 120 tokens. */
export const TOOLS_TEMPLATE_TOKENS = 120;

export function estimateMessages(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => p.text ?? '[image]').join(' ');
    total += estimateTokens(text) + MESSAGE_TEMPLATE_TOKENS;
    if (m.toolCalls) total += estimateTokens(JSON.stringify(m.toolCalls));
  }
  return total;
}

/** What the native tool specs sent with a request cost in the prompt: the
 *  server renders every spec into it (22 of them are about 3,600 tokens), so
 *  a budget that leaves them out overflows a small window. Zero with none
 *  (the text bridge carries its tools inside the system prompt, which
 *  `estimateMessages` already counts). */
export function estimateToolSpecs(tools: readonly ToolSpec[] | undefined): number {
  if (!tools?.length) return 0;
  const rendered = tools.map((t) => ({ type: 'function', function: t }));
  return TOOLS_TEMPLATE_TOKENS + estimateTokens(JSON.stringify(rendered));
}

/** A server that reads back less than this share of the estimate cut the
 *  prompt. The estimate runs within about a quarter of the real count either
 *  way, so 60 percent is past that noise; what is left is a window smaller
 *  than the prompt, with the server dropping the rest without a word. */
export const TRUNCATION_RATIO = 0.6;

/** Below this many estimated tokens the ratio is not read: every server
 *  serves at least this much, so a short prompt cannot have been cut. */
export const TRUNCATION_MIN_ESTIMATE = 1024;

/** Whether a served prompt count (`read`, what the server says it took in,
 *  cache reads and writes included) says the server cut a prompt the loop
 *  estimated at `estimated` tokens. A server that reports nothing (0) says
 *  nothing. Shared by the loop's notice and the eval's trace. */
export function looksTruncated(read: number, estimated: number): boolean {
  return read > 0 && estimated >= TRUNCATION_MIN_ESTIMATE && read < estimated * TRUNCATION_RATIO;
}

/** A compaction summary runs to about 300 words. Folding a stretch smaller
 *  than that saves nothing and costs a model call. */
const SUMMARY_TOKENS = 400;

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
 * marker, which is honest and cheap. `fraction` is the share of the window the
 * history may fill before it is compacted: the seat's class sets it
 * (`compactAtContextFraction`, CTO I2), 0.7 when no class is known.
 * `fixedTokens` is what the request carries besides these messages (the tool
 * specs, `estimateToolSpecs`), counted against the same budget. `compacted` is
 * true only when something was actually trimmed or folded: a history already
 * as short as it gets is left alone and said to be.
 */
export async function compactHistory(
  messages: ChatMessage[],
  contextTokens: number,
  summarize: (text: string) => Promise<string>,
  fraction = 0.7,
  fixedTokens = 0,
): Promise<CompactionResult> {
  const budget = Math.floor(contextTokens * fraction) - fixedTokens;
  if (estimateMessages(messages) <= budget) return { messages, compacted: false };

  let out = trimOldObservations(messages);
  const trimmed = out.some((m, i) => m !== messages[i]);
  if (estimateMessages(out) <= budget) return { messages: out, compacted: trimmed };

  // Keep the system prompt and the most recent exchanges; summarize the middle.
  const system = out.filter((m) => m.role === 'system');
  const rest = out.filter((m) => m.role !== 'system');
  const keepTail = 8;
  if (rest.length <= keepTail) return { messages: out, compacted: trimmed };
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
  // On a window the prompt and tools nearly fill, the budget cannot be met
  // however short the history gets; without this every turn would pay a
  // model call to fold two or three messages into a note as long as they are.
  if (estimateMessages(toSummarize) <= SUMMARY_TOKENS) {
    return { messages: out, compacted: trimmed };
  }

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
  let summarized = false;
  try {
    summary = await summarize(
      `Summarize this coding-session history in under 300 words. Keep: the user's goal, decisions made, files touched and how, and anything still unresolved.\n\n${transcript}`,
    );
    summarized = true;
  } catch {
    summary =
      '(earlier turns were dropped to fit the context window; ask the user to restate anything missing)';
  }
  // A summary written from a local-only note's text may quote it, so it keeps
  // the mark: a seat off this network gets the stub in its place and a
  // handoff leaves it out (D5). A stub carries no text, so a fold of the
  // stubbed history is not marked.
  const localOnly = summarized && toSummarize.some(carriesLocalOnly);

  out = [
    ...system,
    {
      role: 'user',
      content: `[Conversation so far, summarized to fit the context window]\n${summary}`,
      ...(localOnly ? { localOnly: true as const } : {}),
    },
    ...tail,
  ];
  return { messages: out, compacted: true };
}
