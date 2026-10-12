// Where a media job's work goes (security review, 2026-10-12). A media server
// off this network (ComfyUI or a speech server on a rented machine) gets the
// file the agent named and the step it wrote, so a media tool call asks first
// on the amber card, once per task per model, like any handoff; it is refused
// outright, before anything asks, when the seat that wrote it stays on this
// network and the chat holds a local-only note's text (D5); a vault file kept
// on this computer is never sent to such a server; and a transcript of one
// read on this computer comes back marked local-only. A program on this
// computer (stems, cleanup) never leaves and never asks.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession, type TestSession } from './helpers/session.js';
import { vaultPrivacyConfig, vaultPrivacyHolder } from '../src/core/agent/registry.js';
import { MEDIA_LOCAL_ONLY_DENIED } from '../src/core/agent/loop.js';
import { HANDOFF_LOCAL_ONLY_DENIED } from '../src/harness/privacyLines.js';
import { ConfigSchema } from '../src/config/schema.js';
import { MediaGuard } from '../src/core/ethics/guardedMedia.js';
import { MediaHost } from '../src/media/host.js';
import type { AgentEvent, ApprovalRequest } from '../src/core/agent/types.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** A project with its vault at notes/ (Private/ local-only by default), a
 *  private recording and an open one, and a media host whose transcription,
 *  speech and stems are placed, with ComfyUI and the speech server at the
 *  given addresses. Each job answers without a server. */
function setup(where: { speech: string; comfy?: string }) {
  const cwd = mkdtempSync(join(tmpdir(), 'osc-media-'));
  dirs.push(cwd);
  const vault = join(cwd, 'notes');
  put(vault, 'Private/call.wav', 'private audio');
  put(vault, 'Ideas/open.md', '# Open\n');
  put(vault, 'Private/plan.md', '# Plan\n\nThe launch date is PRIVATE-4471.\n');
  put(cwd, 'talk.wav', 'open audio');
  const config = ConfigSchema.parse({
    media: {
      speech: { baseUrl: where.speech },
      ...(where.comfy ? { comfyui: { baseUrl: where.comfy } } : {}),
    },
    stack: {
      media: {
        transcribe: { runtime: 'speech', catalogId: 'parakeet', model: 'parakeet' },
        speak: { runtime: 'speech', catalogId: 'kokoro-82m', model: 'kokoro' },
        stems: { runtime: 'separator', catalogId: 'htdemucs-ft', model: 'htdemucs_ft.yaml' },
      },
    },
  });
  const host = new MediaHost({ config, guard: new MediaGuard(), outRoot: join(cwd, '.media') });
  const sent: string[] = [];
  host.transcribe = async (path: string) => {
    sent.push(path);
    return 'the words';
  };
  host.speak = async (text: string) => {
    sent.push(text);
    return join(cwd, '.media', 'speech.mp3');
  };
  host.stems = async (path: string) => {
    sent.push(path);
    return [join(cwd, '.media', 'vocals.wav')];
  };
  return { cwd, vault, host, sent };
}

function session(
  ctx: ReturnType<typeof setup>,
  turns: ReturnType<typeof textTurn>[],
  approve?: (r: ApprovalRequest) => { approve: boolean },
): TestSession {
  const s = makeTestSession(new MockProvider('mock', turns), {
    cwd: ctx.cwd,
    vaultRoot: ctx.vault,
    media: ctx.host,
    ...(approve ? { approve } : {}),
  });
  const holder = vaultPrivacyHolder(vaultPrivacyConfig(s.config), () => s.toolContext.vaultRoot);
  s.toolContext.vaultPrivacy = holder;
  s.toolContext.vaultRefresh = (o) => holder.refresh(o);
  s.toolContext.vaultSettings = () => holder.settings();
  return s;
}

