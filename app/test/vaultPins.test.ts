// Project pins and notes taken to a model (Vault M5, CTO J14, J15). Pins are
// set by editors only, at most eight, deduped, and device local: they never
// ride an org RPC, a pulled row never sets them, and a merge keeps the
// device's own. A rename moves them; a pin the vault no longer holds reads as
// missing. The composer's excerpt stays within its budget, drops frontmatter,
// says what it costs, and a note that stays on this computer is refused while
// the seat leaves the network. The picker never lists a hidden note, and
// "Recently from your agent" is the crew notes and the agent's own writes.
// A private pin wears the lock and "Private", and while Memory carries the
// pins to the coding agent the card says what a private pin does (CX and
// CMO, 2026-10-08, G), mounted in a real DOM (test/support/dom.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { PACK_PINS_MAX, compileVaultPrivacy } from 'os-code/protocol';
import type { Project } from '../src/state/types.js';
import { mountDom, type TestDom } from './support/dom.js';

const mem = new Map<string, string>();
const rpcCalls: Array<{ fn: string; args: unknown }> = [];

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'web',
  isDesktop: () => false,
  isPhone: () => false,
  openExternal: () => {},
  openInAppBrowser: () => {},
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

// Every org RPC is recorded, so a pin reaching the server would show.
vi.mock('../src/lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/supabase.js')>();
  return {
    ...actual,
    isConfigured: () => true,
    rpc: async (fn: string, _token: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return fn === 'update_org_project' ? 2 : null;
    },
    select: async () => [],
  };
});

// The personal vault holds two notes; the seat judge is stream E's.
const notes = new Map<string, string>([
  ['Ideas.md', '---\ntags: [work]\n---\n# Ideas\n\nShip the pins.'],
  ['Private/Diary.md', 'dear diary'],
  ['Health.md', 'Bloods are fine. #private'],
]);
const local = {
  id: 'local',
  label: 'local',
  blurb: '',
  ready: true,
  async list() {
    return [...notes.keys()].map((path) => ({ path, updatedAt: '2026-09-20T10:00:00Z', size: 1 }));
  },
  async stat(_r: string, path: string) {
    return notes.has(path) ? { path, updatedAt: '2026-09-20T10:00:00Z', size: 1 } : undefined;
  },
  async read(_r: string, path: string) {
    return notes.has(path)
      ? { path, text: notes.get(path)!, updatedAt: '2026-09-20T10:00:00Z' }
      : undefined;
  },
  async write(_r: string, path: string, text: string) {
    notes.set(path, text);
    return { ok: true as const, file: { path, text, updatedAt: 'x' } };
  },
  async remove() {
    return { ok: true as const };
  },
};
vi.mock('../src/lib/gitos/index.js', async () => {
  const providers = await vi.importActual<typeof import('../src/lib/gitos/providers.js')>(
    '../src/lib/gitos/providers.js',
  );
  return {
    isNotePath: providers.isNotePath,
    providerFor: (id: string) => (id === 'local' ? local : undefined),
    probeReady: async (id: string) => id === 'local',
    connectGdrive: async () => ({ ok: true }),
    disconnectGdrive: async () => {},
    isGdriveConnected: async () => false,
    setOrgVaultAuth: () => {},
    resetOrgVault: () => {},
  };
});
vi.mock('../src/lib/vaultSeat.js', () => ({
  hubTailnetSuffix: () => null,
  packSeatFor: (ref: { kind: string }) =>
    ref.kind === 'device'
      ? { modelClass: 'tiny', servedTokens: 4096, leavesNetwork: false }
      : { modelClass: 'large', servedTokens: 200000, leavesNetwork: true },
}));

// Before anything imports react-dom/client (test/support/dom.ts).
const dom: TestDom = await mountDom();
const { useApp } = await import('../src/state/store.js');
const { mergeSharedProjects, serverRowToProject } = await import('../src/lib/orgProjects.js');
const excerpt = await import('../src/lib/vaultExcerpt.js');
const { PIN_MISSING_LINE, ProjectVaultPins } =
  await import('../src/components/ProjectVaultPins.js');
