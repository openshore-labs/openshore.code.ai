import { describe, expect, it } from 'vitest';
import {
  briefTodos,
  extractJson,
  formatBriefTable,
  mergeReplan,
  ownerFor,
  ownerLabel,
  parsePlan,
  parseReplan,
  readySteps,
  sanitizePlay,
  topoOrder,
  type Play,
  type PlayStep,
} from '../src/lib/play.js';
import { harborRef, type AppStack, type StackModelRef } from '../src/lib/stack.js';

const claude: StackModelRef = {
  kind: 'cloud',
  provider: 'anthropic',
  model: 'claude-opus-5',
  label: 'Claude',
};
const coder: StackModelRef = {
  kind: 'byom',
  id: 'c1',
  label: 'Coder',
  baseUrl: 'http://x/v1',
  model: 'coder',
};

function step(id: string, category: PlayStep['category'], dependsOn: string[] = []): PlayStep {
  return { id, title: `Step ${id}`, category, brief: '', dependsOn };
}

describe('sanitizePlay', () => {
  it('coerces fields, defaults unknown categories to reasoning, and makes ids unique', () => {
    const steps = sanitizePlay([
      { id: 'a', title: 'A', category: 'coding', brief: 'do', dependsOn: [] },
      { id: 'a', category: 'nonsense' },
      {},
    ]);
    expect(steps).toHaveLength(3);
    expect(steps[0]!.category).toBe('coding');
    expect(steps[1]!.category).toBe('reasoning');
    expect(new Set(steps.map((s) => s.id)).size).toBe(3);
    expect(steps[2]!.title).toBe('Step 3');
  });

  it('drops dependencies on unknown steps', () => {
    const steps = sanitizePlay([
      { id: 'a', title: 'A', category: 'coding', dependsOn: ['ghost'] },
      { id: 'b', title: 'B', category: 'writing', dependsOn: ['a'] },
    ]);
    expect(steps[0]!.dependsOn).toEqual([]);
    expect(steps[1]!.dependsOn).toEqual(['a']);
  });

  it('breaks a cycle by dropping the offending edge, never the step', () => {
    const steps = sanitizePlay([
      { id: 'a', title: 'A', category: 'coding', dependsOn: ['b'] },
      { id: 'b', title: 'B', category: 'writing', dependsOn: ['a'] },
    ]);
    expect(steps).toHaveLength(2);
    // topoOrder must terminate and include both steps.
    const order = topoOrder(steps).map((s) => s.id);
    expect(order.sort()).toEqual(['a', 'b']);
  });

  it('returns an empty list for non-array input', () => {
    expect(sanitizePlay('nope')).toEqual([]);
    expect(sanitizePlay(undefined)).toEqual([]);
  });
});

