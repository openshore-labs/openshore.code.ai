// The tool-call bridge, the make-or-break component for local models.
// Accepts native OpenAI-style tool calls AND a JSON-in-text fallback, runs a
// bounded repair pass over almost-JSON, and produces the JSON schema used for
// grammar-constrained decoding on backends that support it. On repeated
// failure the agent loop can escalate to cloud.
import { z } from 'zod';
import type { ToolCallRequest } from '../../providers/types.js';
import type { ToolRegistry } from './index.js';

export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ValidationResult = { ok: true; call: ParsedToolCall } | { ok: false; problem: string };

let idSeq = 0;
function nextId(): string {
  return `call_txt_${idSeq++}`;
}

// ---------------------------------------------------------------------------
// Native path: transport gave us a name and an argument string.
// ---------------------------------------------------------------------------

export function validateNativeCall(
  call: ToolCallRequest,
  registry: ToolRegistry,
): ValidationResult {
  const tool = registry.get(call.name);
  if (!tool) {
    const known = registry.names().join(', ');
    return {
      ok: false,
      problem: `There is no tool named "${call.name}". The available tools are: ${known}.`,
    };
  }
  let args: unknown = call.args;
  if (args === undefined) {
    const parsed = parseJsonLoose(call.argsText || '{}');
    if (parsed === undefined) {
      return {
        ok: false,
        problem: `The arguments for ${call.name} were not valid JSON. Send a single JSON object matching the schema.`,
      };
    }
    args = parsed;
  }
  const result = tool.schema.safeParse(args);
  if (!result.success) {
    return { ok: false, problem: describeZodIssues(call.name, result.error) };
  }
  return {
    ok: true,
    call: { id: call.id, name: call.name, args: result.data as Record<string, unknown> },
  };
}

function describeZodIssues(toolName: string, error: z.ZodError): string {
  const first = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
  return `The arguments for ${toolName} did not match its schema. ${first.join('; ')}. Fix the arguments and call again.`;
}

// ---------------------------------------------------------------------------
// Text path: mine tool calls out of free-form model output.
// ---------------------------------------------------------------------------

export interface TextExtraction {
  calls: ParsedToolCall[];
  problems: string[];
  /** The text with the recognized tool-call JSON removed (display text). */
  remainder: string;
}

export function extractTextCalls(text: string, registry: ToolRegistry): TextExtraction {
  const calls: ParsedToolCall[] = [];
  const problems: string[] = [];
  const spansToRemove: Array<[number, number]> = [];

  for (const candidate of jsonCandidates(text)) {
    const parsed = parseJsonLoose(candidate.text);
    if (parsed === undefined || typeof parsed !== 'object' || parsed === null) continue;
    const obj = parsed as Record<string, unknown>;
    const name = firstString(obj, ['tool', 'name', 'tool_name', 'function']);
    if (!name) continue;
    const rawArgs = firstObject(obj, ARG_KEYS) ?? {};
    const tool = registry.get(name);
    if (!tool) {
      // An unknown name is only a malformed call when the object is shaped
      // like one. A final answer that quotes a package.json ({"name": ...})
      // is prose, not a call for a tool named "my-app" (ENG-2).
      if (!looksLikeCall(obj)) continue;
      problems.push(
        `There is no tool named "${name}". The available tools are: ${registry.names().join(', ')}.`,
      );
      spansToRemove.push([candidate.start, candidate.end]);
      continue;
    }
    const result = tool.schema.safeParse(rawArgs);
    if (!result.success) {
      problems.push(describeZodIssues(name, result.error));
      spansToRemove.push([candidate.start, candidate.end]);
      continue;
    }
    calls.push({ id: nextId(), name, args: result.data as Record<string, unknown> });
    spansToRemove.push([candidate.start, candidate.end]);
  }

  let remainder = '';
  let cursor = 0;
  for (const [start, end] of spansToRemove.sort((a, b) => a[0] - b[0])) {
    remainder += text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  remainder += text.slice(cursor);
  remainder = remainder.replace(/```(?:json|tool_call|tool)?\s*```/g, '').trim();

  return { calls, problems, remainder };
}

/** Balanced-brace JSON object candidates, fence-aware, string-aware. */
function* jsonCandidates(text: string): Generator<{ text: string; start: number; end: number }> {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) return;
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let j = open; j < text.length; j++) {
      const ch = text[j]!;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end === -1) {
      // Unterminated object: let the repair pass try the rest of the text.
      yield { text: text.slice(open), start: open, end: text.length };
      return;
    }
    yield { text: text.slice(open, end), start: open, end };
    i = end;
  }
}

