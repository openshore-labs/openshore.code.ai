// The command card for a program the agent started and left running (P1,
// "run my app"), mounted in a real (small) DOM: it says "Started by
// OpenShore" (a command the person ran does not), and while the program runs,
// a local address in its output becomes an Open link on the desktop, which
// opens that address in the browser. On the phone, and on a desktop driving
// another computer, the address stays plain text in the output.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';
import type { ThreadItem } from '../src/state/types.js';

const env = vi.hoisted(() => ({
  desktop: true,
  preferRemoteHub: false as boolean | undefined,
  opened: [] as string[],
  killed: [] as string[],
}));

vi.mock('../src/lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform.js')>()),
  isDesktop: () => env.desktop,
  isPhone: () => !env.desktop,
  openExternal: (url: string) => env.opened.push(url),
}));

// The card reads three things from the store; the rest of it stays out.
vi.mock('../src/state/store.js', () => {
  const state = {
    killCommand: (runId: string) => env.killed.push(runId),
    sendCommandStdin: () => {},
    get settings() {
      return { preferRemoteHub: env.preferRemoteHub };
    },
  };
  return { useApp: (select: (s: typeof state) => unknown) => select(state) };
});

type CommandItem = Extract<ThreadItem, { kind: 'command' }>;

const VITE = [
  '  VITE v5.4.0  ready in 312 ms',
  '',
  '  \u001b[32m➜\u001b[39m  Local:   http://localhost:\u001b[1m5173\u001b[22m/',
  '  ➜  Network: http://192.168.1.20:5173/',
].join('\n');

function item(over: Partial<CommandItem> = {}): CommandItem {
  return {
    kind: 'command',
    id: 'cmd_r1',
    runId: 'r1',
    command: 'npm run dev',
    source: 'agent',
    output: VITE,
    state: 'running',
    ...over,
  };
}

let dom: TestDom;

beforeEach(async () => {
  dom = await mountDom();
  env.desktop = true;
  env.preferRemoteHub = false;
  env.opened = [];
  env.killed = [];
});
afterEach(async () => {
  await dom.unmount();
});

async function show(card: CommandItem) {
  const { CommandCard } = await import('../src/components/CommandCard.js');
  await dom.render(<CommandCard item={card} />);
}

describe('who started it', () => {
  it('says Started by OpenShore on a program the agent started', async () => {
    const { STARTED_BY_OPENSHORE } = await import('../src/components/CommandCard.js');
    expect(STARTED_BY_OPENSHORE).toBe('Started by OpenShore');
    await show(item());
    expect(dom.container.querySelector('.command-by')?.textContent).toBe('Started by OpenShore');
  });

  it('says nothing of the kind on a command the person ran', async () => {
    await show(item({ source: undefined }));
    expect(dom.text()).not.toContain('Started by OpenShore');
  });

  it('the transcript carries the source from the engine event, and only for the agent', async () => {
    const { reduceEvent } = await import('../src/state/transcript.js');
    const { emptyThread } = await import('../src/state/types.js');
    const start = (source: 'user' | 'agent'): DriverEvent => ({
      type: 'command-start',
      runId: `r_${source}`,
      command: 'npm run dev',
      cwd: '/work',
      source,
    });
    const thread = reduceEvent(reduceEvent(emptyThread(), start('agent')), start('user'));
    const cards = thread.items.filter((i): i is CommandItem => i.kind === 'command');
    expect(cards.map((c) => c.source)).toEqual(['agent', undefined]);
  });

  it('keeps Stop on the card, and Stop reaches the store', async () => {
    await show(item());
    await dom.click('Stop');
    expect(env.killed).toEqual(['r1']);
  });
});

describe('a local address in the output', () => {
  it('becomes an Open link on the desktop that opens it in the browser', async () => {
    const { openLabel } = await import('../src/components/CommandCard.js');
    await show(item());
    expect(dom.buttons()).toContain(openLabel('http://localhost:5173/'));
    expect(dom.buttons()).toContain('Open localhost:5173');
    // Another machine's address on the same output is never offered.
    expect(dom.buttons().some((b) => b.includes('192.168'))).toBe(false);
    await dom.click('Open localhost:5173');
    expect(env.opened).toEqual(['http://localhost:5173/']);
  });

  it('stays plain text on the phone', async () => {
    env.desktop = false;
    await show(item());
    expect(dom.buttons().some((b) => b.startsWith('Open'))).toBe(false);
    expect(dom.container.querySelector('.command-links')).toBeNull();
    expect(dom.container.querySelector('.command-output')?.textContent).toContain(
      'http://localhost:5173/',
    );
    expect(dom.container.querySelector('.command-output a')).toBeNull();
  });

  it('stays plain text on a desktop driving another computer', async () => {
    env.preferRemoteHub = true;
    await show(item());
    expect(dom.buttons().some((b) => b.startsWith('Open'))).toBe(false);
  });

  it('goes once the program has ended, since nothing serves there any more', async () => {
    await show(item({ state: 'killed', exitCode: null }));
    expect(dom.buttons().some((b) => b.startsWith('Open'))).toBe(false);
  });

  it('works on a command the person ran, too', async () => {
    await show(item({ source: undefined, output: 'Running on http://127.0.0.1:5000' }));
    await dom.click('Open 127.0.0.1:5000');
    expect(env.opened).toEqual(['http://127.0.0.1:5000']);
  });
});
