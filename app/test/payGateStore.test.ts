// The Personal paid gate, ON (VITE_PAY_GATES=1, the build submitted to App
// Review), in the store: sign-in first, then the paywall; chat stays free;
// Crew's pause stays free; the desktop buys through stripe-checkout. The
// flag is read at module load, so the env is stubbed before the store loads.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../src/state/store.js';
import type { Conversation } from '../src/state/types.js';
import { emptyThread } from '../src/state/types.js';

// Hoisted above the imports: a module a static import reaches (types.ts ->
// harborMini.ts) reads the flag when it loads.
vi.hoisted(() => vi.stubEnv('VITE_PAY_GATES', '1'));

const mem = new Map<string, string>();
const opened = vi.hoisted(() => [] as string[]);

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  dataUnlockState: async () => 'ok',
  openExternal: (url: string) => {
    opened.push(url);
  },
  openInAppBrowser: (url: string) => {
    opened.push(url);
  },
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
  secretGet: async () => null,
  secretSet: async () => {},
  secretDelete: async () => {},
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

const sb = vi.hoisted(() => ({
  invoked: [] as Array<{ fn: string; body: unknown }>,
  rows: [] as unknown[],
}));
vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return {
    ...real,
    isConfigured: () => true,
    select: async () => sb.rows,
    rpc: async () => null,
    invokeFunction: async (fn: string, _token: string, body: unknown) => {
      sb.invoked.push({ fn, body });
      return { url: 'https://checkout.stripe.com/c/pay/cs_test' };
    },
  };
});

const { useApp, PAY_GATES_ENABLED } = await import('../src/state/store.js');

const session = () => ({
  accessToken: 'tok',
  refreshToken: 'rt',
  expiresAt: Date.now() + 3_600_000,
  user: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', email: 'a@b.c' },
});

const base = (): AppSettings => ({ onboarded: true, claudeModel: 'x', deviceModels: {} });

function codingChat(): Conversation {
  const at = '2026-09-30T10:00:00.000Z';
  return {
    id: 'code1',
    title: 'Fix the header',
    source: { kind: 'desktop', sessionId: 'sess_1', cwd: '/repo' },
    repoIds: [],
    createdAt: at,
    updatedAt: at,
    thread: emptyThread(),
  };
}

beforeEach(() => {
  mem.clear();
  opened.length = 0;
  sb.invoked.length = 0;
  sb.rows = [];
  useApp.setState({
    authSession: session(),
    accountGate: undefined,
    paywall: undefined,
    userEntitlement: undefined,
    entitlement: undefined,
    view: 'chat',
    viewTrail: [],
    toast: undefined,
    conversations: {},
    order: [],
    activeId: undefined,
    settings: base(),
  });
});

