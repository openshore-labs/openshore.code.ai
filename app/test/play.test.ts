import { describe, expect, it } from 'vitest';
import {
  briefTodos,
  extractJson,
  formatBriefTable,
  handoffNote,
  mergeReplan,
  ownerFor,
  ownerLabel,
  parsePlan,
  parseReplan,
  planPrompt,
  readySteps,
  sanitizePlay,
  stepRunner,
  topoOrder,
  type Play,
  type PlayStep,
} from '../src/lib/play.js';
import { harborRef, type AppStack, type StackModelRef } from '../src/lib/stack.js';
import { imageStepCoveredNote } from '../src/lib/imageNote.js';

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

// D13 (founder, 2026-10-07): an unplaced vision step goes to the model an
// image in the chat would go to (the driver's routeVision, carried as the
// stack's imageReader), and the brief names it, never the old Opus default.
describe('an unplaced vision step', () => {
  const haiku: StackModelRef = {
    kind: 'cloud',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
  };
  const stack: AppStack = { reasoning: harborRef(), active: [], saved: {} };

  it('goes to the image reader, named without a reasoning tag', () => {
    expect(ownerLabel(step('s', 'vision'), { ...stack, imageReader: haiku })).toBe(
      'Claude Haiku 4.5',
    );
  });

  it('reads as the anchor covering it when the reader is the anchor', () => {
    const own: AppStack = { ...stack, reasoning: claude };
    expect(ownerLabel(step('s', 'vision'), { ...own, imageReader: claude })).toBe(
      'Claude (reasoning)',
    );
  });

  it('falls to the anchor the driver runs when nothing can read images', () => {
    expect(ownerFor(step('s', 'vision'), stack)).toMatchObject({
      ref: harborRef(),
      fellBack: true,
    });
    // With no anchor set, the anchor is Harbor Lite, as in the driver.
    const bare = { active: [], saved: {} } as AppStack;
    expect(ownerFor(step('s', 'reasoning'), bare).ref).toEqual(harborRef());
  });

  it('tells the planner who covers it', () => {
    expect(planPrompt('read it', { ...stack, imageReader: haiku })).toContain(
      'vision (Image reading): no specialist, Claude Haiku 4.5 covers it',
    );
    expect(planPrompt('read it', stack)).toMatch(
      /vision \(Image reading\): no specialist, the reasoning model covers it/,
    );
  });
});

// The founder's ruling (2026-10-07): an unplaced image step runs on the chat
// path's reader with no card, so the working note says nothing is set for
// Image reading and names the model that reads the step, and its connection.
describe("an image step's working note", () => {
  const haiku: StackModelRef = {
    kind: 'cloud',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
  };
  const gpt: StackModelRef = { kind: 'cloud', provider: 'openai', model: 'gpt-5', label: 'GPT-5' };
  const sonar: StackModelRef = {
    kind: 'cloud',
    provider: 'perplexity',
    model: 'sonar',
    label: 'Sonar',
  };
  const read: PlayStep = { ...step('s', 'vision'), title: 'Read the chart' };
  const base: AppStack = { reasoning: sonar, active: [], saved: {} };

  it('names a cloud reader by its display name and its connection', () => {
    expect(handoffNote(read, { ...base, imageReader: haiku })).toBe(
      'Read the chart. No image model is set in Stack, so Claude Haiku 4.5 reads it on your Claude connection.',
    );
    expect(handoffNote(read, { ...base, imageReader: gpt })).toBe(
      'Read the chart. No image model is set in Stack, so GPT-5 reads it on your OpenAI connection.',
    );
  });

  it('names a Reasoning model that can see by its role', () => {
    expect(handoffNote(read, { ...base, reasoning: claude, imageReader: claude })).toBe(
      'Read the chart. No image model is set in Stack, so Claude, your Reasoning model, reads it.',
    );
  });

  it('names a model you connected as one', () => {
    const own: StackModelRef = { ...coder, label: 'LLaVA 7B' };
    expect(handoffNote(read, { ...base, active: [], imageReader: own })).toBe(
      'Read the chart. No image model is set in Stack, so LLaVA 7B, a model you connected, reads it.',
    );
  });

  it('says the Reasoning model works from the text when nothing reads images', () => {
    expect(handoffNote(read, base)).toBe(
      'Read the chart. Nothing here can read images yet, so Sonar, your Reasoning model, works from the text.',
    );
  });

  it('keeps the plain handoff for a model placed for Image reading', () => {
    const placed: AppStack = {
      ...base,
      active: [{ ref: haiku, placement: { category: 'vision' } }],
    };
    expect(handoffNote(read, { ...placed, imageReader: haiku })).toBe(
      'Read the chart. Handing to Claude Haiku 4.5.',
    );
  });

  it('keeps the plain handoff for a step that names its own model', () => {
    const named: AppStack = {
      ...base,
      active: [{ ref: coder, placement: { category: 'coding' } }],
      imageReader: haiku,
    };
    expect(handoffNote({ ...read, owner: 'byom:c1' }, named)).toBe(
      'Read the chart. Handing to Coder.',
    );
  });

  it('names a model set for Image reading that cannot take the step, and who covers it', () => {
    expect(imageStepCoveredNote('Read the chart', harborRef(), sonar)).toBe(
      'Read the chart. Harbor Lite cannot read images yet, so Sonar, your Reasoning model, works from the text.',
    );
    const own: StackModelRef = { ...coder, label: 'LLaVA 7B' };
    expect(imageStepCoveredNote('Read the chart', own, sonar)).toBe(
      'Read the chart. LLaVA 7B is out of reach, so Sonar, your Reasoning model, works from the text.',
    );
  });

  it('leaves every other step as it was', () => {
    expect(handoffNote(step('w', 'writing'), { ...base, imageReader: haiku })).toBe(
      'Step w. Handing to Sonar (reasoning).',
    );
  });
});

