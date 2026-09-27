// Vault M4 end to end (wave 2): the real pieces together, no fakes between
// them. A temp vault with a normal note, a Private/ note (local-only by the
// default config) and an excluded note; the engine's own context source
// (createVaultContextSource over the real engine index), the real pack
// builder, the real privacy judge compiled from config the way bootstrap
// compiles it (lazyVaultPrivacy(vaultPrivacyConfig(config))), the real vault
// tools, and the loop, driven by a mock provider. What it pins:
// - a local seat with vault.context 'full' gets the normal and the private
//   note in its pack, never the excluded one;
// - a seat that leaves this network gets neither the private nor the excluded
//   text, in the system prompt or in a vaultRead or vaultSearch result, and
//   the context-pack card counts the private note as withheld;
// - an escalation after a local private read sends the cloud seat the stub;
// - with Memory off there is no pack at all.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MockProvider, textTurn, toolTurn, type ScriptedTurn } from './helpers/mockProvider.js';
import { makeTestSession, type TestSession } from './helpers/session.js';
import { createVaultContextSource } from '../src/core/vault/contextSource.js';
import { closeEngineVaultIndexes, engineVaultIndex } from '../src/core/vault/engineIndex.js';
import { lazyVaultPrivacy, vaultPrivacyConfig } from '../src/core/agent/registry.js';
import { VAULT_NOTES_FRAMING } from '../src/harness/vaultContext.js';
import { LOCAL_ONLY_STUB } from '../src/harness/vault/privacy.js';
import { ConfigSchema } from '../src/config/schema.js';
import type { AgentEvent } from '../src/core/agent/types.js';
import type { ChatRequest } from '../src/providers/types.js';

const NORMAL = 'Garden/lanterns.md';
const PRIVATE = 'Private/lanterns-diary.md';
const EXCLUDED = 'Archive/lanterns-old.md';

const NORMAL_TEXT = 'NORMAL-MARK the lantern festival route runs along the river.';
const PRIVATE_TEXT = 'PRIVATE-MARK my lantern festival budget is tight this year.';
const EXCLUDED_TEXT = 'EXCLUDED-MARK the old lantern festival route went uphill.';

const TASK = 'What do my notes say about the lantern festival route?';

function makeVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'osc-e2e-vault-'));
  const notes: Record<string, string> = {
    [NORMAL]: `# Lanterns\n\n${NORMAL_TEXT}\n`,
    [PRIVATE]: `# Lantern diary\n\n${PRIVATE_TEXT}\n`,
    [EXCLUDED]: `# Old lanterns\n\n${EXCLUDED_TEXT}\n`,
  };
  for (const [rel, text] of Object.entries(notes)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

async function session(
  provider: MockProvider,
  options: {
    memory?: boolean;
    escalation?: MockProvider;
    extra?: Record<string, unknown>;
  } = {},
): Promise<TestSession> {
  const vaultRoot = makeVault();
  // Built before the run, as a person's vault is long before their task.
  await (await engineVaultIndex(vaultRoot)).whenReconciled(10_000);
  const vault = { context: 'full', exclude: ['Archive/**'] };
  // Exactly as bootstrap wires them: one compiled judge for the tools and the
  // pack, and the engine's own source over the session's vault root.
  const privacy = lazyVaultPrivacy(vaultPrivacyConfig(ConfigSchema.parse({ vault })));
  const s = makeTestSession(provider, {
    vaultRoot,
    escalation: options.escalation,
    vaultContext: createVaultContextSource({ vaultRoot, privacy }),
    configOverrides: {
      vault,
      ...(options.memory === false ? { memory: { enabled: false } } : {}),
      ...options.extra,
    },
  });
  s.toolContext.vaultPrivacy = privacy;
  return s;
}

const systemOf = (req: ChatRequest): string => {
  const sys = req.messages.find((m) => m.role === 'system');
  return typeof sys?.content === 'string' ? sys.content : JSON.stringify(sys?.content ?? '');
};

const packEvents = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'context-pack') as Array<
    Extract<AgentEvent, { type: 'context-pack' }>
  >;

const reads = (): ScriptedTurn[] => [
  toolTurn('vaultRead', { path: PRIVATE }, 'r1'),
  toolTurn('vaultRead', { path: EXCLUDED }, 'r2'),
  toolTurn('vaultSearch', { query: 'lantern festival' }, 'r3'),
  textTurn('It runs along the river.'),
];

afterEach(async () => {
  await closeEngineVaultIndexes();
});