describe('the paid gate, on', () => {
  it('is on in this build', () => {
    expect(PAY_GATES_ENABLED).toBe(true);
  });

  it('opens the paywall, not the sign-in sheet, for a signed-in coding start', async () => {
    const id = await useApp.getState().newConversation({ kind: 'desktop' });
    expect(id).toBeUndefined();
    expect(useApp.getState().paywall).toBe('coding');
    expect(useApp.getState().accountGate).toBeUndefined();
  });

  it('asks for the sign-in first when both are needed', async () => {
    useApp.setState({ authSession: undefined });
    await useApp.getState().newConversation({ kind: 'desktop' });
    expect(useApp.getState().accountGate).toBe('coding');
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('keeps every chat free', async () => {
    const id = await useApp.getState().newConversation({ kind: 'mock' });
    expect(id).toBeDefined();
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('unlocks with a live entitlement', async () => {
    useApp.setState({ userEntitlement: { tierId: 'personal', status: 'active' } });
    expect(useApp.getState().personalUnlockedNow()).toBe(true);
    expect(useApp.getState().personalDoor('coding')).toBe('open');
  });

  it('holds a command inside a coding chat at the paid door', () => {
    useApp.setState({
      conversations: { code1: codingChat() },
      order: ['code1'],
      activeId: 'code1',
    });
    useApp.getState().runCommand('ls');
    expect(useApp.getState().paywall).toBe('coding');
  });

  it('opens the paywall for a message kept on a reopened coding chat', async () => {
    useApp.setState({
      conversations: { code1: { ...codingChat(), pendingFirstMessage: 'fix it' } },
      order: ['code1'],
      activeId: 'code1',
    });
    useApp.getState().openConversation('code1');
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().paywall).toBe('coding');
    expect(useApp.getState().accountGate).toBeUndefined();
  });

  it('charges a routine made, edited, resumed or run; a pause stays free', async () => {
    await useApp.getState().createRoutine({
      name: 'n',
      agentName: 'a',
      persona: 'p',
      task: 't',
      cwd: '/repo',
      schedule: { kind: 'daily', at: '09:00' } as never,
    });
    expect(useApp.getState().paywall).toBe('crew');
    useApp.setState({ paywall: undefined });
    await useApp.getState().updateRoutine('r1', { task: 'new' });
    expect(useApp.getState().paywall).toBe('crew');
    useApp.setState({ paywall: undefined });
    await useApp.getState().updateRoutine('r1', { enabled: true });
    expect(useApp.getState().paywall).toBe('crew');
    useApp.setState({ paywall: undefined });
    await useApp.getState().runRoutineNow('r1');
    expect(useApp.getState().paywall).toBe('crew');
    useApp.setState({ paywall: undefined });
    await useApp.getState().updateRoutine('r1', { enabled: false });
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('buys on the desktop through stripe-checkout, in the browser', async () => {
    await useApp.getState().buyPersonal();
    expect(sb.invoked).toEqual([{ fn: 'stripe-checkout', body: { tierId: 'personal' } }]);
    expect(opened).toEqual(['https://checkout.stripe.com/c/pay/cs_test']);
  });

  // This build is not a desktop (the platform mock), so a chat with the
  // computer's models reaches it over the network: Desktop + phone.
  // Docking is free since 2026-10-07, so a phone's chat with its computer
  // meets no door at all.
  it("lets a phone's chat with its computer through, free", async () => {
    const at = '2026-09-30T10:00:00.000Z';
    useApp.setState({
      conversations: {
        dc1: {
          id: 'dc1',
          title: 'Ask my computer',
          source: { kind: 'desktop-chat', model: 'qwen' },
          repoIds: [],
          createdAt: at,
          updatedAt: at,
          thread: emptyThread(),
          pendingFirstMessage: 'hi',
        },
      },
      order: ['dc1'],
      activeId: 'dc1',
    });
    useApp.getState().openConversation('dc1');
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('asks a signed-out phone for neither a sign-in nor the paywall to chat with its computer', async () => {
    const at = '2026-09-30T10:00:00.000Z';
    useApp.setState({
      authSession: undefined,
      conversations: {
        dc1: {
          id: 'dc1',
          title: 'Ask my computer',
          source: { kind: 'desktop-chat' },
          repoIds: [],
          createdAt: at,
          updatedAt: at,
          thread: emptyThread(),
          pendingFirstMessage: 'hi',
        },
      },
      order: ['dc1'],
      activeId: 'dc1',
    });
    useApp.getState().openConversation('dc1');
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().accountGate).toBeUndefined();
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it("opens the paywall at a screen's paid moment, and lets it through with Plus", () => {
    expect(useApp.getState().requirePersonal('crew')).toBe(false);
    expect(useApp.getState().paywall).toBe('crew');
    useApp.setState({ paywall: undefined, authSession: undefined });
    expect(useApp.getState().requirePersonal('crew')).toBe(false);
    expect(useApp.getState().accountGate).toBe('crew');
    useApp.setState({
      accountGate: undefined,
      authSession: session(),
      userEntitlement: { tierId: 'personal', status: 'active' },
    });
    expect(useApp.getState().requirePersonal('crew')).toBe(true);
    expect(useApp.getState().paywall).toBeUndefined();
    // A free feature never meets the paywall, docking included (2026-10-07).
    useApp.setState({ userEntitlement: undefined });
    expect(useApp.getState().requirePersonal('projects')).toBe(true);
    expect(useApp.getState().requirePersonal('pairing')).toBe(true);
    expect(useApp.getState().paywall).toBeUndefined();
  });

  // The founder's widening (2026-09-30): every room but the free five.
  it('opens the paywall for a Plus room, and walks into a free one', () => {
    for (const room of ['vault', 'terminalroom', 'repos', 'crew'] as const) {
      useApp.setState({ paywall: undefined, view: 'chat' });
      useApp.getState().setView(room, { root: true });
      expect(useApp.getState().view, room).toBe('chat');
      expect(useApp.getState().paywall, room).toBe(room === 'crew' ? 'crew' : 'plus');
    }
    useApp.setState({ paywall: undefined });
    for (const room of ['chats', 'projects', 'stack', 'connections', 'pair', 'settings'] as const) {
      useApp.getState().setView(room, { root: true });
      expect(useApp.getState().view, room).toBe(room);
      expect(useApp.getState().paywall, room).toBeUndefined();
    }
  });

  it('asks a signed-out person to sign in before a Plus room, then says Plus comes next', () => {
    useApp.setState({ authSession: undefined });
    useApp.getState().setView('vault', { root: true });
    expect(useApp.getState().accountGate).toBe('vault');
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('carries a purchase on to the room it was opened for', async () => {
    useApp.getState().setView('vault', { root: true });
    expect(useApp.getState().paywall).toBe('plus');
    sb.rows = [{ tier_id: 'personal', status: 'active', valid_until: null }];
    await useApp.getState().recheckPersonal();
    expect(useApp.getState().paywall).toBeUndefined();
    expect(useApp.getState().view).toBe('vault');
  });

  it('lets a subscriber into every room', () => {
    useApp.setState({ userEntitlement: { tierId: 'personal', status: 'active' } });
    useApp.getState().setView('terminalroom', { root: true });
    expect(useApp.getState().view).toBe('terminalroom');
    expect(useApp.getState().paywall).toBeUndefined();
  });

  it('forgets the room when the sheet is dismissed', async () => {
    useApp.getState().setView('repos', { root: true });
    useApp.getState().closePaywall();
    sb.rows = [{ tier_id: 'personal', status: 'active', valid_until: null }];
    await useApp.getState().recheckPersonal();
    expect(useApp.getState().view).toBe('chat');
  });

  // Get Plus, Restore or I already paid, tapped signed out, opens the
  // sign-in sheet instead of a dead-end toast (CTO, 2026-09-30).
  it('sends a signed-out purchase to the sign-in sheet', async () => {
    for (const tap of ['buyPersonal', 'restorePurchases', 'recheckPersonal'] as const) {
      useApp.setState({ authSession: undefined, paywall: 'plus', accountGate: undefined });
      await useApp.getState()[tap]();
      expect(useApp.getState().accountGate, tap).toBe('plus');
      expect(useApp.getState().paywall, tap).toBeUndefined();
      expect(sb.invoked, tap).toEqual([]);
    }
  });

  // A read that finds Plus while the sheet is open closes it and carries on
  // by itself (CTO, 2026-09-30): no paywall left standing for a subscriber.
  it('closes the sheet when an entitlement read finds Plus', async () => {
    useApp.getState().setView('terminalroom', { root: true });
    expect(useApp.getState().paywall).toBe('plus');
    sb.rows = [{ tier_id: 'personal', status: 'active', valid_until: null }];
    await useApp.getState().refreshEntitlement();
    expect(useApp.getState().paywall).toBeUndefined();
    expect(useApp.getState().view).toBe('terminalroom');
  });

  it('holds saving a handoff to the Vault at the paid door', async () => {
    const at = '2026-09-30T10:00:00.000Z';
    useApp.setState({
      conversations: {
        c1: {
          id: 'c1',
          title: 'Switch',
          source: { kind: 'mock' },
          repoIds: [],
          createdAt: at,
          updatedAt: at,
          thread: {
            ...emptyThread(),
            items: [
              {
                kind: 'note',
                id: 'n1',
                text: 'Handoff',
                handoff: { date: '2026-09-30', project: 'Atlas' },
              } as never,
            ],
          },
        },
      },
      order: ['c1'],
    });
    expect(await useApp.getState().saveHandoffToVault('c1', 'n1')).toBeUndefined();
    expect(useApp.getState().paywall).toBe('plus');
  });

  it('"I already paid" re-reads the account and carries on', async () => {
    useApp.setState({ paywall: 'coding' });
    sb.rows = [{ tier_id: 'personal', status: 'active', valid_until: null }];
    await useApp.getState().recheckPersonal();
    expect(useApp.getState().personalUnlockedNow()).toBe(true);
    expect(useApp.getState().paywall).toBeUndefined();
  });
});
