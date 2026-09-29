// The direct Claude chat (a Claude model picked by itself, not through the
// Stack). The pure parts first: the context meter reads the model's real
// window (P2-14), and vision folds images and video frames into the turn.
// Then the turn itself (build 2026-09-29, package cloud), on the real SDK over
// a mocked WebView fetch: it streams word by word on every shell (Anthropic
// answers cross-origin calls, so Claude needs neither the Electron channel nor
// the shim), Stop closes the turn at once on every branch and keeps the
// partial in the chat and in history, a stream that drops keeps its partial
// too, and the usage, refusal note, Chain of Thought, humanizer and the amber
// cloud turn all still hold.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  platform: 'ios' as 'web' | 'ios' | 'electron',
  stream: vi.fn(),
  native: vi.fn(),
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => h.platform,
  isDesktop: () => h.platform === 'electron',
}));
vi.mock('../src/lib/streamingFetch.js', () => ({ streamingFetch: h.stream }));
vi.mock('../src/lib/nativeFetch.js', () => ({ nativeFetch: h.native }));

import {
  CLAUDE_MODELS,
  CloudClaudeDriver,
  DEFAULT_CLAUDE_MODEL,
  buildVisionContent,
  contextPercentFor,
  contextWindowFor,
} from '../src/drivers/cloudClaudeDriver.js';
import { frameAttachment, type Attachment } from '../src/lib/attachments.js';
import { setChainOfThought } from '../src/lib/chainOfThought.js';
import { VIDEO_FRAMES_SYSTEM_NOTE } from '../src/lib/videoAttach.js';
import type { AppVaultPack } from '../src/drivers/types.js';
import type { ChatStreamEvent } from '../src/lib/electronBridge.js';

describe('cloud context meter (P2-14)', () => {
  it('every listed model carries a real context window', () => {
    for (const m of CLAUDE_MODELS) expect(m.contextWindow).toBeGreaterThanOrEqual(200_000);
  });

  it('reads against the model real window', () => {
    // Opus 5 (the default) has a 1M context window.
    expect(contextWindowFor(DEFAULT_CLAUDE_MODEL)).toBe(1_000_000);
    // 100k tokens is 10% of a 1M window.
    expect(contextPercentFor(DEFAULT_CLAUDE_MODEL, 100_000)).toBe(10);
    // An unknown model falls back to the 200k default window.
    expect(contextPercentFor('mystery-model', 100_000)).toBe(50);
  });

  it('clamps at 100 percent', () => {
    expect(contextPercentFor(DEFAULT_CLAUDE_MODEL, 2_000_000)).toBe(100);
  });
});

describe('buildVisionContent', () => {
  const image = (id: string): Attachment => ({
    id,
    name: `${id}.png`,
    mime: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    isImage: true,
  });

  it('leaves a plain text turn as a string, no frames', () => {
    const { content, hasFrames } = buildVisionContent('hello', []);
    expect(content).toBe('hello');
    expect(hasFrames).toBe(false);
  });

  it('appends an image block and keeps the text, no frames', () => {
    const { content, hasFrames } = buildVisionContent('look', [image('a')]);
    expect(hasFrames).toBe(false);
    expect(Array.isArray(content)).toBe(true);
    const arr = content as Array<{ type: string; text?: string }>;
    expect(arr[0]!.type).toBe('image');
    expect(arr[arr.length - 1]).toEqual({ type: 'text', text: 'look' });
  });

  it('interleaves a header and per-frame labels for a video, flags frames', () => {
    const frames = [0, 1].map((i) =>
      frameAttachment({
        base64: `F${i}`,
        meta: { groupId: 'g1', videoName: 'clip.mp4', index: i + 1, count: 2, timeSec: i * 3 },
      }),
    );
    const { content, hasFrames } = buildVisionContent('what happens', frames);
    expect(hasFrames).toBe(true);
    const arr = content as Array<{ type: string; text?: string }>;
    // header, label, image, label, image, user text
    expect(arr[0]!.type).toBe('text');
    expect(arr[0]!.text).toContain('clip.mp4');
    expect(arr[1]).toEqual({ type: 'text', text: 'Frame 1 of 2, at 0:00' });
    expect(arr[2]!.type).toBe('image');
    expect(arr[3]).toEqual({ type: 'text', text: 'Frame 2 of 2, at 0:03' });
    expect(arr[4]!.type).toBe('image');
    expect(arr[arr.length - 1]).toEqual({ type: 'text', text: 'what happens' });
  });
});

