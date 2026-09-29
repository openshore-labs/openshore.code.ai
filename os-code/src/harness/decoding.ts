// The premium harness: constrained decoding that does not forbid prose.
//
// The existing bridge (core/tools/parser.ts) can constrain a small model's
// output to a tool call, but its schema pins `args` to a bare object (so a
// constrained call can still fail the tool's own validation) and, more
// importantly, a permanent tool-call constraint forbids the model from ever
// answering in plain text. That is why grammar decoding shipped as a repair
// tool, not a default.
//
// This module removes that objection. `buildDecodingSchema` returns a UNION:
// exactly one of a per-tool branch (each pinning `tool` to a specific name and
// `args` to THAT tool's own JSON schema, so a constrained call always
// validates) or a `say` branch carrying plain text. A small model under this
// constraint can always choose to answer, and when it calls a tool the
// arguments are shaped correctly. The wire shape stays `{tool, args}`, a strict
// superset of what the existing bridge already parses, so nothing downstream
// has to change to accept it.
//
// Pure and synchronous (tenet 5): no files, no network, no Node built-ins.
import type { ToolSpec } from '../providers/types.js';
import { parseJsonLoose } from '../core/tools/parser.js';

export type DecodedReply =
  { kind: 'tool'; name: string; args: Record<string, unknown> } | { kind: 'say'; text: string };

/** Build the tool-or-answer union JSON schema for a set of tools. Each tool
 *  gets its own branch with its real argument schema, and one `say` branch
 *  lets the model answer in prose instead. */
export function buildDecodingSchema(tools: ToolSpec[]): Record<string, unknown> {
  const toolBranches = tools.map((t) => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      tool: { const: t.name },
      args: t.parameters,
    },
    required: ['tool', 'args'],
  }));
  const sayBranch = {
    type: 'object',
    additionalProperties: false,
    properties: { say: { type: 'string' } },
    required: ['say'],
  };
  return { oneOf: [...toolBranches, sayBranch] };
}

/** Parse a constrained reply into a tool call or a plain answer. Tolerant of
 *  the usual small-model JSON slips (fences, smart quotes, trailing commas)
 *  because it routes through the shared loose parser. Returns undefined when
 *  the text is neither shape, so the caller can fall back to treating it as a
 *  plain answer. */
export function parseDecoded(raw: string): DecodedReply | undefined {
  const value = parseJsonLoose(raw);
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.say === 'string') {
    return { kind: 'say', text: obj.say };
  }
  if (typeof obj.tool === 'string') {
    const args =
      obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)
        ? (obj.args as Record<string, unknown>)
        : {};
    return { kind: 'tool', name: obj.tool, args };
  }
  return undefined;
}

/**
 * Streams the answer out of a union-constrained reply as it arrives (CTO 6):
 * a reply that opens `{"say": "` has its string decoded chunk by chunk, so
 * the person reads the words as they come instead of waiting for the closing
 * brace; any other reply (a tool call) shows nothing while it streams. The
 * whole reply is still parsed at the end (`parseDecoded`), which settles the
 * answer. Escapes split across chunks, and a surrogate pair split across two
 * escapes, are held until they complete.
 */
export class SayStream {
  private state: 'open' | 'key' | 'colon' | 'quote' | 'say' | 'other' | 'done' = 'open';
  private key = '';
  /** A backslash sequence waiting for the rest of its characters. */
  private pending = '';
  /** A high surrogate waiting for its pair. */
  private high = '';

  /** Feed one chunk of the raw reply; returns the answer text it adds. */
  push(chunk: string): string {
    let out = '';
    for (const ch of chunk) {
      switch (this.state) {
        case 'open':
          if (ch === '{') this.state = 'key';
          else if (!/\s/.test(ch)) this.state = 'other';
          break;
        case 'key':
          if (this.key === '' && /\s/.test(ch)) break;
          if (this.key === '') {
            if (ch === '"') this.key = '"';
            else this.state = 'other';
          } else if (ch === '"') {
            this.state = this.key === '"say' ? 'colon' : 'other';
          } else {
            this.key += ch;
            if (!'"say'.startsWith(this.key)) this.state = 'other';
          }
          break;
        case 'colon':
          if (ch === ':') this.state = 'quote';
          else if (!/\s/.test(ch)) this.state = 'other';
          break;
        case 'quote':
          if (ch === '"') this.state = 'say';
          else if (!/\s/.test(ch)) this.state = 'other';
          break;
        case 'say':
          out += this.sayChar(ch);
          break;
        default:
          return out;
      }
    }
    return out;
  }

  private sayChar(ch: string): string {
    if (this.pending) {
      this.pending += ch;
      if (this.pending.length === 2 && this.pending[1] !== 'u') {
        const decoded = ESCAPES[this.pending[1]!] ?? this.pending[1]!;
        this.pending = '';
        return this.emit(decoded);
      }
      if (this.pending.length < 6) return '';
      const code = Number.parseInt(this.pending.slice(2), 16);
      this.pending = '';
      return Number.isNaN(code) ? '' : this.emit(String.fromCharCode(code));
    }
    if (ch === '\\') {
      this.pending = ch;
      return '';
    }
    if (ch === '"') {
      this.state = 'done';
      const rest = this.high;
      this.high = '';
      return rest;
    }
    return this.emit(ch);
  }

  /** Text to show, holding a high surrogate until its pair arrives. */
  private emit(text: string): string {
    const code = text.charCodeAt(0);
    if (text.length === 1 && code >= 0xd800 && code <= 0xdbff) {
      const held = this.high;
      this.high = text;
      return held;
    }
    const out = this.high + text;
    this.high = '';
    return out;
  }
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  '"': '"',
  '\\': '\\',
  '/': '/',
};

/** The system-prompt line that teaches the union shape. Kept close to the
 *  existing bridge wording so a model that already knows `{tool, args}` needs
 *  only to learn the `{say}` escape hatch. */
export function unionProtocolInstructions(): string {
  return [
    'Reply with ONLY one JSON object, nothing else, in one of these two shapes:',
    'To use a tool: {"tool": "<name>", "args": { ... }}',
    'To answer the person: {"say": "<your answer as plain text>"}',
    'Never mix the two. Choose one object per reply.',
  ].join('\n');
}