const { VAULT_PIN_PRIVATE_LINE, VAULT_PRIVATE_TAG } = await import('../src/lib/vaultCopy.js');

const D5 = compileVaultPrivacy({
  exclude: ['Hidden/**'],
  localOnly: { paths: ['Private/**'], tags: ['private'] },
});

function project(over: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'Atlas', repoIds: [], createdAt: 'x', ...over };
}

function reset(projects: Project[]) {
  mem.clear();
  rpcCalls.length = 0;
  useApp.setState({
    settings: {
      onboarded: true,
      claudeModel: 'x',
      deviceModels: {},
      projects,
      activeProjectId: 'p1',
    },
    conversations: {},
    order: [],
    activeId: undefined,
    authSession: undefined,
  });
}

const pinsOf = (id = 'p1') =>
  useApp.getState().settings.projects?.find((p) => p.id === id)?.vaultPins;

describe('who may pin, and how many', () => {
  beforeEach(() => reset([project()]));

  it('an editor pins: normalized, deduped, at most eight', async () => {
    const paths = ['Ideas.md', 'Ideas.md', ...Array.from({ length: 10 }, (_, i) => `N${i}.md`)];
    expect(await useApp.getState().setProjectVaultPins('p1', paths)).toBe(true);
    const pins = pinsOf()!;
    expect(pins).toHaveLength(8);
    expect(pins[0]).toBe('Ideas.md');
    expect(new Set(pins).size).toBe(8);
  });

  it('a teammate who can only write cannot pin; an editor on a shared project can', async () => {
    reset([
      project({ shared: true, serverId: 's1', myLevel: 'write' }),
      project({ id: 'p2', shared: true, serverId: 's2', myLevel: 'edit' }),
    ]);
    expect(useApp.getState().canEditProjectPins('p1')).toBe(false);
    expect(await useApp.getState().setProjectVaultPins('p1', ['Ideas.md'])).toBe(false);
    expect(pinsOf()).toBeUndefined();
    expect(await useApp.getState().pinVaultNoteToProject('Ideas.md', 'p1')).toBe('refused');
    expect(await useApp.getState().setProjectVaultPins('p2', ['Ideas.md'])).toBe(true);
    expect(pinsOf('p2')).toEqual(['Ideas.md']);
  });

  it('"Pin to project context" pins to the active project once, and says when it is full', async () => {
    const s = useApp.getState();
    expect(await s.pinVaultNoteToProject('Ideas.md')).toBe('pinned');
    expect(await s.pinVaultNoteToProject('Ideas.md')).toBe('already');
    await s.setProjectVaultPins(
      'p1',
      Array.from({ length: 8 }, (_, i) => `N${i}.md`),
    );
    expect(await s.pinVaultNoteToProject('Ideas.md')).toBe('full');
    await s.unpinVaultNote('p1', 'N0.md');
    expect(pinsOf()).not.toContain('N0.md');
  });

  it('a rename moves the pin on every project', async () => {
    reset([
      project({ vaultPins: ['Old.md', 'Ideas.md'] }),
      project({ id: 'p2', vaultPins: ['Old.md'] }),
    ]);
    await useApp.getState().vaultRenamePins('Old.md', 'Folder/New.md');
    expect(pinsOf()).toEqual(['Folder/New.md', 'Ideas.md']);
    expect(pinsOf('p2')).toEqual(['Folder/New.md']);
  });

  it('a pin the vault no longer holds reads as missing', async () => {
    const status = await useApp.getState().vaultPinStatus(['Ideas.md', 'Gone.md']);
    expect(status).toEqual({ 'Ideas.md': 'ok', 'Gone.md': 'missing' });
    expect(PIN_MISSING_LINE).toBe('Pinned note not found');
  });
});