describe('the vault context layer end to end (Vault M4)', () => {
  it("a local seat's full pack carries the normal and the private note, never the excluded", async () => {
    const provider = new MockProvider('mock', [textTurn('Along the river.')]);
    const s = await session(provider);
    await s.agent.run(TASK);
    const system = systemOf(provider.requests[0]!);
    expect(system).toContain(VAULT_NOTES_FRAMING);
    expect(system).toContain(NORMAL_TEXT);
    expect(system).toContain(PRIVATE_TEXT);
    expect(system).not.toContain(EXCLUDED_TEXT);
    const [card] = packEvents(s.events);
    expect(card?.seat).toBe('local');
    expect(card?.mode).toBe('full');
    expect(card?.withheld).toBe(0);
    const paths = card!.sources.map((x) => x.path);
    expect(paths).toContain(NORMAL);
    expect(paths).toContain(PRIVATE);
    expect(paths).not.toContain(EXCLUDED);
  });

  it('a seat that leaves this network gets neither the private nor the excluded text', async () => {
    const provider = new MockProvider('anthropic', reads(), { kind: 'cloud' });
    const s = await session(provider, {
      extra: {
        providers: { anthropic: { kind: 'anthropic' } },
        stack: { orchestrator: { provider: 'anthropic', model: 'mock-model' } },
      },
    });
    await s.agent.run(TASK);
    expect(provider.requests.length).toBeGreaterThanOrEqual(4);
    const system = systemOf(provider.requests[0]!);
    expect(system).toContain(NORMAL_TEXT);
    expect(system).not.toContain(PRIVATE_TEXT);
    expect(system).not.toContain(EXCLUDED_TEXT);
    // Every request, tool results included, over the whole run.
    const sent = JSON.stringify(provider.requests);
    expect(sent).not.toContain('PRIVATE-MARK');
    expect(sent).not.toContain('EXCLUDED-MARK');
    // The reads ran and said why they gave nothing.
    const ends = s.events.filter((e) => e.type === 'tool-end') as Array<
      Extract<AgentEvent, { type: 'tool-end' }>
    >;
    expect(ends.map((e) => e.call.name)).toEqual(['vaultRead', 'vaultRead', 'vaultSearch']);
    expect(ends[0]!.result.content).toContain('stays on this computer');
    expect(ends[1]!.result.content).not.toContain('EXCLUDED-MARK');
    expect(ends[2]!.result.content).toContain(NORMAL);
    expect(ends[2]!.result.content).not.toContain(PRIVATE);
    expect(ends[2]!.result.content).not.toContain(EXCLUDED);
    const [card] = packEvents(s.events);
    expect(card?.seat).toBe('cloud');
    expect(card?.withheld).toBe(1);
    expect(card!.sources.map((x) => x.path)).not.toContain(PRIVATE);
  });

  it('an escalation after a local private read sends the cloud seat the stub', async () => {
    const local = new MockProvider('mock', [
      toolTurn('vaultRead', { path: PRIVATE }, 'c1'),
      toolTurn('readFile', { path: 'missing-1.txt' }, 'c2'),
      toolTurn('readFile', { path: 'missing-2.txt' }, 'c3'),
    ]);
    const cloud = new MockProvider('anthropic', [textTurn('Cloud finished.')], { kind: 'cloud' });
    const s = await session(local, {
      escalation: cloud,
      extra: {
        providers: { anthropic: { kind: 'anthropic' } },
        routing: { escalation: { enabled: true, afterToolFailures: 2 } },
      },
    });
    await s.agent.run(TASK);
    expect(s.events.some((e) => e.type === 'model-switch')).toBe(true);
    expect(JSON.stringify(local.requests[1]!.messages)).toContain('PRIVATE-MARK');
    const sent = JSON.stringify(cloud.requests);
    expect(sent).not.toContain('PRIVATE-MARK');
    expect(sent).not.toContain('EXCLUDED-MARK');
    expect(sent).toContain(LOCAL_ONLY_STUB);
    expect(packEvents(s.events).map((c) => c.seat)).toEqual(['local', 'cloud']);
  });

  it('with Memory off there is no pack', async () => {
    const provider = new MockProvider('mock', [textTurn('Along the river.')]);
    const s = await session(provider, { memory: false });
    await s.agent.run(TASK);
    expect(systemOf(provider.requests[0]!)).not.toContain(VAULT_NOTES_FRAMING);
    expect(systemOf(provider.requests[0]!)).not.toContain('NORMAL-MARK');
    expect(packEvents(s.events)).toEqual([]);
  });
});