// ---- the turn, on the real SDK ------------------------------------------------

const enc = new TextEncoder();
const sseEvent = (type: string, payload: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const messageStart = (inputTokens = 1000) =>
  sseEvent('message_start', {
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 1 },
    },
  });
const blockStart = (index: number, block: Record<string, unknown>) =>
  sseEvent('content_block_start', { index, content_block: block });
const textDelta = (text: string, index = 0) =>
  sseEvent('content_block_delta', { index, delta: { type: 'text_delta', text } });
const thinkingDelta = (thinking: string, index = 0) =>
  sseEvent('content_block_delta', { index, delta: { type: 'thinking_delta', thinking } });
const blockStop = (index = 0) => sseEvent('content_block_stop', { index });
const messageEnd = (stopReason = 'end_turn', outputTokens = 5) => [
  sseEvent('message_delta', {
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }),
  sseEvent('message_stop'),
];
/** A whole text reply, as Anthropic streams it. */
const textReply = (pieces: string[], stopReason = 'end_turn') => [
  messageStart(),
  blockStart(0, { type: 'text', text: '' }),
  ...pieces.map((p) => textDelta(p)),
  blockStop(),
  ...messageEnd(stopReason),
];

/** A streamed Messages response from `parts`: it then ends, drops, or hangs. */
function sse(parts: string[], end: 'close' | 'fail' | 'hang' = 'close'): Response {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at < parts.length) controller.enqueue(enc.encode(parts[at++]!));
      else if (end === 'fail') controller.error(new TypeError('The network connection was lost.'));
      else if (end === 'hang') return new Promise<void>(() => undefined);
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function claudeChat(opts: ConstructorParameters<typeof CloudClaudeDriver>[5] = {}) {
  const driver = new CloudClaudeDriver(
    'sk-ant',
    'claude-opus-5',
    undefined,
    undefined,
    undefined,
    opts,
  );
  const events: DriverEvent[] = [];
  driver.subscribe((e) => events.push(e));
  return { driver, events };
}

const dones = (events: DriverEvent[]) => events.filter((e) => e.type === 'task-done');
const deltas = (events: DriverEvent[]) =>
  events.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text);
const finalText = (events: DriverEvent[]) =>
  (events.findLast((e) => e.type === 'text-final') as { text: string } | undefined)?.text;
const settled = (events: DriverEvent[], n = 1) =>
  vi.waitFor(() => expect(dones(events)).toHaveLength(n));
/** The Messages request the fetch sent on its call at `index`. */
const sentBody = (index = 0) =>
  JSON.parse((h.stream.mock.calls[index]![1] as RequestInit).body as string) as {
    system: unknown;
    thinking?: unknown;
    messages: Array<{ role: string; content: unknown }>;
  };

/** The Electron preload's chat channel, so a test can see Claude never uses it. */
function fakeBridge() {
  const b = {
    platform: 'electron',
    chatStream: vi.fn(async () => ({ status: 200 })),
    chatStreamAbort: vi.fn(async () => undefined),
    onChatStream: (_cb: (e: ChatStreamEvent) => void) => () => undefined,
  };
  (globalThis as { window?: unknown }).window = { oscode: b };
  return b;
}

