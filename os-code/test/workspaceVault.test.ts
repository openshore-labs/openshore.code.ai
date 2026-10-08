// D5 for a vault inside the workspace (privacy review 2026-10-08,
// sp-vaultws). When the vault folder sits in the session's workspace (a vault
// picked inside a project), is it (an Obsidian vault opened as a project) or
// holds it, the workspace's own tools reach its notes by their workspace
// paths. Each must judge a note the way the vault tools do: an excluded note
// never shows, a local-only note's text (Journal/, Private/, #private, a
// `oscode: local-only` mark, a vault's own .oscode/vault.json adding a
// folder) never reaches a seat that leaves this network, and a seat that
// stays gets it marked, so a later handoff or a return online carries the
// stub. A command run near the vault asks every time on a seat that leaves,
// and what it prints on a seat that stays is marked.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession, type TestSession, type TestSessionOptions } from './helpers/session.js';
import { LOCAL_ONLY_STUB, compileVaultPrivacy } from '../src/harness/vault/privacy.js';
import {
  buildToolContext,
  vaultPrivacyConfig,
  vaultPrivacyHolder,
} from '../src/core/agent/registry.js';
import {
  COMMAND_READS_VAULT,
  HANDOFF_LOCAL_ONLY_DENIED,
  IMAGE_LOCAL_ONLY_DENIED,
} from '../src/core/agent/loop.js';
import { seedHistoryFromEvents } from '../src/core/agent/seed.js';
import { firstTurnRetrieval } from '../src/core/agent/lifts.js';
import { buildCodeMap } from '../src/context/codeMap.js';
import { RepoIndex } from '../src/context/index.js';
import { _setRipgrep } from '../src/core/tools/grep.js';
import {
  noteClosed,
  noteStaysHere,
  vaultFileTest,
  workspaceNotes,
} from '../src/core/tools/workspaceNotes.js';
import { readRepoInstructions } from '../src/core/agent/instructions.js';
import { clearVaultSettingsCache } from '../src/core/vault/settingsFile.js';
import { ConfigSchema } from '../src/config/schema.js';
import type { MachineOffline } from '../src/core/agent/offline.js';
import type { HandoffRecord } from '../src/core/agent/handoffStore.js';
import type { AgentEvent, ApprovalRequest } from '../src/core/agent/types.js';
import type { ToolOutput } from '../src/core/tools/index.js';
import type { PreparedVaultContext, VaultContextSource } from '../src/harness/vaultContext.js';
import type { Router } from '../src/router/router.js';
import type { ProviderRegistry } from '../src/providers/registry.js';

const JOURNAL = 'JOURNAL-SECRET-5521';
const LATER = 'LATER-SECRET-7004';
const CLIENT = 'CLIENT-SECRET-6630';
const TAGGED = 'TAGGED-SECRET-3377';
const ARCHIVED = 'ARCHIVED-SECRET-9902';
const OPEN = 'OPEN-IDEA-1188';
const PRIVATE_TEXT = [JOURNAL, LATER, CLIENT, TAGGED, ARCHIVED];
const JOURNAL_NOTE = 'notes/Journal/2026-10-08.md';

const NETWORK_DOWN: MachineOffline = { offline: true, reason: 'network' };
const ONLINE: MachineOffline = { offline: false };
const CLOUD_SEAT = { orchestrator: { provider: 'anthropic', model: 'claude-sonnet-5' } };

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A project with the vault picked inside it, at notes/: a Journal note, an
 *  open idea, a note the machine's config excludes, a client note the
 *  vault's own settings file keeps on this computer, a note tagged
 *  #private, and some code. */
function workspace(): { cwd: string; vault: string } {
  const cwd = tempDir('osc-ws-');
  const vault = join(cwd, 'notes');
  put(vault, 'Journal/2026-10-08.md', `# Today\n\nDear diary, ${JOURNAL}.\n`);
  put(vault, 'Ideas/open.md', `# Idea\n\nThe open idea is ${OPEN}.\n`);
  put(vault, 'Archive/old.md', `# Old\n\nArchived ${ARCHIVED}.\n`);
  put(vault, 'Clients/acme.md', `# Acme\n\nClient ${CLIENT}.\n`);
  put(vault, 'tagged.md', `---\ntags: [private]\n---\n# Tagged\n\nTagged ${TAGGED}.\n`);
  put(vault, '.oscode/vault.json', '{"version":1,"localOnly":{"paths":["Clients/"]}}\n');
  put(cwd, 'src/app.ts', 'export const greeting = "hello";\n');
  return { cwd, vault };
}

/** A session in that workspace with the machine's privacy rules (the D5
 *  defaults, plus `Archive/` excluded) unioned with the vault's own file, as
 *  bootstrap wires them. */
function sessionIn(
  ws: { cwd: string; vault: string },
  primary: MockProvider,
  options: TestSessionOptions = {},
): TestSession {
  const session = makeTestSession(primary, {
    cwd: ws.cwd,
    vaultRoot: ws.vault,
    ...options,
    configOverrides: { vault: { exclude: ['Archive/'] }, ...options.configOverrides },
  });
  const holder = vaultPrivacyHolder(
    vaultPrivacyConfig(session.config),
    () => session.toolContext.vaultRoot,
  );
  session.toolContext.vaultPrivacy = holder;
  session.toolContext.vaultRefresh = (o) => holder.refresh(o);
  session.toolContext.vaultSettings = () => holder.settings();
  return session;
}