// The task list names the model a step really runs on (follow-up,
// 2026-10-08). ownerFor reads the Stack slots before capability, so a model
// on this device set for Image reading owns an image step there, while the
// runner hands that step to the Reasoning model: stepRunner is the one rule
// both read, so the list, the note and the run cannot drift apart.
describe('stepRunner: who a step really runs on', () => {
  const sonar: StackModelRef = {
    kind: 'cloud',
    provider: 'perplexity',
    model: 'sonar',
    label: 'Sonar',
  };
  const phoneReader: AppStack = {
    reasoning: sonar,
    active: [{ ref: harborRef(), placement: { category: 'vision' } }],
    saved: {},
  };
  const read: PlayStep = { ...step('s', 'vision'), title: 'Read the chart' };

  it('hands an image step set on this device to the Reasoning model, and the list says so', () => {
    expect(ownerFor(read, phoneReader).ref).toEqual(harborRef());
    expect(stepRunner(read, phoneReader)).toEqual({
      ref: sonar,
      placement: undefined,
      fellBack: true,
      covered: harborRef(),
    });
    expect(ownerLabel(read, phoneReader)).toBe('Sonar (reasoning)');
    const play: Play = { summary: 'Explain the chart', steps: [read] };
    expect(briefTodos(play, phoneReader)[0]!.owner).toBe('Sonar (reasoning)');
    expect(formatBriefTable(play, phoneReader)).toContain('Read the chart  ->  Sonar (reasoning)');
    // The note names the model set there and the one that covers it.
    expect(handoffNote(read, phoneReader)).toBe(
      'Read the chart. Harbor Lite cannot read images yet, so Sonar, your Reasoning model, works from the text.',
    );
  });

  it('hands a step whose owner is out of reach to the Reasoning model', () => {
    const own: AppStack = {
      reasoning: sonar,
      active: [
        { ref: { ...coder, label: 'LLaVA 7B' }, placement: { category: 'vision' } },
        { ref: coder, placement: { category: 'coding' } },
      ],
      saved: {},
    };
    const away = { ...own, reachable: (r: StackModelRef) => r.kind !== 'byom' };
    expect(ownerLabel(read, away)).toBe('Sonar (reasoning)');
    expect(handoffNote(read, away)).toBe(
      'Read the chart. LLaVA 7B is out of reach, so Sonar, your Reasoning model, works from the text.',
    );
    expect(ownerLabel(step('c', 'coding'), away)).toBe('Sonar (reasoning)');
    expect(handoffNote(step('c', 'coding'), away)).toBe('Step c. Handing to Sonar (reasoning).');
    // In reach, each runs on its own model, as before.
    expect(ownerLabel(read, own)).toBe('LLaVA 7B');
    expect(ownerLabel(step('c', 'coding'), own)).toBe('Coder');
  });

  it('hands any step owned on this device to the Reasoning model, the way the runner does', () => {
    const fast: AppStack = {
      reasoning: claude,
      active: [{ ref: harborRef(), placement: { category: 'fast' } }],
      saved: {},
    };
    expect(stepRunner(step('f', 'fast'), fast).ref).toEqual(claude);
    expect(ownerLabel(step('f', 'fast'), fast)).toBe('Claude (reasoning)');
    expect(handoffNote(step('f', 'fast'), fast)).toBe('Step f. Handing to Claude (reasoning).');
  });

  // D5 on a plan (sp-plan, egress-claims-2): while the plan draws on a
  // private note, a step bound for a model that leaves this network runs on
  // the Reasoning model, and the list and the note say so and why.
  it('keeps a private plan off every model that leaves, and says why', () => {
    const own: AppStack = {
      reasoning: coder,
      active: [
        { ref: claude, placement: { category: 'writing' } },
        { ref: claude, placement: { category: 'vision' } },
      ],
      saved: {},
    };
    const kept = { ...own, keepPrivate: (r: StackModelRef) => r.kind === 'cloud' };
    const draft = { ...step('w', 'writing'), title: 'Draft' };
    expect(stepRunner(draft, kept)).toEqual({
      ref: coder,
      placement: undefined,
      fellBack: true,
      covered: claude,
      private: true,
    });
    expect(ownerLabel(draft, kept)).toBe('Coder (reasoning)');
    expect(ownerLabel(read, kept)).toBe('Coder (reasoning)');
    expect(handoffNote(draft, kept)).toBe(
      'Draft. This plan draws on a private note, so Coder, your Reasoning model, takes it instead of Claude. Private notes never reach a cloud model.',
    );
    expect(handoffNote(read, kept)).toBe(
      'Read the chart. This plan draws on a private note, so Coder, your Reasoning model, takes it instead of Claude. Private notes never reach a cloud model.',
    );
    // Without the mark, each runs on its own model, as before.
    expect(stepRunner(draft, own).ref).toEqual(claude);
    expect(ownerLabel(draft, own)).toBe('Claude');
  });

  it('leaves the anchor as its own runner, never covering itself', () => {
    const bare: AppStack = { reasoning: harborRef(), active: [], saved: {} };
    expect(stepRunner(step('r', 'reasoning'), bare)).toEqual({
      ref: harborRef(),
      placement: undefined,
      fellBack: false,
    });
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
