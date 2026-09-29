// The free chat (CTO ruling 8, 2026-09-29): one function yields the answer's
// events, and both hosts pass them on (the daemon as server sent events, the
// desktop's window over IPC). Driven directly here against a fake Ollama, so
// the test reads exactly what the model was sent: no tools, no session left
// behind, a seat that leaves this network refused by address, the limits, one
// answer at a time per caller, and no vault pack unless the host builds one.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freeChat, type FreeChatEvent } from '../src/daemon/freeChat.js';
import { sessionsDir } from '../src/daemon/session.js';

let home: string;
let realHome: string | undefined;
let ollama: Server;
let port: number;
let sent: Array<Record<string, unknown>>;
let held: ServerResponse[];
let holdAnswers: boolean;

function finish(res: ServerResponse): void {
  res.write(`${JSON.stringify({ message: { content: 'Hello there.' }, done: false })}\n`);
  res.end(`${JSON.stringify({ done: true })}\n`);
}

function writeConfig(baseUrl: string, model = 'qwen2.5:7b'): void {
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      providers: { ollama: { kind: 'openai-compatible', baseUrl } },
      stack: { orchestrator: { provider: 'ollama', model } },
    }),
  );
}

beforeEach(async () => {
  sent = [];
  held = [];
  holdAnswers = false;
  ollama = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/api/version') {
        res.end(JSON.stringify({ version: '0.9.0' }));
      } else if (req.url === '/api/show') {
        res.end(JSON.stringify({ model_info: { 'qwen2.context_length': 32768 } }));
      } else if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.2:3b' }] }));
      } else if (req.url === '/api/chat') {
        sent.push(JSON.parse(raw) as Record<string, unknown>);
        if (holdAnswers) held.push(res);
        else finish(res);
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => ollama.listen(0, '127.0.0.1', resolve));
  const addr = ollama.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  port = addr.port;
  home = mkdtempSync(join(tmpdir(), 'oschome-free-'));
  process.env.OSC_HOME = home;
  realHome = process.env.HOME;
  process.env.HOME = home;
  writeConfig(`http://127.0.0.1:${port}`);
});

afterEach(() => {
  for (const res of held.splice(0)) finish(res);
  ollama.close();
  process.env.HOME = realHome;
  delete process.env.OSC_HOME;
  rmSync(home, { recursive: true, force: true });
});

async function all(events: AsyncIterable<FreeChatEvent>): Promise<FreeChatEvent[]> {
  const out: FreeChatEvent[] = [];
  for await (const ev of events) out.push(ev);
  return out;
}

const hello = { messages: [{ role: 'user', content: 'What is a closure?' }] };

describe('the free chat', () => {
  it('streams one answer from the local model, with no tools and no session left behind', async () => {
    const events = await all(freeChat(hello, { signal: new AbortController().signal }));
    expect(events.map((e) => e.type)).toEqual(['open', 'text', 'done']);
    expect(events[1]).toEqual({ type: 'text', delta: 'Hello there.' });
    // What the model was sent: the fixed line first, the person's turn, and
    // no tools at all.
    const req = sent[0]!;
    expect(req.tools).toBeUndefined();
    const messages = req.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toMatch(/no tools here/);
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'What is a closure?' });
    // Nothing was opened: no session folder, so nothing to journal or resume.
    const dir = sessionsDir();
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('refuses a model that leaves this network, before asking it anything', async () => {
    writeConfig('https://models.example.com/v1');
    const events = await all(freeChat(hello, { signal: new AbortController().signal }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'refused', status: 400 });
    expect((events[0] as { error: string }).error).toMatch(/local models/);
    expect(sent).toHaveLength(0);
  });

  it('with no model at all, refuses with a plain reason', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({}));
    const events = await all(freeChat(hello, { signal: new AbortController().signal }));
    expect(events).toEqual([
      expect.objectContaining({
        type: 'refused',
        status: 400,
        error: expect.stringMatching(/No local model/),
      }),
    ]);
  });

  it('holds the limits: no messages, too many, too much text, and a model this computer lacks', async () => {
    const signal = new AbortController().signal;
    expect(await all(freeChat({}, { signal }))).toEqual([
      expect.objectContaining({ type: 'refused', status: 400 }),
    ]);
    const many = Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' }));
    expect(await all(freeChat({ messages: many }, { signal }))).toEqual([
      expect.objectContaining({ type: 'refused', status: 413 }),
    ]);
    const big = [{ role: 'user', content: 'x'.repeat(600 * 1024) }];
    expect(await all(freeChat({ messages: big }, { signal }))).toEqual([
      expect.objectContaining({ type: 'refused', status: 413 }),
    ]);
    const unknown = await all(freeChat({ ...hello, model: 'gpt-imaginary' }, { signal }));
    expect(unknown).toEqual([
      expect.objectContaining({
        type: 'refused',
        status: 400,
        error: expect.stringContaining('gpt-imaginary'),
      }),
    ]);
    const served = await all(freeChat({ ...hello, model: 'llama3.2:3b' }, { signal }));
    expect(served.at(-1)).toEqual({ type: 'done' });
    expect(sent.at(-1)!.model).toBe('llama3.2:3b');
  });

  it('answers one message at a time per caller, and frees the lane when the answer ends', async () => {
    holdAnswers = true;
    const busy = new Set<string>();
    const lane = { key: 'desktop', busy };
    const first = all(freeChat(hello, { signal: new AbortController().signal, lane }));
    for (let i = 0; i < 200 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
    expect(held).toHaveLength(1);

    const second = await all(freeChat(hello, { signal: new AbortController().signal, lane }));
    expect(second).toEqual([expect.objectContaining({ type: 'refused', status: 409 })]);

    holdAnswers = false;
    finish(held.shift()!);
    expect((await first).at(-1)).toEqual({ type: 'done' });
    expect(busy.size).toBe(0);
    const third = await all(freeChat(hello, { signal: new AbortController().signal, lane }));
    expect(third.at(-1)).toEqual({ type: 'done' });
  });

  it('a stop ends the answer and frees the lane', async () => {
    holdAnswers = true;
    const busy = new Set<string>();
    const stop = new AbortController();
    const run = all(freeChat(hello, { signal: stop.signal, lane: { key: 'desktop', busy } }));
    for (let i = 0; i < 200 && held.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
    stop.abort();
    const events = await run;
    // The provider ends quietly or with the abort; either way it ends, with
    // no text from the held answer.
    expect(['done', 'error']).toContain(events.at(-1)?.type);
    expect(events.some((e) => e.type === 'text')).toBe(false);
    expect(busy.size).toBe(0);
  });

  it('carries a vault pack only when the host builds one', async () => {
    const signal = new AbortController().signal;
    // A body that asks for a pack gets none without a builder (the desktop
    // window, signed out).
    const bare = await all(freeChat({ ...hello, vaultPack: { projectName: 'Login' } }, { signal }));
    expect(bare.some((e) => e.type === 'context-pack')).toBe(false);
    const withPack = await all(
      freeChat(hello, {
        signal,
        pack: async () => ({
          text: 'NOTE: the zeppelin flag stays off.',
          event: {
            type: 'context-pack',
            seat: 'local',
            mode: 'current-state',
            tokens: 9,
            budgetTokens: 100,
            sources: [],
            withheld: 0,
            cold: false,
          },
        }),
      }),
    );
    expect(withPack.map((e) => e.type)).toEqual(['open', 'context-pack', 'text', 'done']);
    const system = (sent.at(-1)!.messages as Array<{ content: string }>)[0]!.content;
    expect(system.endsWith('NOTE: the zeppelin flag stays off.')).toBe(true);
  });
});
