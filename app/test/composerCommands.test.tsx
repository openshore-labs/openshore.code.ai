// Your Claude Code commands work here (P3, tech review wave-3). On an engine session
// the composer's "/" menu lists the person's own commands after OpenShore's,
// each marked with where it came from ("From this repository"), a - in the
// name included; picking one sends it as typed (the engine fills it in). A
// file that was found and left out is said under the rows when its name is
// typed. The engine's reserved names cover every built-in here, and the
// transcript keeps the last list while a repo-info event carries none.
// Mounted in a real (small) DOM (test/support/dom.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_COMMANDS, type DriverEvent } from 'os-code/protocol';
import { mountDom, type TestDom } from './support/dom.js';
import type { ComposerRepoCommands } from '../src/components/Composer.js';

const app = vi.hoisted(() => {
  const state = {
    settings: { permissionMode: 'default' },
    showToast: (_t: string) => {},
    runCommand: () => {},
    listFiles: async () => [] as string[],
    addMemory: async () => {},
    setPermissionMode: async () => {},
  };
  return { state };
});
vi.mock('../src/state/store.js', () => ({
  useApp: <T,>(select?: (s: typeof app.state) => T) => (select ? select(app.state) : app.state),
}));

const COMMANDS: ComposerRepoCommands = {
  commands: [
    { name: 'review', from: 'project', description: 'Review a pull request', argumentHint: '[pr]' },
    { name: 'fix-issue', from: 'project', description: 'Fix a GitHub issue' },
    { name: 'standup', from: 'user', description: 'Write my standup' },
  ],
  notLoaded: [
    { file: '.claude/commands/help.md', name: 'help', from: 'project', reason: 'built-in' },
    { file: '~/.claude/commands/fixup.md', name: 'fixup', from: 'user', reason: 'too-large' },
  ],
};

let dom: TestDom;
let sent: string[];
let commands: string[];

beforeEach(async () => {
  dom = await mountDom();
  Object.assign(window, { matchMedia: () => ({ matches: false }) });
  const area = window.HTMLTextAreaElement.prototype as { setSelectionRange?: unknown };
  area.setSelectionRange ??= () => {};
  // linkedom lays nothing out; the menu scrolls its active row into view.
  const el = window.HTMLElement.prototype as { scrollIntoView?: unknown };
  el.scrollIntoView ??= () => {};
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  sent = [];
  commands = [];
});
afterEach(async () => {
  await dom.unmount();
});

const FIELD = 'Chat with OpenShore';

async function show(opts: { agent?: boolean; repoCommands?: ComposerRepoCommands } = {}) {
  const { Composer } = await import('../src/components/Composer.js');
  await dom.render(
    <Composer
      busy={false}
      visionSupported
      agent={opts.agent ?? true}
      repoCommands={opts.repoCommands ?? COMMANDS}
      onSend={(text) => sent.push(text)}
      onCommand={(name, arg) => commands.push(`${name}:${arg}`)}
      onStop={() => {}}
      onOpenModelSheet={() => {}}
      onOpenModeSheet={() => {}}
    />,
  );
}

const field = () => dom.container.querySelector<HTMLTextAreaElement>(`[placeholder="${FIELD}"]`)!;

async function typeInMenu(value: string) {
  const { act } = await import('react');
  await act(async () => {
    field().dispatchEvent(new window.Event('focusin', { bubbles: true }));
  });
  await dom.type(FIELD, value);
}

async function key(k: string) {
  const { act } = await import('react');
  const e = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.assign(e, { key: k });
  await act(async () => {
    field().dispatchEvent(e);
  });
}

const rows = () => [...dom.container.querySelectorAll<HTMLButtonElement>('.composer-menu-row')];
const rowNames = () =>
  rows().map((r) => r.querySelector('.composer-menu-name')!.textContent!.split(' ')[0]);

