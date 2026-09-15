// The deep eval's self-diagnosis (traceFrom/traceLine): what turned a
// "0%, no write landed" mystery into an actual answer. Two things earned their
// keep on the reference box's 3B run: (1) "wrote" must mean a WRITE-risk tool
// succeeded, not just any tool (a read-only answer task was misreporting "a
// write landed"); (2) a failed call's own message has to reach the report,
// because "no write landed" alone cannot tell a content mismatch from a
// format problem, and guessing at the difference wastes a round trip on a
// slow box. A repeated identical failure (the loop-guardrail case) collapses
// to one line with a count instead of drowning the report.
import { describe, it, expect } from 'vitest';
import { traceFrom, traceLine } from '../src/commands/eval.js';
import { ToolRegistry, type ToolDef } from '../src/core/tools/index.js';
import type { AgentEvent } from '../src/core/agent/types.js';
import { z } from 'zod';

function stubTool(name: string, risk: 'read' | 'write'): ToolDef {
  return {
    name,
    description: name,
    schema: z.object({}),
    risk,
    async execute() {
      return { ok: true, content: '' };
    },
  };
}

function registryWith(...tools: ToolDef[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);
  return registry;
}

function toolEnd(name: string, ok: boolean, content: string): AgentEvent {
  return {
    type: 'tool-end',
    call: { id: 'c1', name, args: {} },
    result: { ok, content },
    durationMs: 1,
  } as AgentEvent;
}

function toolStart(name: string): AgentEvent {
  return { type: 'tool-start', call: { id: 'c1', name, args: {} } } as AgentEvent;
}

describe('traceFrom: wrote means a write-risk tool succeeded, not any tool', () => {
  it('is false when only a read-risk tool succeeded (the answer-task mislabel)', () => {
    const tools = registryWith(stubTool('readFile', 'read'));
    const events: AgentEvent[] = [toolStart('readFile'), toolEnd('readFile', true, 'contents')];
    const trace = traceFrom(events, tools);
    expect(trace.wrote).toBe(false);
  });

  it('is true when a write-risk tool succeeded', () => {
    const tools = registryWith(stubTool('writeFile', 'write'));
    const events: AgentEvent[] = [toolStart('writeFile'), toolEnd('writeFile', true, 'wrote it')];
    const trace = traceFrom(events, tools);
    expect(trace.wrote).toBe(true);
  });

  it('is false when the write-risk tool call failed', () => {
    const tools = registryWith(stubTool('editFile', 'write'));
    const events: AgentEvent[] = [toolStart('editFile'), toolEnd('editFile', false, 'not found')];
    const trace = traceFrom(events, tools);
    expect(trace.wrote).toBe(false);
  });
});

describe('traceFrom: failed calls carry their own message', () => {
  it('records each failure, truncated', () => {
    const tools = registryWith(stubTool('editFile', 'write'));
    const long = 'x'.repeat(1200);
    const events: AgentEvent[] = [toolStart('editFile'), toolEnd('editFile', false, long)];
    const trace = traceFrom(events, tools);
    expect(trace.toolFailures).toHaveLength(1);
    expect(trace.toolFailures![0]!.name).toBe('editFile');
    expect(trace.toolFailures![0]!.detail.length).toBeLessThan(long.length);
    expect(trace.toolFailures![0]!.detail.endsWith('...')).toBe(true);
  });

  it('is undefined when every call succeeded', () => {
    const tools = registryWith(stubTool('readFile', 'read'));
    const events: AgentEvent[] = [toolStart('readFile'), toolEnd('readFile', true, 'ok')];
    expect(traceFrom(events, tools).toolFailures).toBeUndefined();
  });
});

describe('traceLine: a repeated identical failure collapses to one line with a count', () => {
  it('dedupes the loop-guardrail case: same tool, same message, four times', () => {
    const tools = registryWith(stubTool('editFile', 'write'));
    const events: AgentEvent[] = [];
    for (let i = 0; i < 4; i += 1) {
      events.push(
        toolStart('editFile'),
        toolEnd('editFile', false, 'The SEARCH text was not found.'),
      );
    }
    const trace = traceFrom(events, tools);
    const line = traceLine(trace);
    const occurrences = line.split('The SEARCH text was not found.').length - 1;
    expect(occurrences).toBe(1);
    expect(line).toContain('editFile failed x4');
  });

  it('keeps two distinct failures on their own lines', () => {
    const tools = registryWith(stubTool('editFile', 'write'));
    const events: AgentEvent[] = [
      toolStart('editFile'),
      toolEnd('editFile', false, 'No valid edit blocks found.'),
      toolStart('editFile'),
      toolEnd('editFile', false, 'The edit did not apply.'),
    ];
    const trace = traceFrom(events, tools);
    const line = traceLine(trace);
    expect(line).toContain('No valid edit blocks found.');
    expect(line).toContain('The edit did not apply.');
    expect(line).not.toContain('failed x2');
  });
});