function flag(start: MachineOffline) {
  let now = start;
  return {
    read: () => now,
    set: (next: MachineOffline) => {
      now = next;
    },
  };
}

/** A tool output or a search's text with its paths in forward slashes, so
 *  each assertion reads the same on Windows, where the walk spells a path
 *  with backslashes (and a not.toContain on a slashed path is never vacuous
 *  there). */
const posix = (text: string): string => text.replaceAll('\\', '/');
const ends = (events: AgentEvent[], name: string): ToolOutput[] =>
  events.flatMap((e) =>
    e.type === 'tool-end' && e.call.name === name
      ? [{ ...e.result, content: posix(e.result.content) }]
      : [],
  );
const deniedReasons = (events: AgentEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'tool-denied' ? [e.reason] : []));
const sentTo = (provider: MockProvider): string => JSON.stringify(provider.requests);
function expectNoPrivateText(text: string): void {
  for (const secret of PRIVATE_TEXT) expect(text).not.toContain(secret);
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

beforeEach(() => {
  process.env.OSC_HOME = tempDir('osc-ws-home-');
  clearVaultSettingsCache();
});

afterEach(() => {
  _setRipgrep(undefined);
  clearVaultSettingsCache();
  delete process.env.OSC_HOME;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.each([
  ['as this machine searches', undefined],
  ['without ripgrep', false],
] as const)('readFile, grep and glob on a cloud seat (%s)', (_label, ripgrep) => {
  it('never put a local-only note in a request, and never show an excluded one', async () => {
    _setRipgrep(ripgrep);
    const ws = workspace();
    const cloud = new MockProvider(
      'anthropic',
      [
        toolTurn('readFile', { path: JOURNAL_NOTE }, 'r1'),
        toolTurn('readFile', { path: 'notes/Clients/acme.md' }, 'r2'),
        toolTurn('readFile', { path: 'notes/tagged.md' }, 'r3'),
        toolTurn('readFile', { path: 'notes/Archive/old.md' }, 'r4'),
        toolTurn('grep', { pattern: 'SECRET|IDEA' }, 'g1'),
        toolTurn('glob', { pattern: 'notes/**/*.md' }, 'l1'),
        textTurn('Read what I could.'),
      ],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, { configOverrides: { stack: CLOUD_SEAT } });
    await session.agent.run('What is in my notes?');

    const sent = sentTo(cloud);
    expectNoPrivateText(sent);
    // The read of a note that stays here says so and points at vaultRead,
    // in each of its spellings: by folder, by the vault's own file, by tag.
    expect(sent).toContain(JSON.stringify(noteStaysHere(JOURNAL_NOTE, 'Journal/2026-10-08.md')));
    expect(sent).toContain(
      JSON.stringify(noteStaysHere('notes/Clients/acme.md', 'Clients/acme.md')),
    );
    expect(sent).toContain(JSON.stringify(noteStaysHere('notes/tagged.md', 'tagged.md')));
    expect(sent).toContain(JSON.stringify(noteClosed('notes/Archive/old.md')));
    // grep searched the vault: the open note's line came back.
    expect(ends(session.events, 'grep')[0]!.content).toContain(OPEN);
    // glob names a note that stays here, as vaultList does, never an
    // excluded one.
    const listed = ends(session.events, 'glob')[0]!.content;
    expect(listed).toContain(JOURNAL_NOTE);
    expect(listed).not.toContain('Archive/old.md');
    expect(session.events.at(-1)).toMatchObject({ type: 'task-done', reason: 'complete' });
  });
});

describe('a seat that stays reads the note, marked', () => {
  it('a return online, the handoff record and a cloud handoff all carry only the stub', async () => {
    const ws = workspace();
    const state = flag(NETWORK_DOWN);
    const cloud = new MockProvider('anthropic', [textTurn('Back online.')], { kind: 'cloud' });
    const local = new MockProvider(
      'ollama',
      [
        toolTurn('readFile', { path: JOURNAL_NOTE }, 'r1'),
        toolTurn('grep', { pattern: 'SECRET' }, 'g1'),
        toolTurn('glob', { pattern: 'notes/**/*.md' }, 'l1'),
        textTurn(`From your journal: ${JOURNAL}.`),
      ],
      { models: ['qwen2.5-coder:7b'] },
    );
    const handoffs: HandoffRecord[] = [];
    const session = sessionIn(ws, cloud, {
      providers: [local],
      offlineState: state.read,
      onHandoff: (record) => handoffs.push(record),
      configOverrides: { stack: CLOUD_SEAT },
    });
    await session.agent.run('What did I write today?');
    state.set(ONLINE);
    await session.agent.run('Anything else?');

    // The seat on this network got the text, marked.
    const local1 = sentTo(local);
    for (const secret of [JOURNAL, CLIENT, TAGGED]) expect(local1).toContain(secret);
    expect(local1).not.toContain(ARCHIVED);
    expect(ends(session.events, 'readFile')[0]).toMatchObject({ localOnly: true });
    expect(ends(session.events, 'grep')[0]).toMatchObject({ localOnly: true });
    expect(ends(session.events, 'glob')[0]!.localOnly).toBeUndefined();
    // Back online, the cloud seat answered on the stub alone.
    expect(cloud.requests).toHaveLength(1);
    expectNoPrivateText(sentTo(cloud));
    expect(sentTo(cloud)).toContain(LOCAL_ONLY_STUB);
    // And the handoff the next seat reads leaves the note out.
    expect(handoffs.length).toBeGreaterThan(0);
    expectNoPrivateText(JSON.stringify(handoffs));
  });

  it('a delegate to a cloud writer after a readFile of the note is refused', async () => {
    const ws = workspace();
    const cloud = new MockProvider('anthropic', [textTurn('From the cloud writer.')], {
      kind: 'cloud',
    });
    const local = new MockProvider('mock', [
      toolTurn('readFile', { path: JOURNAL_NOTE }, 'r1'),
      toolTurn('delegate', { role: 'writing', task: `Write this up: ${JOURNAL}` }, 'd1'),
      textTurn('Wrote it up here.'),
    ]);
    const session = sessionIn(ws, local, {
      providers: [cloud],
      specialists: true,
      configOverrides: {
        stack: {
          orchestrator: { provider: 'mock', model: 'mock-model' },
          specialists: { writing: { provider: 'anthropic', model: 'claude-sonnet-5' } },
        },
      },
    });
    await session.agent.run('write up my journal');
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(session.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
  });
});

describe('a vault that holds the workspace', () => {
  it('a project inside Private/ is read as the notes it is, and retrieval leaves it out', async () => {
    const vault = tempDir('osc-vault-');
    const cwd = join(vault, 'Private', 'thesis');
    put(cwd, 'chapter1.md', `# Chapter one\n\nThe thesis argument is ${JOURNAL}.\n`);
    const cloud = new MockProvider(
      'anthropic',
      [toolTurn('readFile', { path: 'chapter1.md' }, 'r1'), textTurn('Could not read it.')],
      { kind: 'cloud' },
    );
    const session = sessionIn({ cwd, vault }, cloud, { configOverrides: { stack: CLOUD_SEAT } });
    await session.agent.run('Summarize chapter one.');
    expectNoPrivateText(sentTo(cloud));
    expect(sentTo(cloud)).toContain(
      JSON.stringify(noteStaysHere('chapter1.md', 'Private/thesis/chapter1.md')),
    );

    // Retrieval before turn one finds the chapter in a plain folder, and
    // leaves it to the vault's own tools when the folder lies in the vault.
    const task = 'Tighten the thesis argument in chapter one.';
    const base = { task, servedWindow: 32_768, config: ConfigSchema.parse({}) };
    expect(firstTurnRetrieval({ ...base, cwd, vaultRoot: tempDir('osc-other-') })?.text).toContain(
      JOURNAL,
    );
    expect(firstTurnRetrieval({ ...base, cwd, vaultRoot: vault })).toBeUndefined();
  });

  it("this project's Current State there reaches only a seat that stays, marked", async () => {
    const vault = tempDir('osc-vault-');
    const cwd = join(vault, 'Private', 'thesis');
    mkdirSync(cwd, { recursive: true });
    const STATE = 'STATE-SECRET-8080';
    const source: VaultContextSource = {
      async prepare(): Promise<PreparedVaultContext> {
        return {
          index: null,
          bodies: new Map(),
          pins: [],
          privacy: compileVaultPrivacy(vaultPrivacyConfig(ConfigSchema.parse({}))),
          currentState: {
            path: 'OpenShore Project thesis MDs/Current State.md',
            text: `# Current State\n\nNext: ${STATE}.\n`,
          },
        };
      },
    };
    const cloud = new MockProvider('anthropic', [textTurn('Noted.')], { kind: 'cloud' });
    const onCloud = sessionIn({ cwd, vault }, cloud, {
      vaultContext: source,
      configOverrides: { stack: CLOUD_SEAT },
    });
    await onCloud.agent.run('Where was I?');
    expect(sentTo(cloud)).not.toContain(STATE);

    const local = new MockProvider('mock', [textTurn(`You were at ${STATE}.`)]);
    const onLocal = sessionIn({ cwd, vault }, local, { vaultContext: source });
    await onLocal.agent.run('Where was I?');
    expect(sentTo(local)).toContain(STATE);
    expect(onLocal.events.find((e) => e.type === 'context-pack')).toMatchObject({
      localOnly: true,
    });
    expect(onLocal.agent.history.at(-1)).toMatchObject({ role: 'assistant', localOnly: true });
  });

  it('an Obsidian vault opened as a project: its marked CLAUDE.md stays off the cloud', async () => {
    const vault = tempDir('osc-vault-');
    const INSTR = 'INSTR-SECRET-4242';
    const text = `---\noscode: local-only\n---\nAlways open with ${INSTR}.\n`;
    put(vault, 'CLAUDE.md', text);
    const repoInstructions = { file: 'CLAUDE.md', text, truncated: false };
    const cloud = new MockProvider('anthropic', [textTurn('Hello.')], { kind: 'cloud' });
    const onCloud = sessionIn({ cwd: vault, vault }, cloud, {
      repoInstructions,
      configOverrides: { stack: CLOUD_SEAT },
    });
    await onCloud.agent.run('Hi');
    expect(sentTo(cloud)).not.toContain(INSTR);

    const local = new MockProvider('mock', [textTurn(`${INSTR}. Hello.`)]);
    const onLocal = sessionIn({ cwd: vault, vault }, local, { repoInstructions });
    await onLocal.agent.run('Hi');
    expect(sentTo(local)).toContain(INSTR);
    expect(onLocal.agent.history.at(-1)).toMatchObject({ role: 'assistant', localOnly: true });
  });
});

describe('a command near the vault', () => {
  it('on a seat that stays, what it printed is marked, and a return online gets the stub', async () => {
    const ws = workspace();
    const state = flag(NETWORK_DOWN);
    const cloud = new MockProvider('anthropic', [textTurn('Back online.')], { kind: 'cloud' });
    const local = new MockProvider(
      'ollama',
      [toolTurn('runShell', { command: `cat ${JOURNAL_NOTE}` }, 's1'), textTurn('Printed it.')],
      { models: ['qwen2.5-coder:7b'] },
    );
    const session = sessionIn(ws, cloud, {
      providers: [local],
      offlineState: state.read,
      configOverrides: { stack: CLOUD_SEAT },
    });
    await session.agent.run('Print my journal.');
    state.set(ONLINE);
    await session.agent.run('And now?');
    const shell = ends(session.events, 'runShell')[0]!;
    expect(shell.content).toContain(JOURNAL);
    expect(shell.localOnly).toBe(true);
    // The seat stays, so its card carries no vault line.
    const card = session.approvals.find((r) => r.toolName === 'runShell');
    expect(card?.detail ?? '').not.toContain(COMMAND_READS_VAULT);
    expect(sentTo(cloud)).not.toContain(JOURNAL);
    expect(sentTo(cloud)).toContain(LOCAL_ONLY_STUB);
  });

  it('on a cloud seat it asks every time, bypass mode or not, and its card says why', async () => {
    const ws = workspace();
    const cloud = new MockProvider(
      'anthropic',
      [toolTurn('runShell', { command: `cat ${JOURNAL_NOTE}` }, 's1'), textTurn('Skipped it.')],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, {
      permissionMode: 'bypassPermissions',
      approve: (r: ApprovalRequest) => ({ approve: r.kind === 'cloud-spend' }),
      configOverrides: { stack: CLOUD_SEAT },
    });
    await session.agent.run('Print my journal.');
    const card = session.approvals.find((r) => r.toolName === 'runShell');
    expect(card).toMatchObject({ alwaysAsk: true });
    expect(card!.detail!.startsWith(COMMAND_READS_VAULT)).toBe(true);
    expect(ends(session.events, 'runShell')).toHaveLength(0);
    expectNoPrivateText(sentTo(cloud));
  });

  it('with the vault outside the workspace, bypass mode runs it as before', async () => {
    const ws = workspace();
    const cloud = new MockProvider(
      'anthropic',
      [toolTurn('runShell', { command: 'echo plain' }, 's1'), textTurn('Ran it.')],
      { kind: 'cloud' },
    );
    const session = sessionIn({ cwd: ws.cwd, vault: tempDir('osc-vault-') }, cloud, {
      permissionMode: 'bypassPermissions',
      configOverrides: { stack: CLOUD_SEAT },
    });
    await session.agent.run('Say plain.');
    expect(session.approvals.find((r) => r.toolName === 'runShell')).toBeUndefined();
    expect(ends(session.events, 'runShell')[0]!.content).toContain('plain');
  });

  // node runs under cmd.exe (exec's shell on Windows) and sh alike; cat does not.
  const CHECK = {
    harness: {
      verify: {
        command: `node -e "process.stdout.write(require('fs').readFileSync('${JOURNAL_NOTE}', 'utf8')); process.exit(1)"`,
        maxRetries: 1,
      },
    },
  };

  it('the check asks on a cloud seat, and nothing it prints is sent unasked', async () => {
    const ws = workspace();
    const cloud = new MockProvider(
      'anthropic',
      [
        toolTurn('writeFile', { path: 'src/app.ts', content: 'export const greeting = "hi";\n' }),
        textTurn('Done.'),
      ],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, {
      approve: (r: ApprovalRequest) => ({ approve: r.toolName !== 'verify' }),
      configOverrides: { stack: CLOUD_SEAT, ...CHECK },
    });
    await session.agent.run('Say hi.');
    const card = session.approvals.find((r) => r.toolName === 'verify');
    expect(card).toMatchObject({ alwaysAsk: true });
    expect(card!.detail!.startsWith(COMMAND_READS_VAULT)).toBe(true);
    expectNoPrivateText(sentTo(cloud));
  });

  it("on a seat that stays the check's failure goes back marked, and stays marked after a restart", async () => {
    const ws = workspace();
    const local = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'src/app.ts', content: 'export const greeting = "hi";\n' }),
      textTurn('Done.'),
      textTurn('Tried again.'),
    ]);
    const session = sessionIn(ws, local, { configOverrides: CHECK });
    await session.agent.run('Say hi.');
    expect(session.events.find((e) => e.type === 'verify')).toMatchObject({
      willRetry: true,
      localOnly: true,
    });
    const handedBack = session.agent.history.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes(JOURNAL),
    );
    expect(handedBack).toMatchObject({ localOnly: true });
    expect(session.agent.history.at(-1)).toMatchObject({ localOnly: true });
    expect(seedHistoryFromEvents(session.events).at(-1)).toMatchObject({
      content: 'Tried again.',
      localOnly: true,
    });
  });
});

