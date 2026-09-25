// Chain of Thought (founder, 2026-09-25): an opt-in setting, OFF by default.
// When it is on, every model shows its reasoning above the answer the way
// Claude does: live while it thinks, then folded to "Thought for Ns". When it is
// off, no model is asked to think out loud, and any reasoning a model sends
// anyway is kept out of the transcript.
//
// Two routes, one display:
//   - A model that reasons natively (Claude, Qwen3, DeepSeek R1, gpt-oss, and
//     kin) is asked through its own API: Claude's `thinking` parameter, Ollama's
//     `think` flag, an OpenAI-compatible server's reasoning field.
//   - Every other model is prompted to think inside <think> tags, and the
//     ThinkTagSplitter routes what is inside the tags to the thinking block and
//     the rest to the answer. The same splitter strips tags when the setting is
//     off, so a model that thinks in tags on its own never leaks them.
//
// Pure (no Node built-ins), so the app's drivers import it through
// os-code/protocol and run the exact same code the engine runs.

/** One routed slice of a model's text stream. */
export interface ThoughtPiece {
  kind: 'text' | 'thinking';
  text: string;
}

const OPEN_TAGS = ['<think>', '<thinking>'];
const CLOSE_TAGS = ['</think>', '</thinking>'];

/** The earliest of `tags` in `s`, or undefined. */
function findTag(s: string, tags: string[]): { index: number; tag: string } | undefined {
  let best: { index: number; tag: string } | undefined;
  for (const tag of tags) {
    const index = s.indexOf(tag);
    if (index !== -1 && (!best || index < best.index)) best = { index, tag };
  }
  return best;
}

/** How many trailing characters of `s` could be the start of one of `tags`,
 *  so a tag split across two chunks is held back instead of shown. */
function partialTagTail(s: string, tags: string[]): number {
  const lt = s.lastIndexOf('<');
  if (lt === -1) return 0;
  const tail = s.slice(lt);
  return tags.some((t) => t.length > tail.length && t.startsWith(tail)) ? tail.length : 0;
}

/**
 * Splits a streamed model reply into thinking and answer text by its <think>
 * (or <thinking>) tags. Chunk boundaries may fall anywhere, including inside a
 * tag. A stray closing tag outside a thought (some chat templates open the
 * thought in the prompt) is dropped rather than shown.
 */
export class ThinkTagSplitter {
  private inThink = false;
  private pending = '';
  /** Trim the whitespace a model leaves right after a closing tag. */
  private trimLead = false;

  push(chunk: string): ThoughtPiece[] {
    const out: ThoughtPiece[] = [];
    let s = this.pending + chunk;
    this.pending = '';
    for (;;) {
      if (this.inThink) {
        const close = findTag(s, CLOSE_TAGS);
        if (!close) {
          const hold = partialTagTail(s, CLOSE_TAGS);
          this.emit(out, 'thinking', s.slice(0, s.length - hold));
          this.pending = s.slice(s.length - hold);
          return out;
        }
        this.emit(out, 'thinking', s.slice(0, close.index));
        s = s.slice(close.index + close.tag.length);
        this.inThink = false;
        this.trimLead = true;
        continue;
      }
      const open = findTag(s, OPEN_TAGS);
      const stray = findTag(s, CLOSE_TAGS);
      if (stray && (!open || stray.index < open.index)) {
        this.emit(out, 'text', s.slice(0, stray.index));
        s = s.slice(stray.index + stray.tag.length);
        this.trimLead = true;
        continue;
      }
      if (!open) {
        const hold = partialTagTail(s, [...OPEN_TAGS, ...CLOSE_TAGS]);
        this.emit(out, 'text', s.slice(0, s.length - hold));
        this.pending = s.slice(s.length - hold);
        return out;
      }
      this.emit(out, 'text', s.slice(0, open.index));
      s = s.slice(open.index + open.tag.length);
      this.inThink = true;
    }
  }

  /** Flush whatever was held back (an unfinished tag reads as plain text). */
  end(): ThoughtPiece[] {
    const out: ThoughtPiece[] = [];
    this.emit(out, this.inThink ? 'thinking' : 'text', this.pending);
    this.pending = '';
    return out;
  }

  private emit(out: ThoughtPiece[], kind: ThoughtPiece['kind'], text: string): void {
    if (kind === 'text' && this.trimLead) {
      text = text.replace(/^\s+/, '');
      if (!text) return;
      this.trimLead = false;
    }
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  }
}

/** Split a whole reply at once: the answer without its tags, and the thought. */
export function splitThinkTags(text: string): { text: string; thinking: string } {
  const splitter = new ThinkTagSplitter();
  const pieces = [...splitter.push(text), ...splitter.end()];
  return {
    text: pieces
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join(''),
    thinking: pieces
      .filter((p) => p.kind === 'thinking')
      .map((p) => p.text)
      .join(''),
  };
}

/**
 * Whether Chain of Thought is on for a session. The app's setting rides in as a
 * per-session override and wins in both directions (it is the person's display
 * choice, not a project policy); a bare CLI session reads the project config.
 * Off by default.
 */
export function chainOfThoughtEnabled(configEnabled: boolean | undefined, override?: boolean) {
  return override ?? configEnabled === true;
}

/**
 * Whether a model reasons through its own API rather than by prompt, judged by
 * its name so the app and the engine agree without a network probe. Claude and
 * the open reasoning families say yes; a Qwen3 Coder does not think, so it is
 * prompted like any other model.
 */
export function reasonsNatively(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes('claude')) return true;
  if (/qwen3-coder/.test(m)) return false;
  return /qwen3|qwq|deepseek-r1|deepseek-reasoner|gpt-oss|magistral|phi-?4-(mini-)?reasoning|exaone-deep|thinking|(^|[/:])o[134](-|$)/.test(
    m,
  );
}

/** The instruction a prompted model gets while Chain of Thought is on. */
export function chainOfThoughtPrompt(): string {
  return [
    'Chain of thought is on. Before you answer, think the problem through step by step inside <think> and </think> tags, then write your answer after the closing tag.',
    'The person sees your thinking folded above the answer, so keep it honest and focused: what you know, what you are unsure of, and the steps you take.',
    'Never put the answer only inside the tags. When you call a tool, think first, then make the call after the closing tag.',
  ].join('\n');
}

/** Claude models that predate adaptive thinking take a fixed token budget. */
function legacyClaudeThinking(model: string): boolean {
  const m = model.toLowerCase();
  return (
    /claude-3/.test(m) ||
    m.includes('haiku') ||
    /(opus|sonnet)-4-[015](-|$)/.test(m) ||
    /(opus|sonnet)-4-\d{8}/.test(m)
  );
}

/** The `thinking` parameter for a Claude request, and the max_tokens it needs.
 *  Claude 4.6 and newer think adaptively, with the reasoning returned as a
 *  readable summary (newer models return an empty thought without `display`);
 *  older Claude models take a fixed budget that must sit under max_tokens. */
export function claudeThinking(
  model: string,
  baseMaxTokens: number,
): {
  thinking:
    { type: 'adaptive'; display: 'summarized' } | { type: 'enabled'; budget_tokens: number };
  maxTokens: number;
} {
  if (legacyClaudeThinking(model)) {
    const budget = 4096;
    return {
      thinking: { type: 'enabled', budget_tokens: budget },
      maxTokens: Math.max(baseMaxTokens, 2048) + budget,
    };
  }
  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    maxTokens: Math.max(baseMaxTokens, 16000),
  };
}
