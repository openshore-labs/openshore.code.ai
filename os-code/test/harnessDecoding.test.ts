import { describe, it, expect } from 'vitest';
import {
  buildDecodingSchema,
  parseDecoded,
  unionProtocolInstructions,
} from '../src/harness/decoding.js';
import type { ToolSpec } from '../src/providers/types.js';

const TOOLS: ToolSpec[] = [
  {
    name: 'readFile',
    description: 'Read a file',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description: 'Search',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
    },
  },
];

describe('buildDecodingSchema', () => {
  it('is a union of one branch per tool plus a say branch', () => {
    const schema = buildDecodingSchema(TOOLS) as { oneOf: unknown[] };
    expect(Array.isArray(schema.oneOf)).toBe(true);
    // Two tools plus the say branch.
    expect(schema.oneOf).toHaveLength(3);
  });
  it('pins each tool branch to its name and its own args schema', () => {
    const schema = buildDecodingSchema(TOOLS) as {
      oneOf: Array<{ properties: Record<string, unknown> }>;
    };
    const readBranch = schema.oneOf.find(
      (b) => (b.properties.tool as { const?: string })?.const === 'readFile',
    );
    expect(readBranch).toBeDefined();
    // The args schema is the tool's real parameter schema, not a bare object.
    expect(readBranch!.properties.args).toEqual(TOOLS[0]!.parameters);
  });
  it('includes a say branch so prose is never forbidden', () => {
    const schema = buildDecodingSchema(TOOLS) as {
      oneOf: Array<{ properties: Record<string, unknown>; required: string[] }>;
    };
    const say = schema.oneOf.find((b) => 'say' in b.properties);
    expect(say).toBeDefined();
    expect(say!.required).toEqual(['say']);
  });
  it('is just the say branch when there are no tools', () => {
    const schema = buildDecodingSchema([]) as { oneOf: unknown[] };
    expect(schema.oneOf).toHaveLength(1);
  });
});

describe('parseDecoded', () => {
  it('reads a clean tool call', () => {
    expect(parseDecoded('{"tool":"readFile","args":{"path":"src/x.ts"}}')).toEqual({
      kind: 'tool',
      name: 'readFile',
      args: { path: 'src/x.ts' },
    });
  });
  it('reads a plain answer', () => {
    expect(parseDecoded('{"say":"All done, tests pass."}')).toEqual({
      kind: 'say',
      text: 'All done, tests pass.',
    });
  });
  it('tolerates fences and trailing commas from a small model', () => {
    const raw = '```json\n{"tool": "grep", "args": {"pattern": "TODO",},}\n```';
    expect(parseDecoded(raw)).toEqual({
      kind: 'tool',
      name: 'grep',
      args: { pattern: 'TODO' },
    });
  });
  it('defaults missing or non-object args to an empty object', () => {
    expect(parseDecoded('{"tool":"readFile"}')).toEqual({
      kind: 'tool',
      name: 'readFile',
      args: {},
    });
  });
  it('returns undefined for neither shape so the caller can fall back', () => {
    expect(parseDecoded('just some prose, not json')).toBeUndefined();
    expect(parseDecoded('{"other":1}')).toBeUndefined();
  });
});

describe('unionProtocolInstructions', () => {
  it('teaches both the tool and say shapes', () => {
    const text = unionProtocolInstructions();
    expect(text).toContain('"tool"');
    expect(text).toContain('"say"');
  });
});
