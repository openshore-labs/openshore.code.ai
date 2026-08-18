// The tool-call bridge: the make-or-break component for local models.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../src/core/tools/index.js';
import {
  extractTextCalls,
  parseJsonLoose,
  repairJson,
  toolCallJsonSchema,
  validateNativeCall,
} from '../src/core/tools/parser.js';

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register({
    name: 'readFile',
    description: 'read a file',
    schema: z.object({ path: z.string(), startLine: z.number().int().optional() }),
    risk: 'read',
    execute: async () => ({ ok: true, content: '' }),
  });
  r.register({
    name: 'runShell',
    description: 'run a command',
    schema: z.object({ command: z.string() }),
    risk: 'shell',
    execute: async () => ({ ok: true, content: '' }),
  });
  return r;
}

describe('native call validation', () => {
  it('accepts a valid call with parsed args', () => {
    const result = validateNativeCall(
      { id: '1', name: 'readFile', argsText: '{"path":"src/a.ts"}' },
      registry(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.call.args).toEqual({ path: 'src/a.ts' });
  });

  it('names the unknown tool and lists what exists', () => {
    const result = validateNativeCall({ id: '1', name: 'openFile', argsText: '{}' }, registry());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain('readFile');
  });

  it('explains a schema mismatch field by field', () => {
    const result = validateNativeCall(
      { id: '1', name: 'readFile', argsText: '{"path":5}' },
      registry(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain('path');
  });

  it('repairs almost-JSON arguments', () => {
    const result = validateNativeCall(
      { id: '1', name: 'readFile', argsText: "{path: 'src/a.ts',}" },
      registry(),
    );
    expect(result.ok).toBe(true);
  });
});

describe('JSON-in-text extraction', () => {
  it('finds a bare tool call object', () => {
    const { calls, remainder } = extractTextCalls(
      '{"tool": "readFile", "args": {"path": "x.ts"}}',
      registry(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('readFile');
    expect(remainder).toBe('');
  });

  it('finds a fenced call and keeps surrounding prose as remainder', () => {
    const text =
      'Let me look at that file.\n```json\n{"tool": "readFile", "args": {"path": "x.ts"}}\n```\n';
    const { calls, remainder } = extractTextCalls(text, registry());
    expect(calls).toHaveLength(1);
    expect(remainder).toContain('Let me look');
    expect(remainder).not.toContain('"tool"');
  });

  it('accepts the name/arguments spelling and nested function objects', () => {
    const a = extractTextCalls('{"name": "runShell", "arguments": {"command": "ls"}}', registry());
    expect(a.calls[0]?.name).toBe('runShell');
    const b = extractTextCalls(
      '{"function": {"name": "runShell", "arguments": {"command": "ls"}}}',
      registry(),
    );
    expect(b.calls[0]?.name).toBe('runShell');
  });

  it('reports unknown tools as problems, not calls', () => {
    const { calls, problems } = extractTextCalls('{"tool": "compile", "args": {}}', registry());
    expect(calls).toHaveLength(0);
    expect(problems[0]).toContain('compile');
  });

  it('handles multiple calls in one reply, in order', () => {
    const text =
      '{"tool": "readFile", "args": {"path": "a.ts"}}\n{"tool": "readFile", "args": {"path": "b.ts"}}';
    const { calls } = extractTextCalls(text, registry());
    expect(calls.map((c) => (c.args as { path: string }).path)).toEqual(['a.ts', 'b.ts']);
  });

  it('treats plain prose as no calls and no problems', () => {
    const { calls, problems, remainder } = extractTextCalls(
      'Done. The bug was a typo in main().',
      registry(),
    );
    expect(calls).toHaveLength(0);
    expect(problems).toHaveLength(0);
    expect(remainder).toContain('typo');
  });
});

describe('JSON repair', () => {
  it('fixes trailing commas, single quotes, unquoted keys, and Python literals', () => {
    expect(parseJsonLoose("{tool: 'x', flag: True, n: None,}")).toEqual({
      tool: 'x',
      flag: true,
      n: null,
    });
  });

  it('closes truncated objects', () => {
    expect(repairJson('{"a": {"b": 1')).toBe('{"a": {"b": 1}}');
  });

  it('gives up honestly on hopeless input', () => {
    expect(parseJsonLoose('not json at all')).toBeUndefined();
  });
});

describe('grammar schema', () => {
  it('constrains the tool name to the registry', () => {
    const schema = toolCallJsonSchema(registry());
    expect((schema.properties as any).tool.enum).toEqual(['readFile', 'runShell']);
    expect(schema.required).toEqual(['tool', 'args']);
  });
});