describe('pins never leave this device', () => {
  it('pinning on a shared project calls no org RPC', async () => {
    reset([project({ shared: true, serverId: 's1', myLevel: 'edit', rev: 1 })]);
    await useApp.getState().setProjectVaultPins('p1', ['Ideas.md']);
    expect(rpcCalls).toEqual([]);
    expect(pinsOf()).toEqual(['Ideas.md']);
  });

  it('a pulled row never sets pins, and a merge keeps the device own', () => {
    const row = {
      id: 's1',
      org_id: 'o1',
      name: 'Atlas',
      instructions: '',
      repo_ids: [],
      rev: 3,
      updated_at: 'x',
      my_level: 'edit' as const,
      access: [],
    };
    expect(serverRowToProject(row).vaultPins).toBeUndefined();
    const mine = project({ shared: true, serverId: 's1', vaultPins: ['Ideas.md'] });
    const merged = mergeSharedProjects([mine], [row]);
    expect(merged[0]!.vaultPins).toEqual(['Ideas.md']);
    expect(merged[0]!.rev).toBe(3);
    const fresh = mergeSharedProjects([], [row]);
    expect(fresh[0]!.vaultPins).toBeUndefined();
  });
});

describe('the composer excerpt', () => {
  const note = {
    path: 'Ideas.md',
    title: 'Ideas',
    text: `---\ntags: [work]\n---\n${'A paragraph of words. '.repeat(40)}\n\n${'More words here. '.repeat(400)}`,
    updatedAt: '2026-09-20T10:00:00Z',
  };

  it('budgets min(2000, 25% of the window), 1024 on a device seat', () => {
    expect(excerpt.composerExcerptBudget(4096, true)).toBe(1024);
    expect(excerpt.composerExcerptBudget(4096, false)).toBe(1024);
    expect(excerpt.composerExcerptBudget(200000, false)).toBe(2000);
    expect(excerpt.composerExcerptBudget(0, false)).toBe(0);
  });

  it('stays within its budget, drops frontmatter, and cuts on a paragraph', () => {
    const e = excerpt.composerExcerpt(note, 300);
    expect(e.tokens).toBeLessThanOrEqual(300);
    expect(e.trimmed).toBe(true);
    expect(e.text.startsWith('From my note [[Ideas]] (updated 2026-09-20):\n> ')).toBe(true);
    expect(e.text).not.toContain('tags:');
    expect(e.text.endsWith(excerpt.EXCERPT_TRIMMED_LINE)).toBe(true);
    const whole = excerpt.composerExcerpt({ ...note, text: 'Short.' }, 300);
    expect(whole).toEqual({
      text: 'From my note [[Ideas]] (updated 2026-09-20):\n> Short.',
      tokens: Math.ceil(whole.text.length / 4),
      trimmed: false,
    });
    for (const budget of [0, 5, 20, 64, 1024, 2000]) {
      const cut = excerpt.composerExcerpt(note, budget);
      if (budget >= 20) expect(cut.tokens).toBeLessThanOrEqual(budget);
    }
  });

  it('says what it costs, in the room it takes or in words', () => {
    expect(excerpt.excerptCostLine(380, 4096)).toBe("Takes about 9% of this model's room");
    expect(excerpt.excerptCostLine(1234, 200000)).toBe("Takes under 1% of this model's room");
    expect(excerpt.excerptCostLine(2048, 4096)).toBe("Takes about 50% of this model's room");
    // An unknown window: the note's length in words, never tokens.
    expect(excerpt.excerptCostLine(42, 0, 'one two three')).toBe('About 3 words');
    expect(excerpt.excerptCostLine(400, 0)).toBe('About 300 words');
    expect(excerpt.excerptCostLine(1, 0, 'one')).toBe('About 1 word');
  });

  it('refuses a local-only note while the seat leaves the network', () => {
    const seat = { servedTokens: 200000, device: false, leavesNetwork: true };
    const refused = excerpt.excerptForSeat({ ...note, localOnly: true }, seat);
    expect(refused).toEqual({ ok: false, reason: excerpt.EXCERPT_LOCAL_ONLY_REFUSAL });
    const local = excerpt.excerptForSeat(
      { ...note, localOnly: true },
      { servedTokens: 4096, device: true, leavesNetwork: false },
    );
    expect(local.ok).toBe(true);
    if (local.ok) expect(local.costLine).toMatch(/of this model's room$/);
  });

  it('the picker never lists a hidden note and locks a local-only one', () => {
    const rows = excerpt.pickerNotes(
      [
        { path: 'Ideas.md', updatedAt: '2026-09-20' },
        { path: 'Hidden/Keys.md', updatedAt: '2026-09-21' },
        { path: 'Private/Diary.md', updatedAt: '2026-09-22' },
        { path: 'Tagged.md', updatedAt: '2026-09-19', tags: ['private/health'] },
      ],
      D5,
    );
    expect(rows.map((r) => [r.path, r.localOnly])).toEqual([
      ['Private/Diary.md', true],
      ['Ideas.md', false],
      ['Tagged.md', true],
    ]);
  });

  it('judges a note by its own text, so an unindexed #private note is not taken for open', () => {
    const facts = excerpt.noteFactsFromText('Plain.md', 'Some text #private here', 'x');
    expect(D5.visibility(facts)).toBe('local-only');
    const marked = excerpt.noteFactsFromText('M.md', '---\noscode: exclude\n---\nhi', 'x');
    expect(D5.visibility(marked)).toBe('hidden');
  });

  it('recently from your agent: the newest crew notes and the ring, hidden never', () => {
    const facts = [
      ...Array.from({ length: 7 }, (_, i) => ({
        path: `Crew/Run ${i}.md`,
        updatedAt: `2026-09-2${i}`,
        tags: ['crew'],
      })),
      { path: 'Agent wrote.md', updatedAt: '2026-09-01' },
      { path: 'Hidden/Secret.md', updatedAt: '2026-09-30' },
    ];
    const ring = excerpt.pushAgentRecent(
      excerpt.pushAgentRecent([], 'Hidden/Secret.md'),
      'Agent wrote.md',
    );
    const rows = excerpt.agentRecentNotes(facts, ring, D5);
    expect(rows.map((r) => r.path)).toEqual([
      'Crew/Run 6.md',
      'Crew/Run 5.md',
      'Crew/Run 4.md',
      'Crew/Run 3.md',
      'Crew/Run 2.md',
      'Agent wrote.md',
    ]);
    let r: string[] = [];
    for (let i = 0; i < 30; i++) r = excerpt.pushAgentRecent(r, `n${i}.md`);
    expect(r).toHaveLength(excerpt.AGENT_RECENT_RING);
    expect(r[0]).toBe('n29.md');
  });
});

describe('the store answers the composer', () => {
  beforeEach(() => reset([project()]));

  it('an excerpt for a device chat, a refusal for a private note on a cloud chat', async () => {
    useApp.setState({
      conversations: {
        d: {
          id: 'd',
          title: 'd',
          source: { kind: 'device', modelId: 'm', modelName: 'M' },
          createdAt: 'x',
          updatedAt: 'x',
          thread: {
            items: [],
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
        },
        c: {
          id: 'c',
          title: 'c',
          source: { kind: 'cloud', provider: 'anthropic', model: 'claude-x' },
          createdAt: 'x',
          updatedAt: 'x',
          thread: {
            items: [],
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
        },
      },
    });
    const s = useApp.getState();
    expect(s.composerSeat('d')).toEqual({ servedTokens: 4096, device: true, leavesNetwork: false });
    expect(s.composerSeat('c').leavesNetwork).toBe(true);
    const onDevice = await s.composerVaultExcerpt('Private/Diary.md', 'd');
    expect(onDevice.ok).toBe(true);
    const onCloud = await s.composerVaultExcerpt('Private/Diary.md', 'c');
    expect(onCloud).toEqual({ ok: false, reason: excerpt.EXCERPT_LOCAL_ONLY_REFUSAL });
    const open = await s.composerVaultExcerpt('Ideas.md', 'c');
    expect(open.ok && open.excerpt.text).toContain('Ship the pins.');
    const listed = await s.vaultPickerNotes();
    expect(listed.find((n) => n.path === 'Private/Diary.md')?.localOnly).toBe(true);
  });

  it('"Ask about this note" puts the excerpt in a new chat composer, never sent', async () => {
    await useApp.getState().askAboutVaultNote('Ideas.md');
    const s = useApp.getState();
    expect(s.view).toBe('chat');
    expect(s.composerInsert?.path).toBe('Ideas.md');
    expect(s.composerInsert?.conversationId).toBeUndefined();
    expect(Object.keys(s.conversations)).toHaveLength(0);
    s.takeComposerInsert(s.composerInsert!.id);
    expect(useApp.getState().composerInsert).toBeUndefined();
  });
});

// The pin list stays on this device; the pinned notes themselves ride the
// pack to any seat, private ones excepted (D5), so the copy never says the
// notes stay here (CMO, 2026-10-07).
describe('pinned notes copy', () => {
  it('never says the pinned notes stay on this device', () => {
    const pins = readFileSync(join(process.cwd(), 'src/components/ProjectVaultPins.tsx'), 'utf8');
    expect(pins).not.toContain('They stay on this device');
    // The private-notes promise is the Vault's one sentence, read in both of
    // the card's states (CS-10), never a second wording.
    expect(pins.match(/\{VAULT_PRIVATE_OFF_CLOUD\}/g)).toHaveLength(2);
    expect(pins).not.toContain('stay off cloud models');
  });
});

// G (CX and CMO, 2026-10-08): a private pin keeps holding every cloud
// handoff in its project, so the card says which pins are private, judged by
// the pack's own privacy rules on each note's text, and what that does.
describe('a private pin says so', () => {
  beforeEach(() => reset([project({ vaultPins: ['Ideas.md', 'Private/Diary.md'] })]));
  afterEach(() => dom.render(null));

  // The lock is a drawn glyph with no text, so the words around it close up.
  const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const mount = async () => {
    await dom.render(createElement(ProjectVaultPins, { projectId: 'p1', index: 0 }));
    await dom.settle();
    await dom.settle();
  };

  it('the store judges each pin as the pack does: by place, by its own tags, by path when gone', async () => {
    const seen = await useApp
      .getState()
      .vaultPinPrivacy(['Ideas.md', 'Private/Diary.md', 'Health.md', 'Private/Gone.md']);
    expect(seen).toEqual({
      'Ideas.md': 'open',
      'Private/Diary.md': 'local-only',
      'Health.md': 'local-only',
      'Private/Gone.md': 'local-only',
    });
    expect(await useApp.getState().vaultPinPrivacy([])).toEqual({});
  });

  it('a private pin wears the lock and Private, an open one does not, and the line shows', async () => {
    await mount();
    const rows = [...dom.container.querySelectorAll('.multiselect-row')].map(words);
    expect(rows).toEqual(['Ideas · Ideas.mdUnpin', 'Diary · Private · Private/Diary.mdUnpin']);
    const diary = dom.container.querySelectorAll('.multiselect-row')[1]!;
    expect(diary.querySelector('.hint svg')).not.toBeNull();
    expect(dom.container.querySelectorAll('.multiselect-row')[0]!.querySelector('svg')).toBeNull();
    expect(VAULT_PRIVATE_TAG).toBe('Private');
    expect(VAULT_PIN_PRIVATE_LINE).toBe(
      'A private note is pinned here, so while the coding agent runs on a local model, it hands no step in this project to a cloud model.',
    );
    expect(dom.text()).toContain(VAULT_PIN_PRIVATE_LINE);
  });

  it('no line while no pinned note is private', async () => {
    reset([project({ vaultPins: ['Ideas.md'] })]);
    await mount();
    expect(dom.text()).toContain('Ideas · Ideas.md');
    expect(dom.text()).not.toContain(VAULT_PRIVATE_TAG);
    expect(dom.text()).not.toContain(VAULT_PIN_PRIVATE_LINE);
  });

  it('no line while Memory is off, since the pins then never reach the coding agent', async () => {
    useApp.setState((s) => ({
      settings: { ...s.settings, wayfinding: { memory: false } },
    }));
    await mount();
    expect(words(dom.container)).toContain('Diary · Private · Private/Diary.md');
    expect(dom.text()).not.toContain(VAULT_PIN_PRIVATE_LINE);
  });

  // Sign-off: the line is held to the pack the coding agent is sent. With
  // Notes in chats off no pin rides it, so a private pin holds nothing.
  it('no line while Notes in chats is off', async () => {
    useApp.setState((s) => ({ settings: { ...s.settings, vaultContext: 'off' } }));
    await mount();
    expect(words(dom.container)).toContain('Diary · Private · Private/Diary.md');
    expect(dom.text()).not.toContain(VAULT_PIN_PRIVATE_LINE);
  });

  // The pack takes the first PACK_PINS_MAX pins the vault holds and shows a
  // model, in the person's order (the engine's prepare and takePin), so a
  // private pin past them never reaches the agent and holds nothing; a pin
  // that is gone, or hidden from every model, takes no place.
  it('no line for a private pin past the ones the pack carries', async () => {
    expect(PACK_PINS_MAX).toBe(3);
    notes.set('A.md', 'a');
    notes.set('B.md', 'b');
    notes.set('Hidden/Secret.md', 'secret');
    try {
      reset([project({ vaultPins: ['Ideas.md', 'A.md', 'B.md', 'Private/Diary.md'] })]);
      await mount();
      expect(words(dom.container)).toContain('Diary · Private · Private/Diary.md');
      expect(dom.text()).not.toContain(VAULT_PIN_PRIVATE_LINE);
      await dom.render(null);

      reset([project({ vaultPins: ['Gone.md', 'Ideas.md', 'A.md', 'Private/Diary.md'] })]);
      await mount();
      expect(dom.text()).toContain(PIN_MISSING_LINE);
      expect(dom.text()).toContain(VAULT_PIN_PRIVATE_LINE);
      await dom.render(null);

      await useApp.getState().saveSettings({
        vaultPrivacy: { exclude: ['Hidden/**'], localOnly: { paths: [], tags: [] } },
      });
      useApp.setState((s) => ({
        settings: {
          ...s.settings,
          projects: [
            project({ vaultPins: ['Hidden/Secret.md', 'Ideas.md', 'A.md', 'Private/Diary.md'] }),
          ],
        },
      }));
      await mount();
      expect(dom.text()).toContain(VAULT_PIN_PRIVATE_LINE);
    } finally {
      notes.delete('A.md');
      notes.delete('B.md');
      notes.delete('Hidden/Secret.md');
      await useApp.getState().saveSettings({ vaultPrivacy: undefined });
    }
  });

  it('the picker wears the lock and Private on a private note', async () => {
    await mount();
    await dom.click('Edit');
    await dom.settle();
    await dom.settle();
    const picker = [...dom.container.ownerDocument.querySelectorAll('label.multiselect-row')].map(
      words,
    );
    expect(picker).toContain('Diary · Private');
    expect(picker).toContain('Ideas');
    const diary = [...dom.container.ownerDocument.querySelectorAll('label.multiselect-row')].find(
      (r) => words(r) === 'Diary · Private',
    )!;
    expect(diary.querySelector('.hint svg')).not.toBeNull();
    expect(dom.container.ownerDocument.body.textContent).not.toContain('stays on this computer');
  });
});