beforeEach(() => {
  h.platform = 'ios';
  h.stream.mockReset();
  h.native.mockReset();
  setChainOfThought(false);
  delete (globalThis as { window?: unknown }).window;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Claude streams on every shell', () => {
  for (const shell of ['electron', 'ios', 'web'] as const) {
    it(`on ${shell}, word by word through the WebView fetch`, async () => {
      h.platform = shell;
      const bridge = shell === 'electron' ? fakeBridge() : undefined;
      let release: (() => void) | undefined;
      const parts = textReply(['Hel', 'lo.']);
      let at = 0;
      h.stream.mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              // Hold the reply after its first word, to see it on screen early.
              if (at === 3 && !release) {
                return new Promise<void>((r) => (release = r));
              }
              if (at < parts.length) controller.enqueue(enc.encode(parts[at++]!));
              else controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
      const { driver, events } = claudeChat();
      driver.send('hi');
      await vi.waitFor(() => expect(deltas(events)).toEqual(['Hel']));
      expect(dones(events)).toHaveLength(0);
      release!();
      await settled(events);
      expect(deltas(events)).toEqual(['Hel', 'lo.']);
      expect(finalText(events)).toBe('Hello.');
      expect(dones(events)[0]).toMatchObject({ reason: 'complete' });
      expect(String(h.stream.mock.calls[0]![0])).toBe('https://api.anthropic.com/v1/messages');
      expect(h.native).not.toHaveBeenCalled();
      if (bridge) expect(bridge.chatStream).not.toHaveBeenCalled();
      driver.dispose();
    });
  }

  it('reports usage against the real window, and marks the turn as cloud', async () => {
    h.stream.mockResolvedValueOnce(sse(textReply(['ok'])));
    const { driver, events } = claudeChat();
    driver.send('hi');
    await settled(events);
    expect(events.find((e) => e.type === 'turn-start')).toMatchObject({
      model: 'claude-opus-5',
      providerKind: 'cloud',
    });
    expect(events.find((e) => e.type === 'usage')).toMatchObject({
      promptTokens: 1000,
      completionTokens: 5,
      dollars: 0,
      contextPercent: contextPercentFor('claude-opus-5', 1000),
    });
    driver.dispose();
  });

  it('a refusal says so after the answer', async () => {
    h.stream.mockResolvedValueOnce(sse(textReply([''], 'refusal')));
    const { driver, events } = claudeChat();
    driver.send('hi');
    await settled(events);
    const types = events.map((e) => e.type);
    expect(types.slice(-3)).toEqual(['text-final', 'note', 'task-done']);
    expect(events.find((e) => e.type === 'note')).toMatchObject({
      message: 'Claude declined that request. Rephrase and try again.',
    });
    driver.dispose();
  });

  it('keeps the whole answer in history for the next turn', async () => {
    h.stream.mockResolvedValueOnce(sse(textReply(['First answer.'])));
    const { driver, events } = claudeChat();
    driver.send('one');
    await settled(events);
    h.stream.mockResolvedValueOnce(sse(textReply(['Second.'])));
    driver.send('two');
    await settled(events, 2);
    expect(sentBody(1).messages).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: [{ type: 'text', text: 'First answer.' }] },
      { role: 'user', content: 'two' },
    ]);
    driver.dispose();
  });
});

describe('Stop closes the Claude turn at once, on every branch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  async function stopsAtOnce(driver: { abort(): void }, events: DriverEvent[]): Promise<void> {
    expect(dones(events)).toHaveLength(0);
    driver.abort();
    await vi.advanceTimersByTimeAsync(250);
    expect(dones(events)).toHaveLength(1);
    expect(dones(events)[0]).toMatchObject({ reason: 'aborted' });
  }

  it('mid-stream: the partial kept in the chat and in history, the next turn free', async () => {
    h.stream.mockResolvedValueOnce(
      sse(
        [messageStart(), blockStart(0, { type: 'text', text: '' }), textDelta('Hello wor')],
        'hang',
      ),
    );
    const { driver, events } = claudeChat();
    driver.send('hi');
    await vi.waitFor(() => expect(deltas(events)).toEqual(['Hello wor']));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('Hello wor');
    // The request itself was told to stop.
    const signal = (h.stream.mock.calls[0]![1] as RequestInit).signal!;
    expect(signal.aborted).toBe(true);
    h.stream.mockResolvedValueOnce(sse(textReply(['ok'])));
    driver.send('go on');
    await vi.advanceTimersByTimeAsync(250);
    expect(dones(events)).toHaveLength(2);
    expect(sentBody(1).messages).toContainEqual({ role: 'assistant', content: 'Hello wor' });
    driver.dispose();
  });

  it('before the first byte', async () => {
    h.stream.mockImplementationOnce(() => new Promise(() => undefined));
    const { driver, events } = claudeChat();
    driver.send('hi');
    await vi.waitFor(() => expect(h.stream).toHaveBeenCalledTimes(1));
    await stopsAtOnce(driver, events);
    expect(finalText(events)).toBe('');
    driver.dispose();
  });

  it('while the vault pack is still being prepared, and it never sends after', async () => {
    let settlePack: (() => void) | undefined;
    const pack: AppVaultPack = {
      prepare: () => new Promise<void>((resolve) => (settlePack = resolve)),
      render: () => ({}),
    };
    const { driver, events } = claudeChat({ vaultPack: pack });
    driver.send('hi');
    await vi.advanceTimersByTimeAsync(5);
    await stopsAtOnce(driver, events);
    settlePack!();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.stream).not.toHaveBeenCalled();
    expect(dones(events)).toHaveLength(1);
    driver.dispose();
  });
});

