// Your writing voice and app actions (founder, 2026-10-01). The voice is the
// person's own instruction, so it rides to every seat; the app actions
// contract tells a model it may propose a settings change, so it rides only to
// a seat whose requests stay on this network (judged by address). A proposal
// changes nothing until the person taps it, and only keys on the list apply.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({ stream: vi.fn() }));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  secretGet: async (key: string) => (key.includes('.byom.') ? null : 'sk-test'),
  storeGetJson: async () => null,
}));
vi.mock('../src/lib/streamingFetch.js', () => ({ streamingFetch: h.stream }));
vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async () => ({ started: true }),
  },
}));

const { StackDriver } = await import('../src/drivers/stackDriver.js');
const { packSeatFor } = await import('../src/lib/vaultSeat.js');
const { APP_ACTIONS, appActionKeyFromClass, appActionsAsked, appActionsContract, parseAppActions } =
  await import('../src/lib/appActions.js');
const { WRITING_VOICE_CHAT_PROMPT, WRITING_VOICE_MAX, cleanWritingVoice, writingVoiceLine } =
  await import('../src/lib/writingVoice.js');
const { appActionPlan, writingVoiceSeed } = await import('../src/state/appActionOps.js');
const { SETTINGS_REACH } = await import('../src/lib/settingsReach.js');
import type { AppStack, StackModelRef } from '../src/lib/stack.js';

const VOICE = 'Dry and brief. British spelling. No exclamation marks.';

describe('your writing voice', () => {
  it('is trimmed, capped, and empty reads as none', () => {
    expect(cleanWritingVoice('  ')).toBeUndefined();
    expect(cleanWritingVoice(undefined)).toBeUndefined();
    expect(cleanWritingVoice(`  ${VOICE}\n`)).toBe(VOICE);
    expect(cleanWritingVoice('a'.repeat(WRITING_VOICE_MAX + 50))!.length).toBe(WRITING_VOICE_MAX);
    expect(writingVoiceLine('')).toBeUndefined();
    expect(writingVoiceLine(VOICE)).toContain(VOICE);
  });

  it('stays on this device: a prompt never follows the account', () => {
    expect(SETTINGS_REACH.writingVoice).toBe('device');
  });

  it("opens the shaping chat on the founder's prompt, left open to finish", () => {
    const first = writingVoiceSeed(undefined);
    expect(first.text).toBe(WRITING_VOICE_CHAT_PROMPT);
    expect(first.text.startsWith('Provide the OpenShore customized writing prompt')).toBe(true);
    expect(first.text.endsWith('style of ')).toBe(true);
    // A second tap seeds again.
    expect(writingVoiceSeed(first).seq).toBe(first.seq + 1);
  });
});

const SHAPING = `${WRITING_VOICE_CHAT_PROMPT}a ship's log.`;
// The founder's screenshot (2026-10-02): an ordinary writing request in a chat
// that never asked for a setting.
const BRIEFING = 'Write me a 1-page briefing on the expedition and team. Make it exciting';

