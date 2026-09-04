// The client-side codemagic tool handler (the phone equivalent of the engine
// tool). It reads the saved target, calls the on-device REST client, and must
// mirror the engine tool's behavior. The REST client and settings store are
// mocked, so this needs no network and no device.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ target: undefined as unknown }));
const rest = vi.hoisted(() => ({
  triggerBuild: vi.fn(),
  getBuild: vi.fn(),
  buildLogExcerpt: vi.fn(),
}));

vi.mock('../src/lib/platform.js', () => ({
  storeGetJson: vi.fn(async () => ({ launch: { target: store.target } })),
}));
vi.mock('../src/lib/codemagic.js', () => ({
  triggerBuild: rest.triggerBuild,
  getBuild: rest.getBuild,
  buildLogExcerpt: rest.buildLogExcerpt,
  isTerminal: (s: string) => ['finished', 'failed', 'canceled', 'timeout'].includes(s),
}));

import {
  runCodemagicTool,
  codemagicSystemNote,
  codemagicToolSpec,
} from '../src/lib/codemagicTool.js';

const target = { id: 'l1', platform: 'ios', appId: 'app1', workflowId: 'wf1', branch: 'main' };

beforeEach(() => {
  store.target = undefined;
  rest.triggerBuild.mockReset();
  rest.getBuild.mockReset();
  rest.buildLogExcerpt.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('codemagicToolSpec', () => {
  it('offers the three actions', () => {
    expect(codemagicToolSpec.name).toBe('codemagic');
    expect(codemagicToolSpec.input_schema.properties.action.enum).toEqual([
      'trigger',
      'status',
      'logs',
    ]);
  });
});

describe('runCodemagicTool', () => {
  it('refuses a trigger with no saved target', async () => {
    const out = await runCodemagicTool({ action: 'trigger' });
    expect(out).toMatch(/no launch target/i);
    expect(rest.triggerBuild).not.toHaveBeenCalled();
  });

  it('triggers using the saved target and returns the buildId', async () => {
    store.target = target;
    rest.triggerBuild.mockResolvedValue('build-7');
    const out = await runCodemagicTool({ action: 'trigger' });
    expect(rest.triggerBuild).toHaveBeenCalledWith({
      appId: 'app1',
      workflowId: 'wf1',
      branch: 'main',
    });
    expect(out).toContain('build-7');
  });

  it('honors a branch override on trigger', async () => {
    store.target = target;
    rest.triggerBuild.mockResolvedValue('b2');
    await runCodemagicTool({ action: 'trigger', branch: 'release/2' });
    expect(rest.triggerBuild).toHaveBeenCalledWith({
      appId: 'app1',
      workflowId: 'wf1',
      branch: 'release/2',
    });
  });

  it('needs a buildId for status', async () => {
    const out = await runCodemagicTool({ action: 'status' });
    expect(out).toMatch(/buildId/);
  });

  it('reads status and flags a failure toward logs', async () => {
    rest.getBuild.mockResolvedValue({ status: 'failed', artefacts: [] });
    const out = await runCodemagicTool({ action: 'status', buildId: 'b1' });
    expect(out).toMatch(/failed/);
    expect(out).toMatch(/logs/);
  });

  it('reports a green build and where it lands', async () => {
    rest.getBuild.mockResolvedValue({ status: 'finished', artefacts: [] });
    const out = await runCodemagicTool({ action: 'status', buildId: 'b1' });
    expect(out).toMatch(/green/i);
    expect(out).toMatch(/TestFlight|App Store|Google Play/);
  });

  it('returns the redacted excerpt for logs', async () => {
    rest.getBuild.mockResolvedValue({ status: 'failed', artefacts: [{ name: 'x.log' }] });
    rest.buildLogExcerpt.mockResolvedValue('error: Code Sign failed');
    const out = await runCodemagicTool({ action: 'logs', buildId: 'b1' });
    expect(out).toContain('Code Sign failed');
    expect(out).toMatch(/redacted/i);
  });

  it('surfaces a REST failure as text, never throws', async () => {
    store.target = target;
    rest.triggerBuild.mockRejectedValue(new Error('402 out of build minutes'));
    const out = await runCodemagicTool({ action: 'trigger' });
    expect(out).toMatch(/failed/i);
    expect(out).toContain('402');
  });
});

describe('codemagicSystemNote', () => {
  it('names the tool loop and the honest phone limit', () => {
    const note = codemagicSystemNote();
    expect(note).toMatch(/codemagic tool/i);
    expect(note).toMatch(/cannot edit the repo/i);
    expect(note).toMatch(/green/i);
  });
});