describe('a Claude turn that fails after it began keeps what it wrote', () => {
  it('a dropped stream: an error, and the partial in the chat and in history', async () => {
    h.stream.mockResolvedValueOnce(
      sse(
        [messageStart(), blockStart(0, { type: 'text', text: '' }), textDelta('Hello wor')],
        'fail',
      ),
    );
    const { driver, events } = claudeChat();
    driver.send('hi');
    await settled(events);
    expect(dones(events)[0]).toMatchObject({ reason: 'error' });
    expect((dones(events)[0] as { message?: string }).message).toBeTruthy();
    expect(finalText(events)).toBe('Hello wor');
    h.stream.mockResolvedValueOnce(sse(textReply(['ok'])));
    driver.send('go on');
    await settled(events, 2);
    expect(sentBody(1).messages).toContainEqual({ role: 'assistant', content: 'Hello wor' });
    driver.dispose();
  });
});

describe('what a Claude request carries', () => {
  it('Chain of Thought: thinking streams into its block only while on, never into the answer', async () => {
    const reply = () =>
      sse([
        messageStart(),
        blockStart(0, { type: 'thinking', thinking: '' }),
        thinkingDelta('Pondering.'),
        blockStop(0),
        blockStart(1, { type: 'text', text: '' }),
        textDelta('Blue.', 1),
        blockStop(1),
        ...messageEnd(),
      ]);
    const thinking = (events: DriverEvent[]) =>
      events
        .filter((e) => e.type === 'thinking-delta')
        .map((e) => (e as { text: string }).text)
        .join('');
    h.stream.mockResolvedValueOnce(reply());
    let { driver, events } = claudeChat();
    driver.send('why?');
    await settled(events);
    expect(sentBody(0).thinking).toBeUndefined();
    expect(thinking(events)).toBe('');
    expect(finalText(events)).toBe('Blue.');
    driver.dispose();

    setChainOfThought(true);
    h.stream.mockResolvedValueOnce(reply());
    ({ driver, events } = claudeChat());
    driver.send('why?');
    await settled(events);
    expect(sentBody(1).thinking).toBeDefined();
    expect(thinking(events)).toBe('Pondering.');
    expect(finalText(events)).toBe('Blue.');
    driver.dispose();
  });

  it('images and video frames ride the user turn, with the frame note', async () => {
    h.stream.mockResolvedValueOnce(sse(textReply(['A clip.'])));
    const { driver, events } = claudeChat();
    const frames = [0, 1].map((i) =>
      frameAttachment({
        base64: `F${i}`,
        meta: { groupId: 'g1', videoName: 'clip.mp4', index: i + 1, count: 2, timeSec: i * 3 },
      }),
    );
    driver.send('what happens', frames);
    await settled(events);
    const user = sentBody().messages.at(-1)!;
    expect(user.role).toBe('user');
    expect(
      (user.content as Array<{ type: string }>).filter((b) => b.type === 'image'),
    ).toHaveLength(2);
    expect(JSON.stringify(sentBody().system)).toContain(VIDEO_FRAMES_SYSTEM_NOTE);
    driver.dispose();
  });

  it('the humanizer rides the system prompt unless Humanize Writing is off', async () => {
    h.stream.mockImplementation(async () => sse(textReply(['ok'])));
    let { driver, events } = claudeChat();
    driver.send('hi');
    await settled(events);
    expect(JSON.stringify(sentBody(0).system)).toContain('HUMANIZER STANDARD');
    driver.dispose();

    ({ driver, events } = claudeChat({ humanize: false }));
    driver.send('hi');
    await settled(events);
    expect(JSON.stringify(sentBody(1).system)).not.toContain('HUMANIZER STANDARD');
    driver.dispose();
  });
});