describe('git, an edit and an image near the vault', () => {
  function committed(): { cwd: string; vault: string } {
    const ws = workspace();
    git(ws.cwd, 'init', '-q');
    git(ws.cwd, 'add', '-A');
    git(ws.cwd, 'commit', '-qm', 'first');
    put(
      ws.vault,
      'Journal/2026-10-08.md',
      `# Today\n\nDear diary, ${JOURNAL}.\nLater: ${LATER}.\n`,
    );
    put(ws.cwd, 'src/app.ts', 'export const greeting = "hello";\nexport const more = 1;\n');
    return ws;
  }

  it('gitDiff and gitLog on a cloud seat leave a local-only note out and say so', async () => {
    const ws = committed();
    const cloud = new MockProvider(
      'anthropic',
      [
        toolTurn('gitDiff', {}, 'd1'),
        toolTurn('gitLog', { patch: true }, 'l1'),
        toolTurn('gitLog', { patch: true, path: 'src' }, 'l2'),
        textTurn('Reviewed.'),
      ],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, { configOverrides: { stack: CLOUD_SEAT } });
    await session.agent.run('What changed?');
    expectNoPrivateText(sentTo(cloud));
    const [diff] = ends(session.events, 'gitDiff');
    expect(diff!.content).toContain('export const more = 1;');
    expect(diff!.content).toContain(`(${JOURNAL_NOTE})`);
    const [whole, scoped] = ends(session.events, 'gitLog');
    expect(whole!.content).toContain('Patches are left out');
    expect(whole!.content).toContain(JOURNAL_NOTE);
    // With the path narrowed to the code, the patch comes back.
    expect(scoped!.content).toContain('+export const greeting = "hello";');
  });

  it('gitDiff on a seat that stays shows the note, marked', async () => {
    const ws = committed();
    const local = new MockProvider('mock', [toolTurn('gitDiff', {}, 'd1'), textTurn('Seen.')]);
    const session = sessionIn(ws, local);
    await session.agent.run('What changed?');
    const [diff] = ends(session.events, 'gitDiff');
    expect(diff!.content).toContain(LATER);
    expect(diff!.localOnly).toBe(true);
  });

  it("a failed editFile on a cloud seat never echoes the note's lines", async () => {
    const ws = workspace();
    const cloud = new MockProvider(
      'anthropic',
      [
        toolTurn('editFile', { path: JOURNAL_NOTE, search: 'not in it', replace: 'x' }, 'e1'),
        textTurn('Could not edit it.'),
      ],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, { configOverrides: { stack: CLOUD_SEAT } });
    await session.agent.run('Fix my journal.');
    const [edit] = ends(session.events, 'editFile');
    expect(edit!.ok).toBe(false);
    expect(edit!.content).toContain('The edit did not apply.');
    expectNoPrivateText(sentTo(cloud));
  });

  it('analyzeImage on an image in Private/ goes only to a vision seat on this network', async () => {
    const ws = workspace();
    put(ws.vault, 'Private/scan.png', 'a picture');
    const cloud = new MockProvider('anthropic', [textTurn('It shows a page.')], {
      kind: 'cloud',
      caps: { supportsVision: true },
    });
    const eyes = new MockProvider('llava', [textTurn('It shows a page.')], {
      caps: { supportsVision: true },
    });
    const run = async (vision: { provider: string; model: string }) => {
      const local = new MockProvider('mock', [
        toolTurn('analyzeImage', { path: 'notes/Private/scan.png', question: 'What is it?' }, 'a1'),
        textTurn('Answered.'),
      ]);
      const session = sessionIn(ws, local, {
        providers: [cloud, eyes],
        specialists: true,
        configOverrides: {
          stack: {
            orchestrator: { provider: 'mock', model: 'mock-model' },
            specialists: { vision },
          },
        },
      });
      await session.agent.run('What is in my scan?');
      return session;
    };
    const toCloud = await run({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(cloud.requests).toHaveLength(0);
    expect(deniedReasons(toCloud.events)).toEqual([IMAGE_LOCAL_ONLY_DENIED]);
    const toEyes = await run({ provider: 'llava', model: 'mock-model' });
    expect(ends(toEyes.events, 'analyzeImage')[0]).toMatchObject({ localOnly: true });
  });
});

describe('repo search, the code map and their indexes', () => {
  /** A tool context whose embedder records every text it is sent. */
  function contextFor(
    cwd: string,
    vaultRoot: string,
    embedded: string[],
    embedder = true,
    where: { kind: 'local' | 'cloud'; remote: boolean } = { kind: 'local', remote: false },
  ) {
    const router = {
      embeddingRole: () =>
        embedder
          ? {
              ref: { provider: 'embed', model: 'nomic' },
              provider: where,
            }
          : undefined,
      delegate: async () => '',
    } as unknown as Router;
    const providers = {
      embedder: () => ({
        embed: async (_model: string, texts: string[]) => {
          embedded.push(...texts);
          return texts.map(() => [1, 0]);
        },
      }),
      imageProvider: () => undefined,
    } as unknown as ProviderRegistry;
    // The machine's rules sessionIn gives: the D5 defaults, Archive/ excluded.
    const config = ConfigSchema.parse({ vault: { exclude: ['Archive/'] } });
    return buildToolContext({ cwd, config, router, providers, vaultRoot });
  }

  it('never embeds or ranks a note, and drops one an earlier index kept', async () => {
    const ws = workspace();
    // An index built before the vault was left out holds the note.
    const earlier: string[] = [];
    const embedder = {
      embed: async (_model: string, texts: string[]) => {
        earlier.push(...texts);
        return texts.map(() => [1, 0]);
      },
    };
    await new RepoIndex(ws.cwd, embedder as never, 'nomic').refresh();
    expect(earlier.join('\n')).toContain(JOURNAL);

    const embedded: string[] = [];
    const ctx = contextFor(ws.cwd, ws.vault, embedded);
    const found = posix(await ctx.searchRepo!('diary journal secret', 20));
    expect(found).toContain('src/app.ts');
    expectNoPrivateText(found);
    expectNoPrivateText(embedded.join('\n'));
    // Only what is private is left out: an open note is searched as any
    // file is (sign-off: a search must not hide what is not private).
    expect(found).toContain(OPEN);
    const indexDir = join(process.env.OSC_HOME!, 'index');
    for (const dir of readdirSync(indexDir)) {
      expectNoPrivateText(readFileSync(join(indexDir, dir, 'chunks.jsonl'), 'utf8'));
    }

    const keyword = contextFor(ws.cwd, ws.vault, [], false);
    // The keyword ranking names files: every private note is left out of it.
    const ranked = posix(await keyword.searchRepo!('diary secret greeting idea client tagged', 10));
    expect(ranked).toContain('notes/Ideas/open.md');
    for (const note of ['Journal/', 'Clients/', 'tagged.md', 'Archive/']) {
      expect(ranked).not.toContain(note);
    }
  });

  it('a project inside a vault keeps its code searchable, and its private folder out', async () => {
    const vault = tempDir('osc-vault-');
    const cwd = join(vault, 'Projects', 'app');
    put(cwd, 'src/greet.ts', 'export function greetPerson() { return "hello there"; }\n');
    put(cwd, 'Private/plan.md', `# Plan\n\nThe hello plan is ${JOURNAL}.\n`);
    const keyword = contextFor(cwd, vault, [], false);
    const ranked = posix(await keyword.searchRepo!('hello greet plan', 10));
    expect(ranked).toContain('src/greet.ts');
    // Private/ here is Projects/app/Private/ in the vault, not the vault's
    // own Private/, so it is judged where it lies: open, and found.
    expect(ranked).toContain('Private/plan.md');
    put(vault, 'Private/thesis/notes.md', `# Notes\n\nhello ${LATER}\n`);
    const inPrivate = contextFor(join(vault, 'Private', 'thesis'), vault, [], false);
    expect(posix(await inPrivate.searchRepo!('hello', 10))).not.toContain('notes.md');
  });

  it('the code map names a file in the vault and never outlines it', () => {
    const ws = workspace();
    put(ws.vault, 'Private/helper.ts', 'export function privateHelperName() {}\n');
    const map = posix(buildCodeMap(ws.cwd, { nameOnly: vaultFileTest(ws.vault, ws.cwd)! }));
    expect(map).toContain('notes/Private/helper.ts');
    expect(map).not.toContain('privateHelperName');
    expect(map).toContain('src/app.ts');
  });

  // Sign-off: a search after a private read sends its words to the embedder,
  // which may be off this network (D5).
  it('a search while the chat holds a private note keeps its words off a cloud embedder', async () => {
    const ws = workspace();
    const embedded: string[] = [];
    const ctx = contextFor(ws.cwd, ws.vault, embedded, true, { kind: 'cloud', remote: true });
    ctx.chatHoldsLocalOnly = () => true;
    const found = posix(await ctx.searchRepo!(`where is ${JOURNAL} handled`, 5));
    expect(embedded.join('\n')).not.toContain(JOURNAL);
    expect(found).not.toContain(JOURNAL);
    // With nothing private held, the embedder answers as before.
    ctx.chatHoldsLocalOnly = () => false;
    await ctx.searchRepo!('greeting', 5);
    expect(embedded).toContain('greeting');
  });
});

// The sign-off's own probes (privacy review, sp-vaultws, 2026-10-08): each
// path below reached a private note's text, or hid what was not private, on
// the first pass.
describe('sign-off: the paths the first pass left open', () => {
  const TRASHED = 'TRASHED-SECRET-4410';
  const FLAT = 'FLAT-SECRET-2207';
  const GONE = 'GONE-SECRET-6061';

  it("a note in the vault's Trash keeps its privacy: by the folder it left, and as staying here at the least", async () => {
    // The walk reads dot folders; ripgrep skips them unless asked.
    _setRipgrep(false);
    const ws = workspace();
    // OpenShore's Trash keeps a note's place; Obsidian's own keeps no folder.
    put(ws.vault, '.trash/Journal/2026-10-01.md', `# Earlier\n\nTrashed ${TRASHED}.\n`);
    put(ws.vault, '.trash/2026-09-30.md', `# Flat\n\nFlat ${FLAT}.\n`);
    put(ws.vault, '.trash/Archive/gone.md', `# Gone\n\nGone ${GONE}.\n`);
    const cloud = new MockProvider(
      'anthropic',
      [
        toolTurn('readFile', { path: 'notes/.trash/Journal/2026-10-01.md' }, 'r1'),
        toolTurn('readFile', { path: 'notes/.trash/2026-09-30.md' }, 'r2'),
        toolTurn('readFile', { path: 'notes/.trash/Archive/gone.md' }, 'r3'),
        toolTurn('grep', { pattern: 'Trashed|Flat|Gone' }, 'g1'),
        toolTurn('glob', { pattern: 'notes/.trash/**' }, 'l1'),
        textTurn('Done.'),
      ],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, { configOverrides: { stack: CLOUD_SEAT } });
    await session.agent.run('What did I delete?');
    const sent = sentTo(cloud);
    for (const secret of [TRASHED, FLAT, GONE]) expect(sent).not.toContain(secret);
    expect(sent).toContain(JSON.stringify(noteClosed('notes/.trash/Archive/gone.md')));
    const [, flat] = ends(session.events, 'readFile');
    expect(flat!.content).toContain('stays on this computer');
    // vaultRead never reads under a dot folder, so the line does not send
    // the model there.
    expect(flat!.content).not.toContain('vaultRead');
    const listed = ends(session.events, 'glob')[0]!.content;
    expect(listed).toContain('notes/.trash/2026-09-30.md');
    expect(listed).not.toContain('gone.md');
  });

  it('a file in a private folder that is not a note is withheld without pointing at vaultRead', async () => {
    const ws = workspace();
    put(ws.vault, 'Private/keys.txt', `door code ${CLIENT}\n`);
    const cloud = new MockProvider(
      'anthropic',
      [toolTurn('readFile', { path: 'notes/Private/keys.txt' }, 'r1'), textTurn('Done.')],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, { configOverrides: { stack: CLOUD_SEAT } });
    await session.agent.run('Read it.');
    const [read] = ends(session.events, 'readFile');
    expect(sentTo(cloud)).not.toContain(CLIENT);
    expect(read!.content).toContain('stays on this computer');
    expect(read!.content).not.toContain('vaultRead');
  });

  it('a note too large to judge by its tags and marks is judged as staying here', async () => {
    const ws = workspace();
    const HUGE = 'HUGE-SECRET-1313';
    // Past the 2 MB a note is judged by, with its #private tag at the end.
    put(ws.vault, 'Ideas/big.md', `# Big\n\n${HUGE}\n${'filler line\n'.repeat(200_000)}#private\n`);
    const cloud = new MockProvider(
      'anthropic',
      [toolTurn('grep', { pattern: 'HUGE' }, 'g1'), textTurn('Done.')],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, { configOverrides: { stack: CLOUD_SEAT } });
    // Judged without its text (ripgrep hands over only the file's name).
    const notes = workspaceNotes(session.toolContext)!;
    expect(await notes.showing(join(ws.vault, 'Ideas/big.md'))).toBe('withheld');
    // The open note beside it is open as before.
    expect(await notes.showing(join(ws.vault, 'Ideas/open.md'))).toBe('open');
    // And a search the way this machine runs one sends none of it.
    await session.agent.run('Find HUGE.');
    expect(sentTo(cloud)).not.toContain(HUGE);
  });

  it("the person's deny rule on a vault folder closes it to the workspace tools too", async () => {
    const ws = workspace();
    const FENCED = 'FENCED-SECRET-8123';
    put(ws.vault, 'Finance/budget.md', `# Budget\n\nBudget ${FENCED}.\n`);
    const local = new MockProvider('mock', [
      toolTurn('readFile', { path: 'notes/Finance/budget.md' }, 'r1'),
      toolTurn('grep', { pattern: 'Budget' }, 'g1'),
      toolTurn('glob', { pattern: 'notes/Finance/**' }, 'l1'),
      textTurn('Done.'),
    ]);
    const session = sessionIn(ws, local, {
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'ask' },
          rules: [{ tool: 'vaultRead', decision: 'deny', pathGlob: 'Finance/**' }],
        },
      },
    });
    await session.agent.run('Read my budget.');
    expect(sentTo(local)).not.toContain(FENCED);
    expect(ends(session.events, 'readFile')[0]).toMatchObject({ ok: false });
    expect(ends(session.events, 'glob')[0]!.content).not.toContain('budget.md');
  });

  it('a long CLAUDE.md in the vault is judged by its whole text, not the part that fits', async () => {
    const vault = tempDir('osc-vault-');
    const INSTR = 'LONG-INSTR-SECRET-5150';
    put(vault, 'CLAUDE.md', `Open with ${INSTR}.\n${'Keep notes short.\n'.repeat(2000)}#private\n`);
    const repoInstructions = readRepoInstructions(vault)!;
    expect(repoInstructions.truncated).toBe(true);
    const cloud = new MockProvider('anthropic', [textTurn('Hello.')], { kind: 'cloud' });
    const session = sessionIn({ cwd: vault, vault }, cloud, {
      repoInstructions,
      configOverrides: { stack: CLOUD_SEAT },
    });
    await session.agent.run('Hi');
    expect(sentTo(cloud)).not.toContain(INSTR);
  });

  it('an Ollama cloud tag is a seat that leaves: the Journal note is withheld', async () => {
    const ws = workspace();
    const tag = new MockProvider(
      'ollama',
      [
        toolTurn('readFile', { path: JOURNAL_NOTE }, 'r1'),
        toolTurn('grep', { pattern: 'SECRET' }, 'g1'),
        textTurn('Done.'),
      ],
      { models: ['kimi-k3:cloud'] },
    );
    const session = sessionIn(ws, tag, {
      configOverrides: { stack: { orchestrator: { provider: 'ollama', model: 'kimi-k3:cloud' } } },
    });
    await session.agent.run('What did I write today?');
    expectNoPrivateText(sentTo(tag));
    expect(sentTo(tag)).toContain(
      JSON.stringify(noteStaysHere(JOURNAL_NOTE, 'Journal/2026-10-08.md')),
    );
  });

  it("an edit whose syntax check fails never echoes a private file's source on a cloud seat", async () => {
    const ws = workspace();
    const PIN = 'PIN-SECRET-7731';
    put(ws.vault, 'Private/door.js', `const pin = "${PIN}";\nmodule.exports = pin;\n`);
    put(ws.vault, 'Private/door.json', `{"pin": "${PIN}"}\n`);
    const cloud = new MockProvider(
      'anthropic',
      [
        // Both edits match and would break the file; each check's own error
        // quotes the file (node --check prints the line, JSON.parse a piece).
        toolTurn(
          'editFile',
          { path: 'notes/Private/door.js', search: 'pin = "', replace: 'pin = = "' },
          'e1',
        ),
        toolTurn(
          'editFile',
          { path: 'notes/Private/door.json', search: '"pin": "', replace: '"pin": ' },
          'e2',
        ),
        textTurn('Could not edit them.'),
      ],
      { kind: 'cloud' },
    );
    const session = sessionIn(ws, cloud, { configOverrides: { stack: CLOUD_SEAT } });
    await session.agent.run('Fix my door code.');
    const edits = ends(session.events, 'editFile');
    expect(edits).toHaveLength(2);
    for (const edit of edits) {
      expect(edit.ok).toBe(false);
      expect(edit.content).toContain('NOT applied');
    }
    // Not even the piece of it an error message quotes.
    expect(sentTo(cloud)).not.toContain('PIN-SECRET');
    // Nothing was written.
    expect(readFileSync(join(ws.vault, 'Private/door.js'), 'utf8')).toContain(PIN);
  });

  it('a search on Perplexity, whose answer is a cloud model, never follows a private read', async () => {
    const ws = workspace();
    const run = async (first: ReturnType<typeof toolTurn>) => {
      const local = new MockProvider('mock', [
        first,
        toolTurn('webSearch', { query: 'what does my journal say' }, 'w1'),
        textTurn('Done.'),
      ]);
      const session = sessionIn(ws, local, {
        configOverrides: { search: { backend: 'perplexity' } },
      });
      await session.agent.run('Look it up.');
      return session;
    };
    const afterNote = await run(toolTurn('readFile', { path: JOURNAL_NOTE }, 'r1'));
    expect(deniedReasons(afterNote.events)).toEqual([HANDOFF_LOCAL_ONLY_DENIED]);
    expect(ends(afterNote.events, 'webSearch')).toHaveLength(0);
    // After an open file, the search runs as before.
    const afterCode = await run(toolTurn('readFile', { path: 'src/app.ts' }, 'r1'));
    expect(deniedReasons(afterCode.events)).toEqual([]);
    expect(ends(afterCode.events, 'webSearch')).toHaveLength(1);
  });

  it('the loop tells repo search whether the chat holds a private note', async () => {
    const ws = workspace();
    const local = new MockProvider('mock', [
      toolTurn('readFile', { path: JOURNAL_NOTE }, 'r1'),
      textTurn('Read it.'),
    ]);
    const session = sessionIn(ws, local);
    expect(session.toolContext.chatHoldsLocalOnly!()).toBe(false);
    await session.agent.run('Read my journal.');
    expect(session.toolContext.chatHoldsLocalOnly!()).toBe(true);
  });

  it('with the vault outside the workspace, the file tools answer as before', async () => {
    const ws = workspace();
    const cloud = new MockProvider(
      'anthropic',
      [
        toolTurn('readFile', { path: JOURNAL_NOTE }, 'r1'),
        toolTurn('grep', { pattern: 'Dear diary' }, 'g1'),
        textTurn('Done.'),
      ],
      { kind: 'cloud' },
    );
    const session = sessionIn({ cwd: ws.cwd, vault: tempDir('osc-vault-') }, cloud, {
      configOverrides: { stack: CLOUD_SEAT },
    });
    await session.agent.run('Read it.');
    const [read] = ends(session.events, 'readFile');
    expect(read!.content).toContain(JOURNAL);
    expect(read!.localOnly).toBeUndefined();
    expect(ends(session.events, 'grep')[0]!.content).toContain(`${JOURNAL_NOTE}:3:`);
  });
});