describe("the composer's / menu lists the person's own commands", () => {
  it("shows them after OpenShore's own, marked with where they came from", async () => {
    await show();
    await typeInMenu('/');
    const names = rowNames();
    expect(names.slice(-3)).toEqual(['/review', '/fix-issue', '/standup']);
    expect(names.indexOf('/help')).toBeLessThan(names.indexOf('/review'));
    const review = rows().find((r) => r.textContent!.startsWith('/review'))!;
    expect(review.querySelector('.composer-menu-from')!.textContent).toBe('From this repository');
    expect(review.querySelector('.composer-menu-hint')!.textContent).toBe('Review a pull request');
    expect(review.querySelector('.composer-menu-arg')!.textContent).toBe(' [pr]');
    const standup = rows().find((r) => r.textContent!.startsWith('/standup'))!;
    expect(standup.querySelector('.composer-menu-from')!.textContent).toBe('From your computer');
    // A built-in carries no label; every row answers the finger.
    const help = rows().find((r) => r.textContent!.startsWith('/help'))!;
    expect(help.querySelector('.composer-menu-from')).toBeNull();
    for (const r of rows()) expect(r.className).toContain('press-fb');
  });

  it('keeps the menu open through a - in the name', async () => {
    await show();
    await typeInMenu('/fix-');
    expect(rowNames()).toEqual(['/fix-issue']);
  });

  it('sends a command with no argument as typed, and fills one that takes an argument', async () => {
    await show();
    await typeInMenu('/fix');
    await key('Enter');
    expect(sent).toEqual(['/fix-issue']);
    expect(commands).toEqual([]);

    await typeInMenu('/rev');
    await key('Enter');
    await dom.settle();
    expect(dom.value(FIELD)).toBe('/review ');
    expect(sent).toEqual(['/fix-issue']);
  });

  it('sends a typed command with its argument as a message, and runs a built-in as before', async () => {
    await show();
    await dom.type(FIELD, '/fix-issue 123');
    await key('Enter');
    expect(sent).toEqual(['/fix-issue 123']);
    await dom.type(FIELD, '/rename Launch');
    await key('Enter');
    expect(commands).toEqual(['rename:Launch']);
    expect(sent).toEqual(['/fix-issue 123']);
  });

  it('says why a file was left out when its name is typed', async () => {
    await show();
    await typeInMenu('/he');
    const note = dom.container.querySelector('.composer-menu-note');
    expect(note?.textContent).toBe(
      "/help (.claude/commands/help.md) was not loaded: OpenShore's own /help comes first.",
    );
    expect(note?.getAttribute('aria-disabled')).toBe('true');
    // Even with no row to show.
    await typeInMenu('/fixu');
    expect(rows()).toHaveLength(0);
    expect(dom.container.querySelector('.composer-menu-note')?.textContent).toContain(
      'the file is over 16 KB',
    );
    // Nothing is said on a bare "/".
    await typeInMenu('/');
    expect(dom.container.querySelector('.composer-menu-note')).toBeNull();
  });

  it('lists none on a chat with no engine session', async () => {
    await show({ agent: false });
    await typeInMenu('/');
    expect(rowNames()).not.toContain('/review');
    expect(dom.container.querySelector('.composer-menu-from')).toBeNull();
  });
});

describe('the lists agree', () => {
  it('every composer built-in is one the engine reserves, so a file never shadows it', async () => {
    const { SLASH_COMMANDS } = await import('../src/components/Composer.js');
    for (const c of SLASH_COMMANDS) expect(BUILT_IN_COMMANDS).toContain(c.name);
  });

  it('the transcript keeps the last list while a repo-info carries none', async () => {
    const { reduceEvent: applyEvent } = await import('../src/state/transcript.js');
    const { emptyThread } = await import('../src/state/types.js');
    const events: DriverEvent[] = [
      {
        type: 'repo-info',
        cwd: '/w/app',
        commands: [{ name: 'review', from: 'project' }],
        commandsNotLoaded: [
          { file: '.claude/commands/help.md', name: 'help', from: 'project', reason: 'built-in' },
        ],
      },
      { type: 'repo-info', cwd: '/w/app', branch: 'main', dirty: true },
    ];
    let state = emptyThread();
    for (const e of events) state = applyEvent(state, e);
    expect(state.repo).toEqual({
      cwd: '/w/app',
      branch: 'main',
      dirty: true,
      commands: [{ name: 'review', from: 'project' }],
      commandsNotLoaded: [
        { file: '.claude/commands/help.md', name: 'help', from: 'project', reason: 'built-in' },
      ],
    });
    // A list that became empty is said as empty, and replaces the old one.
    state = applyEvent(state, {
      type: 'repo-info',
      cwd: '/w/app',
      commands: [],
      commandsNotLoaded: [],
    });
    expect(state.repo?.commands).toEqual([]);
    expect(state.repo?.commandsNotLoaded).toEqual([]);
  });
});
