// B6: a project's standing instructions ride into EVERY driver, not only the
// desktop session and the stack. The pocket model and both cloud drivers
// receive them at build time, so a project's context is the same wherever the
// chat is answered. Drivers are mocked to capture what the factory hands them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';

const mem = new Map<string, string>();
const secrets = new Map<string, string>();

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  openExternal: () => {},
  dataUnlockState: async () => 'ok',
  storeGetJson: async (k: string) => {
    const v = mem.get(k);
    return v ? JSON.parse(v) : undefined;
  },
  storeSetJson: async (k: string, v: unknown) => {
    mem.set(k, JSON.stringify(v));
  },
  storeGet: async (k: string) => mem.get(k) ?? null,
  storeSet: async (k: string, v: string) => {
    mem.set(k, v);
  },
  storeDelete: async (k: string) => {
    mem.delete(k);
  },
  sealExistingKeys: async () => {},
  secretGet: async (k: string) => secrets.get(k) ?? null,
  secretSet: async (k: string, v: string) => {
    secrets.set(k, v);
  },
  secretDelete: async (k: string) => {
    secrets.delete(k);
  },
}));

vi.mock('../src/lib/insights.js', () => ({
  loadInsights: async () => {},
  logEvent: () => {},
  logOnce: () => {},
  setInsightsEnabled: () => {},
  insightsAsText: () => '',
  insightsCount: () => 0,
  clearInsights: async () => {},
}));

const captured = vi.hoisted(() => ({
  device: [] as unknown[][],
  claude: [] as unknown[][],
  openai: [] as unknown[][],
}));

class FakeDriver {
  subscribe(_sink: (e: DriverEvent, seq: number) => void) {
    return () => {};
  }
  send() {}
  abort() {}
  answerApproval() {}
  dispose() {}
}
vi.mock('../src/drivers/onDeviceDriver.js', () => ({
  OnDeviceDriver: class extends FakeDriver {
    readonly kind = 'device';
    constructor(...args: unknown[]) {
      super();
      captured.device.push(args);
    }
  },
}));
vi.mock('../src/drivers/cloudClaudeDriver.js', () => ({
  CloudClaudeDriver: class extends FakeDriver {
    readonly kind = 'cloud';
    constructor(...args: unknown[]) {
      super();
      captured.claude.push(args);
    }
  },
  CLAUDE_MODELS: [],
  DEFAULT_CLAUDE_MODEL: 'claude-x',
}));
vi.mock('../src/drivers/cloudOpenAiDriver.js', () => ({
  CloudOpenAiDriver: class extends FakeDriver {
    readonly kind = 'cloud';
    constructor(...args: unknown[]) {
      super();
      captured.openai.push(args);
    }
  },
}));

const { useApp } = await import('../src/state/store.js');

const INSTRUCTIONS = 'Always answer in French. The repo uses pnpm.';

async function projectWithInstructions(): Promise<void> {
  const id = await useApp.getState().createProject('Alpha');
  await useApp.getState().updateProject(id, { instructions: INSTRUCTIONS });
}

describe('standing instructions ride into every driver (B6)', () => {
  beforeEach(() => {
    mem.clear();
    secrets.clear();
    captured.device.length = 0;
    captured.claude.length = 0;
    captured.openai.length = 0;
    useApp.setState({
      conversations: {},
      order: [],
      activeId: undefined,
      settings: { onboarded: true, claudeModel: 'x', deviceModels: { m1: 'Pocket' } },
      cloudKeyPresent: true,
      connectedProviders: { openai: true },
    });
  });

  it('the pocket model receives the project instructions', async () => {
    await projectWithInstructions();
    await useApp.getState().newConversation({ kind: 'device', modelId: 'm1', modelName: 'Pocket' });
    expect(captured.device).toHaveLength(1);
    expect(JSON.stringify(captured.device[0])).toContain(INSTRUCTIONS);
  });

  it('Claude receives the project instructions', async () => {
    secrets.set('oscode.secret.anthropic', 'k');
    await projectWithInstructions();
    await useApp
      .getState()
      .newConversation({ kind: 'cloud', provider: 'anthropic', model: 'claude-x' });
    expect(captured.claude).toHaveLength(1);
    expect(JSON.stringify(captured.claude[0])).toContain(INSTRUCTIONS);
  });

  it('an OpenAI-compatible provider receives the project instructions', async () => {
    secrets.set('oscode.secret.openai', 'k');
    await projectWithInstructions();
    await useApp.getState().newConversation({ kind: 'cloud', provider: 'openai', model: 'gpt-5' });
    expect(captured.openai).toHaveLength(1);
    expect(JSON.stringify(captured.openai[0])).toContain(INSTRUCTIONS);
  });
});