const cards = (approvals: ApprovalRequest[]) => approvals.filter((a) => a.kind === 'cloud-spend');
const denied = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === 'tool-denied' ? [e.reason] : []));
const ended = (events: AgentEvent[], name: string) =>
  events.flatMap((e) => (e.type === 'tool-end' && e.call.name === name ? [e.result] : []));

describe('a media server off this network', () => {
  it('asks on the amber card before the file goes, naming the server', async () => {
    const ctx = setup({ speech: 'https://speech.example' });
    const s = session(ctx, [
      toolTurn('transcribeAudio', { audio: 'talk.wav' }, 't1'),
      toolTurn('transcribeAudio', { audio: 'talk.wav', format: 'srt' }, 't2'),
      textTurn('Done.'),
    ]);
    await s.agent.run('transcribe my talk');
    const [card, again] = cards(s.approvals);
    expect(again).toBeUndefined();
    expect(card!.summary).toBe(
      'This step goes to parakeet, the cloud model you placed for transcription.',
    );
    expect(card!.detail).toBe(
      'The file the agent named and the step it wrote go to speech.example. Nothing is sent without this approval.',
    );
    expect(ctx.sent).toHaveLength(2);
  });

  it('sends nothing when the person says no', async () => {
    const ctx = setup({ speech: 'https://speech.example' });
    const s = session(
      ctx,
      [toolTurn('speakText', { text: 'Hello there.' }, 's1'), textTurn('Okay.')],
      (r) => ({ approve: r.kind !== 'cloud-spend' }),
    );
    await s.agent.run('read this aloud');
    expect(ctx.sent).toEqual([]);
    expect(denied(s.events)).toEqual(['You declined sending this step to kokoro.']);
  });

  it('never gets a vault file kept on this computer', async () => {
    const ctx = setup({ speech: 'https://speech.example' });
    const s = session(ctx, [
      toolTurn('transcribeAudio', { audio: 'notes/Private/call.wav' }, 't1'),
      textTurn('Okay.'),
    ]);
    await s.agent.run('transcribe my call');
    expect(ctx.sent).toEqual([]);
    expect(denied(s.events)).toEqual([MEDIA_LOCAL_ONLY_DENIED]);
  });
  it('is refused before anything asks once the chat holds a private note', async () => {
    const ctx = setup({ speech: 'https://speech.example' });
    const s = session(ctx, [
      toolTurn('readFile', { path: 'notes/Private/plan.md' }, 'r1'),
      toolTurn('speakText', { text: 'The launch date is PRIVATE-4471.' }, 's1'),
      textTurn('Okay.'),
    ]);
    await s.agent.run('read my plan aloud');
    expect(ctx.sent).toEqual([]);
    expect(cards(s.approvals)).toEqual([]);
    expect(denied(s.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
  });
});

describe('a media server on this computer', () => {
  it('runs without a card, and marks a private recording’s transcript local-only', async () => {
    const ctx = setup({ speech: 'http://127.0.0.1:8080' });
    const s = session(ctx, [
      toolTurn('transcribeAudio', { audio: 'notes/Private/call.wav' }, 't1'),
      toolTurn('transcribeAudio', { audio: 'talk.wav' }, 't2'),
      textTurn('Done.'),
    ]);
    await s.agent.run('transcribe both');
    expect(cards(s.approvals)).toEqual([]);
    const [privateOne, openOne] = ended(s.events, 'transcribeAudio');
    expect(privateOne).toMatchObject({ ok: true, localOnly: true });
    expect(openOne!.localOnly).toBeUndefined();
  });

  it('a program on this computer never asks', async () => {
    const ctx = setup({ speech: 'https://speech.example' });
    const s = session(ctx, [
      toolTurn('processAudio', { job: 'stems', audio: 'talk.wav' }, 'p1'),
      textTurn('Done.'),
    ]);
    await s.agent.run('split it');
    expect(cards(s.approvals)).toEqual([]);
    expect(ctx.sent).toHaveLength(1);
  });
});