const ARG_KEYS = ['args', 'arguments', 'parameters', 'input'];

/** True when the object carries a call-shaped key: our own `tool` spelling, an
 *  arguments key, or a nested function object with one. */
function looksLikeCall(obj: Record<string, unknown>): boolean {
  if ('tool' in obj || 'tool_name' in obj) return true;
  if (ARG_KEYS.some((k) => k in obj)) return true;
  const fn = obj.function;
  return typeof fn === 'object' && fn !== null && ARG_KEYS.some((k) => k in fn);
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
    // {"function": {"name": ..., "arguments": ...}} nesting
    if (k === 'function' && typeof v === 'object' && v !== null) {
      const name = (v as Record<string, unknown>).name;
      if (typeof name === 'string') return name;
    }
  }
  return undefined;
}

function firstObject(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'object' && v !== null && !Array.isArray(v))
      return v as Record<string, unknown>;
    if (typeof v === 'string') {
      const parsed = parseJsonLoose(v);
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    }
  }
  const fn = obj.function;
  if (typeof fn === 'object' && fn !== null) {
    return firstObject(fn as Record<string, unknown>, ['arguments', 'args', 'parameters']);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// JSON repair: bounded fixes for the ways local models break JSON.
// ---------------------------------------------------------------------------

export function parseJsonLoose(text: string): unknown | undefined {
  const trimmed = stripFences(text.trim());
  try {
    return JSON.parse(trimmed);
  } catch {}
  const repaired = repairJson(trimmed);
  try {
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}

export function repairJson(text: string): string {
  let s = text;
  // Smart quotes to straight quotes.
  s = s.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // Python-isms.
  s = s
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null');
  // Trailing commas before } or ].
  s = s.replace(/,\s*([}\]])/g, '$1');
  // Unquoted object keys: {tool: "x"} -> {"tool": "x"}.
  s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
  // Single-quoted strings when the value has no double quotes inside.
  s = s.replace(/'([^'"\\]*)'/g, '"$1"');
  // Balance braces: append missing closers (models truncate).
  const opens = (s.match(/{/g) ?? []).length;
  const closes = (s.match(/}/g) ?? []).length;
  if (opens > closes) s += '}'.repeat(opens - closes);
  return s;
}

function stripFences(text: string): string {
  const m = /^```[a-zA-Z_]*\s*\n?([\s\S]*?)\n?```\s*$/.exec(text);
  return m ? m[1]! : text;
}

// ---------------------------------------------------------------------------
// Grammar mode: the schema that constrains decoding to a valid tool call.
// ---------------------------------------------------------------------------

export function toolCallJsonSchema(registry: ToolRegistry): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: registry.names() },
      args: { type: 'object' },
    },
    required: ['tool', 'args'],
    additionalProperties: false,
  };
}

/** Appended to the system prompt when a model uses the JSON-in-text bridge. */
export function textProtocolInstructions(registry: ToolRegistry): string {
  return [
    'TOOLS. You can use tools. To call one, reply with ONLY a single JSON object on its own line, nothing else:',
    '{"tool": "<name>", "args": { ... }}',
    'After the tool runs you will receive its output and can continue. When the task is done, reply with your answer as plain text and NO JSON object.',
    'Available tools:',
    registry.textDocs(),
  ].join('\n');
}

/** A corrective message sent back to the model after a malformed call. */
export function repairPrompt(problems: string[]): string {
  return [
    'Your last tool call could not be used.',
    ...problems.map((p) => `- ${p}`),
    'Reply again with exactly one JSON object of the form {"tool": "<name>", "args": { ... }} and nothing else.',
  ].join('\n');
}