describe('topoOrder and readySteps', () => {
  const steps = [step('a', 'coding'), step('b', 'writing', ['a']), step('c', 'coding', ['b'])];

  it('orders dependencies before dependents', () => {
    expect(topoOrder(steps).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('readySteps returns only steps whose deps are all done and are not running', () => {
    expect(readySteps(steps, new Set(), new Set()).map((s) => s.id)).toEqual(['a']);
    expect(readySteps(steps, new Set(['a']), new Set()).map((s) => s.id)).toEqual(['b']);
    expect(readySteps(steps, new Set(['a']), new Set(['b']))).toEqual([]);
    expect(readySteps(steps, new Set(['a', 'b']), new Set()).map((s) => s.id)).toEqual(['c']);
  });
});

describe('mergeReplan', () => {
  it('keeps done steps and replaces the rest, honoring deps on done steps', () => {
    const play: Play = {
      summary: 'goal',
      steps: [step('a', 'coding'), step('b', 'writing', ['a']), step('c', 'coding', ['b'])],
    };
    const merged = mergeReplan(play, new Set(['a']), [
      { id: 'b2', title: 'new B', category: 'writing', dependsOn: ['a'] },
      { id: 'c2', title: 'new C', category: 'coding', dependsOn: ['b2'] },
    ]);
    expect(merged.steps.map((s) => s.id)).toEqual(['a', 'b2', 'c2']);
    expect(merged.steps[1]!.dependsOn).toEqual(['a']);
  });

  it('never reintroduces a done id', () => {
    const play: Play = { summary: 'g', steps: [step('a', 'coding'), step('b', 'writing', ['a'])] };
    const merged = mergeReplan(play, new Set(['a']), [
      { id: 'a', title: 'redo', category: 'coding' },
    ]);
    expect(merged.steps.filter((s) => s.id === 'a')).toHaveLength(1);
    expect(merged.steps[0]!.title).toBe('Step a'); // the original done step, not the redo
  });
});

describe('ownerFor / ownerLabel', () => {
  const stack: AppStack = {
    reasoning: claude,
    active: [
      { ref: coder, placement: { category: 'coding' } },
      { ref: claude, placement: { category: 'vision' } },
    ],
    saved: {},
  };

  it('routes a category to its placed specialist', () => {
    expect(ownerFor(step('s', 'coding'), stack).ref).toEqual(coder);
    expect(ownerFor(step('s', 'coding'), stack).fellBack).toBe(false);
  });

  it('falls back to the reasoning anchor for an unplaced category', () => {
    const o = ownerFor(step('s', 'analysis'), stack);
    expect(o.ref).toEqual(claude);
    expect(o.fellBack).toBe(true);
    expect(ownerLabel(step('s', 'analysis'), stack)).toContain('(reasoning)');
  });

  it('routes vision to its slot', () => {
    expect(ownerFor(step('s', 'vision'), stack).ref).toEqual(claude);
  });

  it('routes a reasoning step to the anchor with no fallback tag', () => {
    expect(ownerFor(step('s', 'reasoning'), stack).fellBack).toBe(false);
  });

  it('honors a step owner that targets a specific model in the stack', () => {
    // A step can name a specific model (by refKey) regardless of its category:
    // the founder's "a particular model called upon for a particular subject."
    const s: PlayStep = { ...step('s', 'writing'), owner: 'byom:c1' };
    expect(ownerFor(s, stack).ref).toEqual(coder);
    expect(ownerFor(s, stack).fellBack).toBe(false);
  });

  it('ignores a step owner that names no model in the stack, falling back to category', () => {
    const s: PlayStep = { ...step('s', 'coding'), owner: 'cloud:ghost:x' };
    expect(ownerFor(s, stack).ref).toEqual(coder); // coding specialist by category
  });
});

describe('the brief', () => {
  const stack: AppStack = {
    reasoning: claude,
    active: [{ ref: coder, placement: { category: 'coding' } }],
    saved: {},
  };
  const play: Play = {
    summary: 'Ship the feature',
    steps: [step('a', 'coding'), step('b', 'writing', ['a'])],
  };

  it('briefTodos carries the owner and status of each step in run order', () => {
    const todos = briefTodos(play, stack, new Map([['a', 'completed']]));
    expect(todos.map((t) => t.content)).toEqual(['Step a', 'Step b']);
    expect(todos[0]!.owner).toBe('Coder');
    expect(todos[0]!.status).toBe('completed');
    expect(todos[1]!.owner).toContain('(reasoning)'); // writing has no specialist
  });

  it('formatBriefTable is a compact ordered list with owners', () => {
    const table = formatBriefTable(play, stack);
    expect(table).toContain('Ship the feature');
    expect(table).toContain('1. Step a');
    expect(table).toContain('Coder');
    expect(table.split('\n').length).toBeLessThanOrEqual(6);
  });
});

describe('extractJson', () => {
  it('reads a fenced json block', () => {
    expect(extractJson('here:\n```json\n{"a":1}\n```\ndone')).toEqual({ a: 1 });
  });
  it('reads a bare object embedded in prose', () => {
    expect(extractJson('sure. {"a":2} thanks')).toEqual({ a: 2 });
  });
  it('reads an array', () => {
    expect(extractJson('[{"id":"a"}]')).toEqual([{ id: 'a' }]);
  });
  it('returns undefined for junk', () => {
    expect(extractJson('no json here')).toBeUndefined();
  });
});

describe('parsePlan', () => {
  it('parses a clear plan with steps', () => {
    const f = parsePlan(
      '```json\n{"clear":true,"summary":"do it","steps":[{"id":"a","title":"A","category":"coding","dependsOn":[]}]}\n```',
    );
    expect(f?.clear).toBe(true);
    expect(f?.steps).toHaveLength(1);
    expect(f?.summary).toBe('do it');
  });

  it('parses an unclear plan with questions', () => {
    const f = parsePlan(
      '{"clear":false,"summary":"?","questions":[{"id":"q1","question":"Which repo?","options":["A","B"]}]}',
    );
    expect(f?.clear).toBe(false);
    expect(f?.questions).toHaveLength(1);
    expect(f?.questions[0]!.options).toEqual(['A', 'B']);
  });

  it('treats an unclear reply with no questions as clear', () => {
    const f = parsePlan('{"clear":false,"summary":"x","steps":[]}');
    expect(f?.clear).toBe(true);
  });

  it('defaults a missing clear field to clear', () => {
    expect(parsePlan('{"summary":"x","steps":[]}')?.clear).toBe(true);
  });

  it('returns undefined for unparseable output', () => {
    expect(parsePlan('the model rambled with no json')).toBeUndefined();
  });
});

describe('parseReplan', () => {
  it('parses a bare array of steps', () => {
    const steps = parseReplan('[{"id":"b","title":"B","category":"writing","dependsOn":["a"]}]');
    expect(steps).toHaveLength(1);
    expect(steps![0]!.id).toBe('b');
  });
  it('parses a {steps:[...]} wrapper too', () => {
    expect(parseReplan('{"steps":[{"id":"b","title":"B","category":"writing"}]}')).toHaveLength(1);
  });
  it('returns undefined for junk', () => {
    expect(parseReplan('nope')).toBeUndefined();
  });
});

describe('degenerate single-step play', () => {
  it('a clear reply with no steps yields an empty step list the driver treats as one reasoning turn', () => {
    const f = parsePlan('{"clear":true,"summary":"just answer","steps":[]}');
    expect(f?.steps).toEqual([]);
  });
  it('the reasoning anchor still owns a lone reasoning step', () => {
    const stack: AppStack = { reasoning: harborRef(), active: [], saved: {} };
    expect(ownerFor(step('s', 'reasoning'), stack).ref).toEqual(harborRef());
  });
});