describe('the app actions contract', () => {
  it('reaches a local seat and never a seat that leaves this network', () => {
    const local = appActionsContract(false, [SHAPING]);
    expect(local).toContain('openshore-set:<key>');
    expect(local).toContain('writingVoice');
    expect(local).toMatch(/added to their Settings or would rather copy it in themselves/);
    expect(appActionsContract(true, [SHAPING])).toBeUndefined();
  });

  it('rides only once the chat asks for a setting, and stays for the rest of it', () => {
    expect(appActionsContract(false, [])).toBeUndefined();
    expect(appActionsContract(false, ['When was the first expedition?', BRIEFING])).toBeUndefined();
    expect(appActionsAsked([BRIEFING])).toEqual([]);
    expect(appActionsAsked(['Help me with my writing voice'])).toEqual(['writingVoice']);
    // A follow-up in the shaping chat keeps it.
    expect(appActionsContract(false, [SHAPING, 'Shorter, please.'])).toContain('writingVoice');
  });

  it('shows a full example, never an empty fence, and says when not to use it', () => {
    const local = appActionsContract(false, [SHAPING])!;
    expect(local).not.toMatch(/```openshore-set:writingVoice[^\n]*\n```/);
    expect(local).toMatch(/```openshore-set:writingVoice\n<the full value/);
    expect(local).toMatch(/For any other request, just answer it/);
  });

  it('names every key asked for', () => {
    const asked = Object.keys(APP_ACTIONS).map((k) => k);
    const local = appActionsContract(false, [SHAPING])!;
    for (const key of asked) expect(local).toContain(`${key}:`);
  });
});

describe('a proposal', () => {
  const reply = [
    'Here is your prompt.',
    '',
    '```openshore-set:writingVoice',
    VOICE,
    '```',
    '',
    '```openshore-set:apiKey',
    'sk-nope',
    '```',
    '',
    'Want me to add it to your Settings, or would you rather copy it in yourself?',
  ].join('\n');

  it('is read from its fence, and an unknown key is left as code', () => {
    expect(parseAppActions(reply)).toEqual([{ key: 'writingVoice', value: VOICE }]);
    expect(appActionKeyFromClass('language-openshore-set:writingVoice')).toBe('writingVoice');
    expect(appActionKeyFromClass('hljs language-openshore-set:writingVoice')).toBe('writingVoice');
    expect(appActionKeyFromClass('language-openshore-set:apiKey')).toBeUndefined();
    expect(appActionKeyFromClass('language-ts')).toBeUndefined();
    // A small model that drops the prefix still gets the card.
    expect(appActionKeyFromClass('language-writingVoice')).toBe('writingVoice');
    expect(appActionKeyFromClass('language-writingvoice')).toBe('writingVoice');
    expect(appActionKeyFromClass('language-apiKey')).toBeUndefined();
  });

  it('applies only a listed key with a value it takes', () => {
    expect(appActionPlan('writingVoice', `  ${VOICE}  `)).toEqual({
      patch: { writingVoice: VOICE },
      toast: 'Your writing voice saved to Settings, Writing.',
    });
    expect(appActionPlan('writingVoice', '   ')).toBeUndefined();
    expect(appActionPlan('apiKey', 'sk-nope')).toBeUndefined();
    expect(appActionPlan('__proto__', 'x')).toBeUndefined();
  });
});

// The Stack, end to end: what each seat's system prompt carries.
const enc = new TextEncoder();
function oai(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
      );
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}
const onThisComputer: StackModelRef = {
  kind: 'byom',
  id: 'b14',
  label: 'Box',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen2.5:14b',
};
const smallOnThisComputer: StackModelRef = { ...onThisComputer, id: 'b3', model: 'llama3.2:3b' };
const gpt: StackModelRef = { kind: 'cloud', provider: 'openai', model: 'gpt-x', label: 'GPT' };
const anchorOnly = (reasoning: StackModelRef): AppStack => ({ reasoning, active: [], saved: {} });

async function systemFor(
  ref: StackModelRef,
  writingVoice?: string,
  ask = SHAPING,
): Promise<string> {
  h.stream.mockReset();
  h.stream.mockImplementation(async () => oai('Hi.'));
  const driver = new StackDriver(anchorOnly(ref), 'offshore', { writingVoice }, undefined, {
    packSeat: (r) => packSeatFor(r, { ownTailnetSuffix: null }),
  });
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  driver.send(ask);
  await vi.waitFor(() => expect(events.some((e) => e.type === 'task-done')).toBe(true));
  driver.dispose();
  const body = JSON.parse((h.stream.mock.calls[0]![1] as RequestInit).body as string) as {
    messages: Array<{ role: string; content: string }>;
  };
  return body.messages.find((m) => m.role === 'system')!.content;
}

describe('the Stack', () => {
  beforeEach(() => h.stream.mockReset());

  it('gives a model on this computer the voice and, in the shaping chat, the contract', async () => {
    const system = await systemFor(onThisComputer, VOICE);
    expect(system).toContain(VOICE);
    expect(system).toContain(appActionsContract(false, [SHAPING])!);
  });

  it('gives a small local seat both too in the shaping chat: each is a few lines', async () => {
    const system = await systemFor(smallOnThisComputer, VOICE);
    expect(system).toContain(VOICE);
    expect(system).toContain('openshore-set:<key>');
  });

  it('gives a small local seat no contract for an ordinary writing request', async () => {
    const system = await systemFor(smallOnThisComputer, VOICE, BRIEFING);
    expect(system).toContain(VOICE);
    expect(system).not.toContain('openshore-set');
  });

  it("gives an Ollama cloud tag on this computer's Ollama no contract: it answers on ollama.com", async () => {
    const tag: StackModelRef = { ...onThisComputer, id: 'tag', model: 'kimi-k3:cloud' };
    const system = await systemFor(tag, VOICE);
    expect(system).toContain(VOICE);
    expect(system).not.toContain('openshore-set');
  });

  it('gives a cloud seat the voice and never the contract', async () => {
    const system = await systemFor(gpt, VOICE);
    expect(system).toContain(VOICE);
    expect(system).not.toContain('openshore-set');
  });

  it('carries no voice line when none is set', async () => {
    const system = await systemFor(gpt);
    expect(system).not.toContain('The person set their own writing voice');
  });
});
