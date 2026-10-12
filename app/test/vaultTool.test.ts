// The vault tools on app seats (Vault M5, tech review J10): the slice is present for
// cloud and BYOM seats and absent for device, current bench, play step and
// team vault; every answer honors the one privacy judge (hidden is absent,
// local-only stays on this computer for a leaving seat and is flagged for a
// local one); a write is only ever proposed, and the Stack driver batches
// every proposal of a send into one approval card: decline writes nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, DriverEvent } from 'os-code/protocol';
import { compileVaultPrivacy } from 'os-code/protocol';

const h = vi.hoisted(() => ({
  claudeScript: [] as Array<Array<Record<string, unknown>>>,
  claudeParams: [] as Array<Record<string, unknown>>,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class Anthropic {
    static APIUserAbortError = class extends Error {};
    static AuthenticationError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    messages = {
      stream: (params: Record<string, unknown>) => {
        h.claudeParams.push(params);
        const content = h.claudeScript.shift() ?? [{ type: 'text', text: 'ok' }];
        const handlers: Record<string, (delta: string) => void> = {};
        return {
          on: (event: string, cb: (delta: string) => void) => {
            handlers[event] = cb;
          },
          finalMessage: async () => {
            for (const b of content) if (b.type === 'text') handlers.text?.(String(b.text));
            return { content };
          },
          abort: () => {},
        };
      },
    };
  }
  return { default: Anthropic };
});

vi.mock('../src/lib/llamaPlugin.js', () => ({
  Llama: {
    addListener: async () => ({ remove: async () => {} }),
    stop: async () => {},
    ensureLocal: async () => ({ ready: true }),
    load: async () => ({ ok: true }),
    generate: async () => ({ started: true }),
  },
}));

vi.mock('../src/lib/platform.js', () => ({
  platform: () => 'ios',
  secretGet: async (key: string) => (key.includes('anthropic') ? 'sk-test' : null),
  storeGetJson: async () => null,
}));

const {
  vaultToolSlice,
  parseVaultToolArgs,
  runVaultTool,
  vaultPolicyFor,
  vaultAnthropicTool,
  vaultOpenAiTool,
} = await import('../src/lib/vaultTool.js');
const { StackDriver } = await import('../src/drivers/stackDriver.js');
import type { VaultProposal, VaultToolContext } from '../src/lib/vaultTool.js';
import type { PackSeat } from '../src/drivers/types.js';
import type { StackModelRef } from '../src/lib/stack.js';

const privacy = compileVaultPrivacy({
  exclude: ['Hidden/**'],
  localOnly: { paths: ['Private/**'], tags: ['private'] },
});

const NOTES: Record<string, string> = {
  'Decisions/Auth.md':
    '---\ntags: [decision]\n---\n# Auth\nWe chose sessions over JWT.\n## Why\nSimpler to revoke. See [[Security]].\n## Later\nRevisit in Q3.',
  'Hidden/Keys.md': '# Keys\nauth token abc',
  'Private/Diary.md': '# Diary\nauth worries tonight.',
  'Notes/Tagged.md': '# Tagged\nauth idea #private',
  'Long.md': `# Long\n${'x'.repeat(300)}\n## Part two\nThe tail.`,
};

function ctxFor(
  seat: Partial<PackSeat> = {},
  over: Partial<VaultToolContext> = {},
): { ctx: VaultToolContext; proposals: VaultProposal[] } {
  const proposals: VaultProposal[] = [];
  const ctx: VaultToolContext = {
    seat: { modelClass: 'large', servedTokens: 128000, leavesNetwork: true, ...seat },
    privacy,
    search: async (q) =>
      Object.entries(NOTES)
        .filter(([, t]) => t.toLowerCase().includes(q.toLowerCase()))
        .map(([path, t]) => ({ path, snippet: t.slice(0, 30) })),
    read: async (p) =>
      NOTES[p] !== undefined ? { text: NOTES[p]!, version: `v-${p}` } : undefined,
    readCapChars: 64000,
    propose: (p) => proposals.push(p),
    ...over,
  };
  return { ctx, proposals };
}

describe('the slice (J10)', () => {
  it('is present for cloud and BYOM seats, merged for a small class', () => {
    const base = { mergedVaultTool: false, currentBench: false, playStep: false, teamVault: false };
    expect(vaultToolSlice({ ...base, kind: 'cloud' })).toEqual([
      'vaultSearch',
      'vaultRead',
      'vaultPropose',
    ]);
    expect(vaultToolSlice({ ...base, kind: 'byom', mergedVaultTool: true })).toEqual([
      'vaultLookup',
      'vaultPropose',
    ]);
  });

  it('is absent for a device seat, a current bench ref, a play step and the team vault', () => {
    const base = {
      kind: 'byom' as const,
      mergedVaultTool: false,
      currentBench: false,
      playStep: false,
      teamVault: false,
    };
    expect(vaultToolSlice({ ...base, kind: 'device' })).toEqual([]);
    expect(vaultToolSlice({ ...base, currentBench: true })).toEqual([]);
    expect(vaultToolSlice({ ...base, playStep: true })).toEqual([]);
    expect(vaultToolSlice({ ...base, teamVault: true })).toEqual([]);
  });

  it("reads each class's policy from the engine's table", () => {
    expect(vaultPolicyFor('tiny')).toEqual({ readCapChars: 6000, mergedVaultTool: true });
    expect(vaultPolicyFor('small').mergedVaultTool).toBe(true);
    expect(vaultPolicyFor('mid').mergedVaultTool).toBe(false);
    expect(vaultPolicyFor('large').readCapChars).toBe(64000);
  });

  it('specs carry the shared descriptions', () => {
    expect(vaultAnthropicTool('vaultSearch').description).toMatch(/Search the user's vault/);
    expect(vaultOpenAiTool('vaultPropose').function.description).toMatch(/Nothing is written yet/);
  });
});

describe('parsing', () => {
  it('reads good arguments and refuses bad ones', () => {
    expect(parseVaultToolArgs('vaultSearch', '{"query":" auth "}')).toEqual({
      name: 'vaultSearch',
      input: { query: 'auth' },
    });
    expect(parseVaultToolArgs('vaultSearch', '{}')).toBeNull();
    expect(parseVaultToolArgs('vaultSearch', 'not json')).toBeNull();
    expect(parseVaultToolArgs('vaultLookup', '{"query":"a","path":"b"}')).toBeNull();
    expect(parseVaultToolArgs('vaultLookup', '{"path":"b","section":"Why"}')).toEqual({
      name: 'vaultLookup',
      input: { path: 'b', section: 'Why' },
    });
    expect(
      parseVaultToolArgs('vaultPropose', '{"path":"a.md","text":"x","mode":"edit"}'),
    ).toBeNull();
    expect(parseVaultToolArgs('nope', '{}')).toBeNull();
  });
});

describe('privacy in every answer', () => {
  it('search leaves hidden notes out and withholds local-only ones from a leaving seat', async () => {
    const { ctx } = ctxFor();
    const r = await runVaultTool({ name: 'vaultSearch', input: { query: 'auth' } }, ctx);
    expect(r.content).toContain('Decisions/Auth.md');
    expect(r.content).not.toContain('Hidden/Keys.md');
    expect(r.content).not.toContain('Private/Diary.md');
    // A note local-only by its tag, which only its text shows.
    expect(r.content).not.toContain('Notes/Tagged.md');
    expect(r.localOnly).toBeUndefined();
  });

  it('search shows local-only notes to a local seat, flagged', async () => {
    const { ctx } = ctxFor({ leavesNetwork: false, modelClass: 'mid' });
    const r = await runVaultTool({ name: 'vaultSearch', input: { query: 'auth' } }, ctx);
    expect(r.content).toContain('Private/Diary.md');
    expect(r.content).toContain('Notes/Tagged.md');
    expect(r.content).not.toContain('Hidden/Keys.md');
    expect(r.localOnly).toBe(true);
  });

  it('read says a local-only note stays on this computer to a leaving seat', async () => {
    const { ctx } = ctxFor();
    const r = await runVaultTool({ name: 'vaultRead', input: { path: 'Private/Diary.md' } }, ctx);
    expect(r.content).toContain('stays on this computer');
    expect(r.content).not.toContain('worries');
    expect(r.localOnly).toBeUndefined();
    const tagged = await runVaultTool({ name: 'vaultRead', input: { path: 'Notes/Tagged' } }, ctx);
    expect(tagged.content).not.toContain('auth idea');
  });

  it('read treats a hidden note as absent', async () => {
    const { ctx } = ctxFor({ leavesNetwork: false });
    const r = await runVaultTool({ name: 'vaultRead', input: { path: 'Hidden/Keys.md' } }, ctx);
    expect(r.content).toBe('No vault note at Hidden/Keys.md yet.');
  });

  it('read on a local seat returns the text, flagged', async () => {
    const { ctx } = ctxFor({ leavesNetwork: false });
    const r = await runVaultTool({ name: 'vaultRead', input: { path: 'Private/Diary.md' } }, ctx);
    expect(r.content).toContain('auth worries tonight.');
    expect(r.localOnly).toBe(true);
  });
});

describe('reading', () => {
  it('opens with a header and reads one section', async () => {
    const { ctx } = ctxFor();
    const r = await runVaultTool(
      { name: 'vaultRead', input: { path: 'Decisions/Auth', section: 'Why' } },
      ctx,
    );
    expect(r.content).toMatch(/^Note: Decisions\/Auth\.md/);
    expect(r.content).toContain('Tags: #decision');
    expect(r.content).toContain('[[Security]]');
    expect(r.content).toContain('Section: Why');
    expect(r.content).toContain('Simpler to revoke.');
    expect(r.content).not.toContain('Revisit in Q3.');
  });

  it('takes "#Heading" on the path and gives the outline past the cap', async () => {
    const { ctx } = ctxFor({}, { readCapChars: 100 });
    const part = await runVaultTool({ name: 'vaultRead', input: { path: 'Long#Part two' } }, ctx);
    expect(part.content).toContain('The tail.');
    const whole = await runVaultTool({ name: 'vaultRead', input: { path: 'Long.md' } }, ctx);
    expect(whole.content).toContain('Its outline:');
    expect(whole.content).toContain('## Part two');
    expect(whole.content).not.toContain('xxxxxxxxxx');
  });

  it('resolves a bare name and suggests on a miss', async () => {
    const { ctx } = ctxFor(
      {},
      { resolve: async (n) => (n === 'Auth' ? 'Decisions/Auth.md' : undefined) },
    );
    const hit = await runVaultTool({ name: 'vaultRead', input: { path: 'Auth' } }, ctx);
    expect(hit.content).toContain('Note: Decisions/Auth.md');
    const miss = await runVaultTool({ name: 'vaultRead', input: { path: 'sessions' } }, ctx);
    expect(miss.content).toContain('No vault note at sessions.md yet.');
    expect(miss.content).toContain('"Decisions/Auth.md"');
  });

  it('refuses a dot-led name plainly', async () => {
    const { ctx } = ctxFor();
    const r = await runVaultTool({ name: 'vaultRead', input: { path: '.obsidian/app' } }, ctx);
    expect(r.isError).toBe(true);
  });
});

describe('proposals', () => {
  it('queue and write nothing', async () => {
    const write = vi.fn();
    const { ctx, proposals } = ctxFor();
    const r = await runVaultTool(
      { name: 'vaultPropose', input: { path: 'Ideas/New', text: 'hello', mode: 'create' } },
      ctx,
    );
    expect(r.content).toContain('Queued for the person to approve');
    expect(proposals).toEqual([{ path: 'Ideas/New.md', text: 'hello', mode: 'create' }]);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuse create over a note and append to nothing; append records the base version', async () => {
    const { ctx, proposals } = ctxFor();
    const clash = await runVaultTool(
      { name: 'vaultPropose', input: { path: 'Decisions/Auth.md', text: 'x', mode: 'create' } },
      ctx,
    );
    expect(clash.isError).toBe(true);
    const none = await runVaultTool(
      { name: 'vaultPropose', input: { path: 'Nope.md', text: 'x', mode: 'append' } },
      ctx,
    );
    expect(none.isError).toBe(true);
    await runVaultTool(
      { name: 'vaultPropose', input: { path: 'Decisions/Auth.md', text: 'x', mode: 'append' } },
      ctx,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      path: 'Decisions/Auth.md',
      text: 'x',
      mode: 'append',
      baseVersion: 'v-Decisions/Auth.md',
    });
    // The note's text at that version rides along, so the exact bytes an
    // approval writes are known before the card (Vault M7, tech review L9).
    expect(typeof proposals[0]!.baseText).toBe('string');
  });
});

describe('the Stack batches every proposal into one approval card', () => {
  const claude: StackModelRef = {
    kind: 'cloud',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    label: 'Claude',
  };
  const seat = (ref: StackModelRef): PackSeat | null =>
    ref.kind === 'cloud'
      ? { modelClass: 'large', servedTokens: 200000, leavesNetwork: true }
      : { modelClass: 'tiny', servedTokens: 4096, leavesNetwork: false };

  function setup(canWrite?: () => boolean) {
    const store = new Map<string, { text: string; version: string }>([
      ['Decisions/Auth.md', { text: '# Auth\nSessions.', version: 'v1' }],
    ]);
    const write = vi.fn(
      async (path: string, text: string, guard: { ifAbsent?: true; ifMatch?: string }) => {
        const cur = store.get(path);
        if (guard.ifAbsent && cur) return { ok: false as const, conflict: 'exists' as const };
        if (guard.ifMatch && cur?.version !== guard.ifMatch) {
          return { ok: false as const, conflict: 'changed' as const };
        }
        store.set(path, { text, version: 'v2' });
        return { ok: true as const, file: { name: path, text, updatedAt: 'now' } };
      },
    );
    const written: string[][] = [];
    const driver = new StackDriver(
      { reasoning: claude, active: [], saved: {} },
      'offshore',
      {},
      undefined,
      {
        packSeat: seat,
        vaultTools: {
          privacy: async () => privacy,
          search: async () => [],
          read: async (p: string) => store.get(p),
          write: write as never,
          onWritten: (paths: string[]) => written.push(paths),
          ...(canWrite ? { canWrite } : {}),
        },
      },
    );
    const events: DriverEvent[] = [];
    driver.subscribe((e) => events.push(e));
    // An anchor with no one to hand off to answers in one call (no framing).
    h.claudeScript.push(
      [
        {
          type: 'tool_use',
          id: 't1',
          name: 'vaultPropose',
          input: { path: 'Ideas/Launch.md', text: 'Launch plan.', mode: 'create' },
        },
        {
          type: 'tool_use',
          id: 't2',
          name: 'vaultPropose',
          input: { path: 'Decisions/Auth.md', text: 'Revisit in Q3.', mode: 'append' },
        },
      ],
      [{ type: 'text', text: 'I proposed two notes.' }],
    );
    return { driver, events, write, store, written };
  }

  const settle = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const cards = (events: DriverEvent[]) =>
    events.filter((e) => e.type === 'approval-request') as Array<{
      type: 'approval-request';
      request: ApprovalRequest;
    }>;

  beforeEach(() => {
    h.claudeScript.length = 0;
    h.claudeParams.length = 0;
  });

  it('offers the vault tools on the cloud seat without Codemagic Access', async () => {
    const { driver } = setup();
    driver.send('save a launch note');
    await settle();
    const tools = h.claudeParams[0]!.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['vaultSearch', 'vaultRead', 'vaultPropose']);
    driver.dispose();
  });

  // While writing is shut (the canWrite seam), the chat still reads, but is
  // never offered the proposal tool, so no card appears that could not land.
  it('offers no proposal tool while writing is shut, and shows no card', async () => {
    let open = false;
    const { driver, events, write } = setup(() => open);
    driver.send('save a launch note');
    await settle();
    const tools = h.claudeParams[0]!.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual(['vaultSearch', 'vaultRead']);
    expect(cards(events)).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
    driver.dispose();
    // Read each turn: open again, the tool comes back.
    open = true;
    h.claudeParams.length = 0;
    const again = setup(() => open);
    again.driver.send('save a launch note');
    await settle();
    const back = h.claudeParams[0]!.tools as Array<{ name: string }>;
    expect(back.map((t) => t.name)).toEqual(['vaultSearch', 'vaultRead', 'vaultPropose']);
    again.driver.dispose();
  });

  it('declined: one card for both, nothing written', async () => {
    const { driver, events, write } = setup();
    driver.send('save a launch note');
    await settle();
    const asked = cards(events);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.request.summary).toBe('Save 2 notes to your vault?');
    expect(asked[0]!.request.alwaysAsk).toBe(true);
    expect(asked[0]!.request.detail).toContain('Ideas/Launch.md');
    expect(asked[0]!.request.detail).toContain('Add to Decisions/Auth.md');
    // The turn waits on the card.
    expect(events.some((e) => e.type === 'task-done')).toBe(false);
    driver.answerApproval(asked[0]!.request.id, { approve: false });
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'task-done' && e.reason === 'complete')).toBe(true);
    driver.dispose();
  });

  it('approved: each write carries its guard', async () => {
    const { driver, events, write, store, written } = setup();
    driver.send('save a launch note');
    await settle();
    driver.answerApproval(cards(events)[0]!.request.id, { approve: true });
    await settle();
    expect(write).toHaveBeenCalledTimes(2);
    // Each note carries who wrote it (Vault M7, tech review L9), merged before the
    // card for a new note and at the write for an addition.
    expect(write.mock.calls[0]![0]).toBe('Ideas/Launch.md');
    expect(write.mock.calls[0]![2]).toEqual({ ifAbsent: true });
    const created = write.mock.calls[0]![1] as string;
    expect(created).toMatch(/^---\noscode-source: "agent"\n/);
    expect(created).toContain('oscode-where: "cloud"');
    expect(created.endsWith('---\nLaunch plan.')).toBe(true);
    expect(write.mock.calls[1]![2]).toEqual({ ifMatch: 'v1' });
    const auth = store.get('Decisions/Auth.md')!.text;
    expect(auth).toContain('oscode-source: "agent-edit"');
    expect(auth.endsWith('---\n# Auth\nSessions.\n\nRevisit in Q3.\n')).toBe(true);
    expect(written).toEqual([['Ideas/Launch.md', 'Decisions/Auth.md']]);
    driver.dispose();
  });

  it('the card shows the property change, and the approved bytes are the written bytes', async () => {
    const { driver, events, write, store } = setup();
    driver.send('save a launch note');
    await settle();
    const detail = cards(events)[0]!.request.detail!;
    // Vault M7, tech review L9: the person approves the properties with the text.
    expect(detail).toContain(
      'Also records in its properties: Edited by claude-sonnet-4-5 · Cloud.',
    );
    expect(detail).toContain(
      'Also records in its properties: Written by claude-sonnet-4-5 · Cloud.',
    );
    // What the card was built from, captured before the approve.
    const createdPreview = /New note Ideas\/Launch\.md\n([\s\S]*?)\nAlso records/.exec(detail)![1]!;
    driver.answerApproval(cards(events)[0]!.request.id, { approve: true });
    await settle();
    const created = write.mock.calls[0]![1] as string;
    expect(created.trim()).toBe(createdPreview);
    const appended = write.mock.calls[1]![1] as string;
    expect(store.get('Decisions/Auth.md')!.text).toBe(appended);
    expect(appended).toBe(
      [
        '---',
        'oscode-source: "agent-edit"',
        'oscode-model: "claude-sonnet-4-5"',
        'oscode-where: "cloud"',
        'oscode-size: "large"',
        'oscode-provider: "anthropic"',
        '---',
        '# Auth',
        'Sessions.',
        '',
        'Revisit in Q3.',
        '',
      ].join('\n'),
    );
    driver.dispose();
  });

  it('a note changed after the proposal is refused, never merged', async () => {
    const { driver, events, write, store } = setup();
    driver.send('save a launch note');
    await settle();
    store.set('Decisions/Auth.md', { text: '# Auth\nSomeone else wrote this.', version: 'v9' });
    driver.answerApproval(cards(events)[0]!.request.id, { approve: true });
    await settle();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![2]).toEqual({ ifMatch: 'v1' });
    expect(store.get('Decisions/Auth.md')!.text).toBe('# Auth\nSomeone else wrote this.');
    expect(
      events.some(
        (e) =>
          e.type === 'status' &&
          e.message ===
            'Not written, because the note changed or already exists: Decisions/Auth.md.',
      ),
    ).toBe(true);
    driver.dispose();
  });

  it('a stop counts as a decline', async () => {
    const { driver, events, write } = setup();
    driver.send('save a launch note');
    await settle();
    expect(cards(events)).toHaveLength(1);
    driver.abort();
    await settle();
    expect(write).not.toHaveBeenCalled();
    driver.dispose();
  });
});
