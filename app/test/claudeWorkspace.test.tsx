// A Claude key linked to a person, not a workspace (maintainer's phone,
// 2026-10-08): the key listed models, so it saved as connected, and then
// every chat stopped asking for the workspace ID. The stop's "Open Cloud
// Connections" led to a connected row whose only tap was Disconnect, so
// there was nowhere to put the ID. These pin the way through: the key check
// asks the message path too, a connected Claude has a workspace row, and the
// stop lands on its field.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const net = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; headers: Record<string, string> }>,
  reply: {} as Record<string, { status: number; body?: string }>,
}));
vi.mock('../src/lib/nativeFetch.js', () => ({
  nativeFetch: async (url: string, req: { headers?: Record<string, string> } = {}) => {
    net.calls.push({ url, headers: req.headers ?? {} });
    const path = new URL(url).pathname;
    const r = net.reply[path] ?? { status: 200, body: '{}' };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => JSON.parse(r.body ?? '{}'),
      text: async () => r.body ?? '',
    };
  },
}));

const app = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const workspaces: string[] = [];
  const reset = () => {
    for (const k of Object.keys(state)) delete state[k];
    workspaces.length = 0;
    Object.assign(state, {
      settings: { anthropicWorkspaceId: undefined },
      connectivity: { homeReachable: false, online: true },
      connectedProviders: { anthropic: true },
      showToast: () => {},
      setView: () => {},
      viewTrail: [],
      goBack: () => {},
      startGuideChat: async () => {},
      connectProvider: async () => {},
      disconnectProvider: async () => {},
      setAnthropicWorkspace: async (ws: string) => {
        workspaces.push(ws);
        return 'valid';
      },
      clearConnectionsFocus: () => {},
      connectionsFocus: undefined,
    });
  };
  reset();
  return { state, workspaces, reset };
});
vi.mock('../src/state/store.js', () => ({
  useApp: Object.assign(
    <T,>(select?: (s: typeof app.state) => T) => (select ? select(app.state) : app.state),
    { getState: () => app.state },
  ),
  stackAdmin: () => true,
  agenticView: () => ({}),
  harnessView: () => ({}),
}));

const WORKSPACE_ERROR = JSON.stringify({
  type: 'error',
  error: { type: 'invalid_request_error', message: 'anthropic-workspace-id header is required' },
});

describe('the Claude key check', () => {
  beforeEach(() => {
    net.calls.length = 0;
    net.reply = {};
  });

  it('asks the message path, so a key that lists models but cannot chat needs its workspace', async () => {
    const { validateProviderKey } = await import('../src/lib/providers.js');
    net.reply['/v1/messages/count_tokens'] = { status: 400, body: WORKSPACE_ERROR };
    expect(await validateProviderKey('anthropic', 'sk-ant-x')).toBe('needs-workspace');
    expect(net.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/v1/models',
      '/v1/messages/count_tokens',
    ]);
  });

  it('sends the workspace on both calls, and passes once the message path does', async () => {
    const { validateProviderKey } = await import('../src/lib/providers.js');
    expect(await validateProviderKey('anthropic', 'sk-ant-x', 'wrkspc_1')).toBe('valid');
    expect(net.calls.every((c) => c.headers['anthropic-workspace-id'] === 'wrkspc_1')).toBe(true);
  });

  it('a rejected key is still invalid, and never reaches the second call', async () => {
    const { validateProviderKey } = await import('../src/lib/providers.js');
    net.reply['/v1/models'] = { status: 401 };
    expect(await validateProviderKey('anthropic', 'sk-ant-x')).toBe('invalid');
    expect(net.calls).toHaveLength(1);
  });
});

describe('the workspace stop', () => {
  it('points at the workspace field, and only the workspace stop does', async () => {
    const { pointsAtWorkspace } = await import('../src/lib/chatRescue.js');
    const { WORKSPACE_HINT } = await import('../src/lib/providers.js');
    expect(pointsAtWorkspace(WORKSPACE_HINT)).toBe(true);
    expect(
      pointsAtWorkspace('Claude rejected the API key. Check it under Cloud Connections.'),
    ).toBe(false);
  });
});

describe('a connected Claude in Cloud Connections', () => {
  let dom: TestDom;
  beforeEach(async () => {
    dom = await mountDom();
    app.reset();
    Object.assign(window.HTMLElement.prototype, { scrollTo() {}, scrollIntoView() {} });
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  });
  afterEach(async () => {
    await dom.unmount();
  });

  const tapRow = async (label: string) => {
    const row = [...dom.container.querySelectorAll<HTMLElement>('.settings-row')].find(
      (r) => r.querySelector('.settings-row-label')?.textContent === label,
    );
    if (!row) throw new Error(`No "${label}" row`);
    const { act } = await import('react');
    await act(async () => {
      row.dispatchEvent(new window.Event('click', { bubbles: true }));
    });
  };

  it('has a workspace row that sets the ID without the key again', async () => {
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    await tapRow('Claude workspace');
    expect(dom.container.querySelector('[placeholder="sk-ant-..."]')).toBeNull();
    await dom.type('wrkspc_...', 'wrkspc_abc');
    await dom.click('Save');
    expect(app.workspaces).toEqual(['wrkspc_abc']);
  });

  it('shows the saved workspace on the row', async () => {
    app.state.settings = { anthropicWorkspaceId: 'wrkspc_saved' };
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    expect(dom.text()).toContain('wrkspc_saved');
  });

  it('a stop that asks for the workspace lands on its field', async () => {
    app.state.connectionsFocus = 'anthropic';
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    await dom.settle();
    expect(dom.container.querySelector('[placeholder="wrkspc_..."]')).not.toBeNull();
    expect(dom.container.querySelector('[placeholder="sk-ant-..."]')).toBeNull();
  });

  it('no workspace row while Claude is not connected', async () => {
    app.state.connectedProviders = {};
    const { ConnectionsScreen } = await import('../src/screens/ConnectionsScreen.js');
    await dom.render(<ConnectionsScreen />);
    expect(dom.text()).not.toContain('Claude workspace');
  });
});
