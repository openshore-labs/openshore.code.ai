// The chat's directions from the 2026-10-07 UI/UX review, as the founder
// ruled them ("Do the remaining recommendations"), mounted in a real (small)
// DOM: the reach pill shows once it can mean something (D1), the round button
// is voice mode until there is something to send (D6), and an open chat has
// a compose icon in its own bar (D7). The desktop opening (D5) is pinned on
// its rule and its glide, since linkedom lays nothing out.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type TestDom } from './support/dom.js';

const mem = new Map<string, string>();

vi.mock('../src/lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform.js')>()),
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
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

let dom: TestDom;

beforeEach(async () => {
  dom = await mountDom();
  mem.clear();
  Object.assign(window, { matchMedia: () => ({ matches: false }) });
  const area = window.HTMLTextAreaElement.prototype as { setSelectionRange?: unknown };
  area.setSelectionRange ??= () => {};
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  Object.assign(window.HTMLElement.prototype, { scrollTo() {} });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(async () => {
  await dom.unmount();
});

const FIELD = 'Chat with OpenShore';
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

async function tap(el: Element | null | undefined, what: string): Promise<void> {
  if (!el) throw new Error(`no ${what}`);
  const { act } = await import('react');
  await act(async () => {
    el.dispatchEvent(new window.Event('click', { bubbles: true }));
  });
}

const NOW = new Date('2026-10-07T10:00:00Z').toISOString();
const openChat = {
  id: 'c-open',
  title: 'Trip budget',
  source: { kind: 'stack' as const },
  createdAt: NOW,
  updatedAt: NOW,
  thread: {
    items: [
      { kind: 'user' as const, id: 'u1', text: 'Help me plan a budget' },
      { kind: 'assistant' as const, id: 'a1', streaming: false, text: 'Sure. What is the trip?' },
    ],
    citations: [],
    busy: false,
    contextPercent: 0,
    dollars: 0,
    pendingApprovals: [],
    todos: [],
    queued: [],
    changedFiles: [],
    lastSeq: 0,
  },
};

async function chatScreen(opts: {
  activeId?: string;
  daemon?: boolean;
  online?: boolean;
}): Promise<typeof import('../src/state/store.js')> {
  const store = await import('../src/state/store.js');
  const { ChatScreen } = await import('../src/screens/ChatScreen.js');
  store.useApp.setState({
    ready: true,
    view: 'chat',
    viewTrail: [],
    activeId: opts.activeId,
    conversations: { [openChat.id]: openChat } as never,
    order: [openChat.id],
    toast: undefined,
    connectivity: { homeReachable: false, online: opts.online ?? true },
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      ...(opts.daemon ? { daemon: { baseUrl: 'http://100.64.0.2:7777', token: 't' } } : {}),
    } as never,
  });
  await dom.render(<ChatScreen compact={true} />);
  return store;
}

const pill = () => dom.container.querySelector('.profile-chip');
const round = () => dom.container.querySelector<HTMLButtonElement>('.send-btn');

describe('D1: the reach pill shows once it can mean something', () => {
  it('waits while online before any computer is connected', { timeout: 20_000 }, async () => {
    await chatScreen({});
    expect(pill()).toBeNull();
  });

  it('shows a lone Offline before any computer is connected', { timeout: 20_000 }, async () => {
    await chatScreen({ online: false });
    expect(pill()?.textContent).toBe('Offline');
  });

  it('shows the status once a computer is connected', { timeout: 20_000 }, async () => {
    await chatScreen({ daemon: true });
    expect(pill()?.textContent).toBe('Offshore');
    // The word sits in its own span, so a phone's chat bar can fold it away
    // while the aria-label keeps it (CS-04).
    expect(pill()?.querySelector('.profile-chip-label')?.textContent).toBe('Offshore');
    expect(pill()?.getAttribute('aria-label')).toBe('Status: Offshore');
  });

  it("folds the pill to its dot in a phone's chat bar, and nowhere else", () => {
    // Up to 560px (the composer's own fold) a chat's bar, the one with a
    // title and a repository line, holds the menu, the name, Terminal, New
    // chat and the pill; the pill gives up its word there so the name and the
    // repository pill read whole (CS-04). A room's bar keeps the word, and the
    // reach keeps 44pt.
    const theme = src('theme.css');
    const fold = theme.match(
      /@media \(max-width: 560px\) \{\n {2}\.topbar:has\(\.topbar-sub\) \.profile-chip \{[\s\S]*?\n\}\n/,
    )?.[0];
    expect(fold).toBeDefined();
    expect(fold).toMatch(/\.topbar:has\(\.topbar-sub\) \.profile-chip-label \{\s*display: none;/);
    expect(fold).toMatch(/\.profile-chip::after \{[^}]*inset: -7px;/);
    // The repository pill keeps its words (the fold above is the room).
    expect(theme).not.toMatch(/\.topbar-sub \.repo-picker-summary[^{]*\{\s*display: none;/);
  });
});

describe('D6: the round button is voice mode until there is something to send', () => {
  it('opens voice on an empty field, and the first character turns it into send', async () => {
    await chatScreen({});
    expect(round()?.getAttribute('aria-label')).toBe('Voice mode: have a spoken conversation');
    expect(round()?.disabled).toBe(false);
    // One voice control: the separate wave button is gone; the mic dictates.
    const voice = [...dom.container.querySelectorAll('button')].filter((b) =>
      /^Voice mode/.test(b.getAttribute('aria-label') ?? ''),
    );
    expect(voice).toHaveLength(1);
    expect(dom.container.querySelector('[aria-label="Dictate"]')).not.toBeNull();
    await dom.type(FIELD, 'h');
    expect(round()?.getAttribute('aria-label')).toBe('Send');
    expect(round()?.classList.contains('voice')).toBe(false);
  });

  it('keeps stop, queue and terminal on the same button, and both glyphs in one cell', () => {
    const composer = src('components', 'Composer.tsx');
    expect(composer).toMatch(/const voiceSlot = voiceOffered && !busy && !hasPayload;/);
    expect(composer).toMatch(/onClick=\{voiceSlot \? voiceTap : \(\) => submit\(\)\}/);
    expect(composer).toMatch(/disabled=\{!voiceSlot && !hasPayload\}/);
    expect(composer).toMatch(/className="send-btn stop press-fb"/);
    expect(composer).toMatch(/\? 'Run command'\s*: busy\s*\? 'Queue message'\s*: 'Send'/);
    const theme = src('theme.css');
    expect(theme).toMatch(
      /\.send-glyph \{[^}]*grid-area: 1 \/ 1;[^}]*transform var\(--dur-4\) var\(--ease-spring\)/,
    );
    expect(theme).toMatch(/\.send-glyph\.on \{\s*opacity: 1;\s*transform: scale\(1\);/);
  });
});

describe('D7: one tap to a new chat from the chat bar', () => {
  it('offers New chat in an open chat, and it opens a fresh one', { timeout: 20_000 }, async () => {
    const store = await chatScreen({ activeId: openChat.id });
    const compose = dom.container.querySelector('.topbar .chat-compose');
    expect(compose?.getAttribute('aria-label')).toBe('New chat');
    expect(compose?.classList.contains('press-fb')).toBe(true);
    await tap(compose, 'compose');
    expect(store.useApp.getState().activeId).toBeUndefined();
    expect(store.useApp.getState().view).toBe('chat');
  });

  it('is not on the empty new chat, which has nothing to leave', { timeout: 20_000 }, async () => {
    await chatScreen({});
    expect(dom.container.querySelector('.chat-compose')).toBeNull();
  });
});

describe('D5: the desktop opening is one group, and the field glides', () => {
  it('groups the greeting and the composer on a fine pointer only', () => {
    const theme = src('theme.css');
    expect(theme).toMatch(
      /@media \(pointer: fine\) \{\s*\.chat-body:has\(> \.greeting\)::before \{\s*content: '';\s*flex: 0 1 calc\(50vh - 210px\);\s*\}\s*\.chat-body:has\(> \.greeting\) > \.greeting \{\s*flex: none;/,
    );
  });

  it('glides on transform over the door clock, and never under reduced motion', () => {
    const chat = src('screens', 'ChatScreen.tsx');
    expect(chat).toMatch(/useOpeningGlide\(bodyRef\)/);
    expect(chat).toMatch(
      /\[\{ transform: `translateY\(\$\{dy\}px\)` \}, \{ transform: 'translateY\(0\)' \}\]/,
    );
    expect(chat).toMatch(/duration: durationMs\('--dur-7', 520\)/);
    expect(chat).toMatch(/easing: easing\('--ease-glide'/);
    // A touch screen keeps its opening and reads no layout for it.
    expect(chat).toMatch(/if \(!window\.matchMedia\?\.\('\(pointer: fine\)'\)\.matches\) return;/);
    // Slack Water surfaces the page itself, so its landing never glides.
    expect(chat).toMatch(
      /if \(prefersReducedMotion\(\) \|\| useApp\.getState\(\)\.slackWater\) return;/,
    );
  });

  it('lands a chat opened from the side at once, never sliding across its words', () => {
    // Sign-off (2026-10-07): only a first send's short transcript leaves open
    // paper under the field's path down.
    const chat = src('screens', 'ChatScreen.tsx');
    expect(chat).toMatch(
      /if \(was && !now\) \{\s*const words = childWith\(body, 'thread'\)\?\.firstElementChild;[\s\S]*?if \(wordsEnd > from\) return;/,
    );
  });
});

describe("the refused device line speaks in the door's words", () => {
  it('sends the person to Connect your computer, never Menu, Pairing', () => {
    const remote = src('drivers', 'remoteDriver.ts');
    expect(remote).toContain('Connect your computer again from Pairing.');
    expect(remote).not.toContain('Pair again from Menu, Pairing.');
  });
});

describe('sign-off: the offline banner and the finished walk say what is there', () => {
  it(
    'names no computer in the offline banner before one is connected',
    {
      timeout: 20_000,
    },
    async () => {
      await chatScreen({ online: false });
      const banner = dom.container.querySelector('.offline-banner')?.textContent ?? '';
      expect(banner).toMatch(/^Offline\. Models on this (phone|iPad) still answer\./);
      expect(banner).not.toMatch(/computer/);
    },
  );

  it('shows the banner for a chosen Offline, as a choice', { timeout: 20_000 }, async () => {
    // The window reports a working network, so only the choice can say Offline.
    const was = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    try {
      const store = await chatScreen({ online: true });
      expect(dom.container.querySelector('.offline-banner')).toBeNull();
      store.useApp.setState((s) => ({
        settings: { ...s.settings, profileOverride: 'offline' } as never,
      }));
      await dom.settle();
      const banner = dom.container.querySelector('.offline-banner')?.textContent ?? '';
      expect(banner).toMatch(/^Offline, by your choice\./);
      expect(banner).toContain('until you follow the connection again');
    } finally {
      if (was) Object.defineProperty(globalThis.navigator, 'onLine', was);
      else delete (globalThis.navigator as { onLine?: boolean }).onLine;
    }
  });

  it('keeps the computer in the banner once one is connected', { timeout: 20_000 }, async () => {
    await chatScreen({ online: false, daemon: true });
    expect(dom.container.querySelector('.offline-banner')?.textContent).toContain(
      'Your computer and cloud models wait for a connection.',
    );
  });

  it(
    'puts the setup door under the hello once the walk is finished',
    {
      timeout: 20_000,
    },
    async () => {
      const { HARBOR_MINI_MODEL_ID } = await import('../src/lib/harborMini.js');
      const store = await import('../src/state/store.js');
      const { ChatScreen } = await import('../src/screens/ChatScreen.js');
      const guide = {
        ...openChat,
        id: 'c-guide',
        title: 'Harbor Lite',
        source: {
          kind: 'device' as const,
          modelId: HARBOR_MINI_MODEL_ID,
          modelName: 'Harbor Lite',
        },
        thread: {
          ...openChat.thread,
          items: [
            { kind: 'assistant' as const, id: 'c-guide-hello', streaming: false, text: 'Hello.' },
            {
              kind: 'assistant' as const,
              id: 'c-guide-setup-1',
              streaming: false,
              text: "That's every step.",
            },
          ],
        },
      };
      store.useApp.setState({
        ready: true,
        view: 'chat',
        viewTrail: [],
        activeId: guide.id,
        conversations: { [guide.id]: guide } as never,
        order: [guide.id],
        connectivity: { homeReachable: false, online: true },
        settings: {
          onboarded: true,
          claudeModel: 'x',
          deviceModels: {},
          guidedSetup: { conversationId: guide.id, skipped: [], finished: true },
        } as never,
      });
      await dom.render(<ChatScreen compact={true} />);
      // One door, under the hello: the button the wrap-up points at.
      const doors = dom.container.querySelectorAll('.guide-setup');
      expect(doors).toHaveLength(1);
      expect(doors[0]!.textContent).toContain('Set up OpenShore');
    },
  );
});
