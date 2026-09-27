// Vault M7, the customization surface (CTO L1 to L8, L18). One file, fenced by
// owner so the wave 1 streams never touch the same lines: wave 0's guards,
// stream A's core half (parse, resolve, union, patch, the precedence helpers)
// and stream C's engine half (settingsFile.ts, the writer, the `.oscode/`
// deny in every write path).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAgentWritablePath } from '../src/harness/vault/paths.js';
import { VAULT_SETTINGS_FIELDS, WIDENING_KEYS } from '../src/harness/vault/settings.js';
// Stream C's engine half.
import type {
  ResolvedVaultSettings,
  VaultOverrides,
  VaultSettingsReads,
} from '../src/harness/vault/types.js';
import {
  VAULT_SETTINGS_DENY,
  clearVaultSettingsCache,
  vaultSettingsFor,
  vaultSettingsHooksForTests,
  workspaceWriteHitsVaultSettings,
} from '../src/core/vault/settingsFile.js';
import { readVaultConfigFile, writeVaultConfigFile } from '../src/core/vault/configFile.js';
import { writeVaultFile } from '../src/core/vault/folderFs.js';
import { memberVaultRoot } from '../src/core/vault/memberRoots.js';
import { closeEngineVaultIndexes } from '../src/core/vault/engineIndex.js';
import { vaultListTool, vaultWriteTool } from '../src/core/tools/vault.js';
import { writeFileTool } from '../src/core/tools/writeFile.js';
import { editFileTool } from '../src/core/tools/editFile.js';
import type { ToolContext } from '../src/core/tools/index.js';
import { Jail } from '../src/core/security/jail.js';
import { DEFAULT_PERMISSIONS, PermissionEngine } from '../src/core/permissions/index.js';
import { vaultPrivacyHolder } from '../src/core/agent/registry.js';
import { applyVaultOverrides } from '../src/core/agent/bootstrap.js';
import { defaultConfig, loadVaultDir } from '../src/config/load.js';
import type { OscConfig } from '../src/config/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// ---- M7 wave 0 begin ----

describe('isAgentWritablePath (L8)', () => {
  it('refuses any dot segment, in any case or separator', () => {
    for (const p of [
      '.oscode/vault.json',
      '.OSCODE/vault.json',
      'a/.oscode/vault.json',
      '.obsidian/app.json',
      '.trash/x.md',
      '.git/config',
      '.hidden.md',
      'a\\.oscode\\vault.json',
      '../outside.md',
      'a/../.oscode/vault.json',
      ' .oscode/vault.json',
    ]) {
      expect(isAgentWritablePath(p), p).toBe(false);
    }
  });

  it('refuses an empty or rooted path', () => {
    for (const p of ['', '   ', '/etc/passwd', '\\x.md']) {
      expect(isAgentWritablePath(p), JSON.stringify(p)).toBe(false);
    }
  });

  it('allows an ordinary note or file path', () => {
    for (const p of ['Ideas.md', 'Projects/Plan.md', 'a.b/c.md', 'Inbox/x.png', 'Notes/v1.2.md']) {
      expect(isAgentWritablePath(p), p).toBe(true);
    }
  });
});

describe("the settings writer is the person's alone (L7)", () => {
  it('no agent tool names writeConfig, writeVaultConfigFile or vaultWriteConfig', () => {
    const hits: string[] = [];
    for (const file of walkTs(join(SRC, 'core', 'tools'))) {
      const text = readFileSync(file, 'utf8');
      if (/\b(?:writeConfig|writeVaultConfigFile|vaultWriteConfig)\b/.test(text)) {
        hits.push(relative(SRC, file));
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('the settings schema contract (L2, L4)', () => {
  it('lists every in-vault field once', () => {
    expect(new Set(VAULT_SETTINGS_FIELDS).size).toBe(VAULT_SETTINGS_FIELDS.length);
    expect(VAULT_SETTINGS_FIELDS.length).toBe(21);
  });

  it('never lets a widening key be a field', () => {
    const tops = new Set(VAULT_SETTINGS_FIELDS.map((f) => f.split('.')[0]));
    for (const key of WIDENING_KEYS) expect(tops.has(key), key).toBe(false);
  });
});

// ---- M7 wave 0 end ----

// ---- M7 stream A begin ----
// Core half (L1 to L4, L13, L18): no files equals VAULT_SETTINGS_DEFAULTS; a
// `.obsidian` fixture alone configures the vault; Obsidian wins per field
// (L3); one set-aside test per WIDENING_KEYS entry, a `!` glob, an agent
// folder that climbs or names a dot folder; unknown and invalid keys; the
// lists are union only; `unreadable` for bad JSON; patch keeps unknown keys
// and refuses a non-object; the three precedence helpers.

describe.todo('vault settings core (stream A)');

// ---- M7 stream A end ----

// ---- M7 stream C begin ----
// Engine half (L5 to L8): vaultSettingsFor over the four reads, the 2 s memo;
// writeVaultConfigFile (ifMatch, ifAbsent, `.oscode` made and lstat'd, temp
// and rename, O_NOFOLLOW, refused names); a vaultWrite under `.oscode/`
// denied, a symlinked note to `.oscode/vault.json` denied, writeFile and
// editFile to the file denied under an always-allow grant; the agent folder.

describe('vault settings on the engine (stream C)', () => {
  let home: string;
  let root: string;
  let calls: number;

  /** Today's behavior, the shape stream A's resolver answers with. */
  function base(): ResolvedVaultSettings {
    const source = Object.fromEntries(
      VAULT_SETTINGS_FIELDS.map((f) => [f, 'default']),
    ) as ResolvedVaultSettings['source'];
    return {
      newNotes: { location: 'root' },
      daily: { folder: '', format: 'YYYY-MM-DD' },
      templates: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
      attachments: {},
      links: { style: 'wiki', format: 'shortest', updateOnRename: 'ask' },
      editor: { openMode: 'read', font: 'default', size: 'default' },
      tree: { sort: 'name' },
      delete: 'trash',
      agent: {},
      narrowing: {},
      ignore: { paths: [], regexSkipped: 0 },
      source,
      setAside: [],
      fileState: 'absent',
      obsidian: false,
    };
  }

  /** A deliberately hostile stand-in for the resolver: it hands the file's
   *  lists straight through, empty ones included, so what these tests prove
   *  is the ENGINE's union, whatever the parser lets by. */
  function fakeResolve(reads: VaultSettingsReads): ResolvedVaultSettings {
    calls++;
    const out = base();
    const file = reads.file;
    if (!file.ok) {
      out.fileState = file.reason === 'absent' ? 'absent' : 'unavailable';
      return out;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(file.text) as Record<string, unknown>;
    } catch {
      out.fileState = 'unreadable';
      return out;
    }
    out.fileState = 'ok';
    out.fileVersion = file.version;
    out.narrowing = {
      ...(Array.isArray(json.exclude) ? { exclude: json.exclude as string[] } : {}),
      ...(json.localOnly ? { localOnly: json.localOnly as { paths?: string[] } } : {}),
    };
    const agent = json.agent as { folder?: string } | undefined;
    if (agent?.folder) out.agent = { folder: agent.folder };
    return out;
  }

  function writeSettings(text: string): void {
    mkdirSync(join(root, '.oscode'), { recursive: true });
    writeFileSync(join(root, '.oscode', 'vault.json'), text);
  }

  const MACHINE = {
    exclude: ['Secret/**'],
    localOnly: { paths: ['Private/**'], tags: ['private'] },
  };

  function vaultCtx(): ToolContext {
    const holder = vaultPrivacyHolder(MACHINE, root);
    return {
      vaultRoot: root,
      vaultPrivacy: holder,
      vaultRefresh: (o) => holder.refresh(o),
      vaultSettings: () => holder.settings(),
    } as unknown as ToolContext;
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'osc-m7c-home-'));
    process.env.OSC_HOME = home;
    root = mkdtempSync(join(tmpdir(), 'osc-m7c-vault-'));
    calls = 0;
    clearVaultSettingsCache();
    vaultSettingsHooksForTests.resolve = fakeResolve;
  });

  afterEach(async () => {
    vaultSettingsHooksForTests.resolve = undefined;
    vaultSettingsHooksForTests.now = undefined;
    clearVaultSettingsCache();
    await closeEngineVaultIndexes();
    delete process.env.OSC_HOME;
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  describe('vaultSettingsFor (L5, L6)', () => {
    it('resolves once, keeps it 2 s, and reads again when forced or stale', async () => {
      let now = 1_000;
      vaultSettingsHooksForTests.now = () => now;
      const first = await vaultSettingsFor(root);
      expect(first.fileState).toBe('absent');
      expect(calls).toBe(1);
      writeSettings('{"exclude":["Drafts/**"]}');
      now += 1_000;
      expect(await vaultSettingsFor(root)).toBe(first);
      expect(calls).toBe(1);
      const forced = await vaultSettingsFor(root, { force: true });
      expect(forced.fileState).toBe('ok');
      expect(forced.narrowing.exclude).toEqual(['Drafts/**']);
      expect(calls).toBe(2);
      // Stale, but nothing changed: the same value, no second resolve.
      now += 5_000;
      expect(await vaultSettingsFor(root)).toBe(forced);
      expect(calls).toBe(2);
    });

    it('surfaces a resolver that throws (the holder keeps its last good)', async () => {
      vaultSettingsHooksForTests.resolve = () => {
        throw new Error('not built');
      };
      await expect(vaultSettingsFor(root)).rejects.toThrow('not built');
    });
  });

  describe('writeVaultConfigFile (L7)', () => {
    it('creates .oscode and the file once, then writes only against its version', async () => {
      const made = await writeVaultConfigFile(root, 'oscode/vault', '{"version":1}\n', {
        ifAbsent: true,
      });
      expect(made.ok).toBe(true);
      expect(lstatSync(join(root, '.oscode')).isDirectory()).toBe(true);
      const read = await readVaultConfigFile(root, 'oscode/vault');
      expect(read.ok && made.ok && read.version === made.version).toBe(true);

      const again = await writeVaultConfigFile(root, 'oscode/vault', '{}', { ifAbsent: true });
      expect(again).toMatchObject({
        ok: false,
        conflict: 'exists',
        current: { text: '{"version":1}\n' },
      });

      const stale = await writeVaultConfigFile(root, 'oscode/vault', '{}', { ifMatch: 'nope' });
      expect(stale).toMatchObject({ ok: false, conflict: 'changed' });
      expect(readFileSync(join(root, '.oscode', 'vault.json'), 'utf8')).toBe('{"version":1}\n');

      const next = await writeVaultConfigFile(
        root,
        'oscode/vault',
        '{"version":1,"delete":"trash"}\n',
        {
          ifMatch: made.ok ? made.version : '',
        },
      );
      expect(next.ok).toBe(true);
      expect(readFileSync(join(root, '.oscode', 'vault.json'), 'utf8')).toContain('trash');
      expect(readdirSync(join(root, '.oscode'))).toEqual(['vault.json']);
    });

    it('answers missing for ifMatch on no file, and refuses Obsidian, bad guards and big text', async () => {
      expect(await writeVaultConfigFile(root, 'oscode/vault', '{}', { ifMatch: '1:2:3' })).toEqual({
        ok: false,
        conflict: 'missing',
      });
      for (const name of ['obsidian/app', 'obsidian/daily-notes', 'obsidian/templates', '../x']) {
        expect(await writeVaultConfigFile(root, name, '{}', { ifAbsent: true })).toEqual({
          ok: false,
          reason: 'refused',
        });
      }
      expect(await writeVaultConfigFile(root, 'oscode/vault', '{}', {})).toEqual({
        ok: false,
        reason: 'refused',
      });
      expect(
        await writeVaultConfigFile(root, 'oscode/vault', 'x'.repeat(256 * 1024 + 1), {
          ifAbsent: true,
        }),
      ).toEqual({ ok: false, reason: 'too-large' });
      expect(existsSync(join(root, '.obsidian'))).toBe(false);
    });

    it('refuses a .oscode folder or a settings file that is a link', async () => {
      const elsewhere = mkdtempSync(join(tmpdir(), 'osc-m7c-else-'));
      try {
        symlinkSync(elsewhere, join(root, '.oscode'));
        expect(await writeVaultConfigFile(root, 'oscode/vault', '{}', { ifAbsent: true })).toEqual({
          ok: false,
          reason: 'refused',
        });
        expect(readdirSync(elsewhere)).toEqual([]);
        rmSync(join(root, '.oscode'));
        mkdirSync(join(root, '.oscode'));
        writeFileSync(join(root, 'target.json'), '{}');
        symlinkSync(join(root, 'target.json'), join(root, '.oscode', 'vault.json'));
        expect(
          await writeVaultConfigFile(root, 'oscode/vault', '{"x":1}', { ifAbsent: true }),
        ).toMatchObject({
          ok: false,
        });
        expect(readFileSync(join(root, 'target.json'), 'utf8')).toBe('{}');
      } finally {
        rmSync(elsewhere, { recursive: true, force: true });
      }
    });
  });

  describe('the agent never writes under .oscode/ (L8)', () => {
    const args = (path: string) => ({ path, content: '{"exclude":[]}', mode: 'replace' as const });

    it('refuses a vaultWrite to .oscode, typed any way, in preview and execute', async () => {
      writeSettings('{"version":1}');
      for (const path of [
        '.oscode/vault.json',
        '.OSCODE/vault',
        'a/.oscode/b.md',
        '.oscode\\vault',
      ]) {
        await expect(vaultWriteTool.preview!(args(path), vaultCtx()), path).rejects.toThrow(
          VAULT_SETTINGS_DENY,
        );
        const out = await vaultWriteTool.execute(args(path), vaultCtx());
        expect(out, path).toEqual({ ok: false, content: VAULT_SETTINGS_DENY });
      }
      expect(readFileSync(join(root, '.oscode', 'vault.json'), 'utf8')).toBe('{"version":1}');
    });

    it('refuses a note planted as a link into .oscode, and a folder linked there', async () => {
      writeSettings('{"version":1}');
      symlinkSync(join(root, '.oscode', 'vault.json'), join(root, 'x.md'));
      await expect(vaultWriteTool.preview!(args('x.md'), vaultCtx())).rejects.toThrow(
        VAULT_SETTINGS_DENY,
      );
      expect(await vaultWriteTool.execute(args('x.md'), vaultCtx())).toEqual({
        ok: false,
        content: VAULT_SETTINGS_DENY,
      });
      symlinkSync(join(root, '.oscode'), join(root, 'Notes'));
      expect(await vaultWriteTool.execute(args('Notes/new.md'), vaultCtx())).toEqual({
        ok: false,
        content: VAULT_SETTINGS_DENY,
      });
      // The folder writer every caller shares refuses it too.
      await expect(writeVaultFile(root, 'x.md', 'y')).rejects.toThrow(/blocked/);
      await expect(writeVaultFile(root, 'Notes/new.md', 'y')).rejects.toThrow(/blocked/);
      expect(readFileSync(join(root, '.oscode', 'vault.json'), 'utf8')).toBe('{"version":1}');
      expect(readdirSync(join(root, '.oscode'))).toEqual(['vault.json']);
      // An ordinary note still saves.
      expect((await writeVaultFile(root, 'ok.md', 'fine')).ok).toBe(true);
      expect((await vaultWriteTool.execute(args('fine.md'), vaultCtx())).ok).toBe(true);
    });

    it('refuses writeFile and editFile into <vault>/.oscode/ under an always-allow grant', async () => {
      writeSettings('{"version":1}\n');
      const workspace = dirname(root);
      const rel = join(basename(root), '.oscode', 'vault.json');
      const engine = new PermissionEngine(DEFAULT_PERMISSIONS);
      expect(engine.allowForSession('writeFile')).toBe(true);
      expect(engine.allowForSession('editFile')).toBe(true);
      // The grant would let it through; the tool itself refuses.
      expect(engine.decide({ toolName: 'writeFile', risk: 'write', path: rel }).decision).toBe(
        'allow',
      );
      for (const cwd of [workspace, root]) {
        const ctx = {
          cwd,
          jail: new Jail(cwd),
          vaultRoot: root,
        } as unknown as ToolContext;
        const path = cwd === root ? '.oscode/vault.json' : rel;
        expect(await writeFileTool.execute({ path, content: '{}' }, ctx)).toEqual({
          ok: false,
          content: VAULT_SETTINGS_DENY,
        });
        expect(
          await editFileTool.execute({ path, search: '"version":1', replace: '"version":2' }, ctx),
        ).toEqual({ ok: false, content: VAULT_SETTINGS_DENY });
        await expect(writeFileTool.preview!({ path, content: '{}' }, ctx)).rejects.toThrow(
          VAULT_SETTINGS_DENY,
        );
        // A new file there too, and a link planted in the workspace.
        const fresh =
          cwd === root ? '.oscode/other.json' : join(basename(root), '.oscode', 'n.json');
        expect((await writeFileTool.execute({ path: fresh, content: '{}' }, ctx)).ok).toBe(false);
      }
      symlinkSync(join(root, '.oscode', 'vault.json'), join(root, 'link.json'));
      const ctx = { cwd: root, jail: new Jail(root), vaultRoot: root } as unknown as ToolContext;
      expect(await writeFileTool.execute({ path: 'link.json', content: '{}' }, ctx)).toEqual({
        ok: false,
        content: VAULT_SETTINGS_DENY,
      });
      linkSync(join(root, '.oscode', 'vault.json'), join(root, 'hard.json'));
      expect(await writeFileTool.execute({ path: 'hard.json', content: '{}' }, ctx)).toEqual({
        ok: false,
        content: VAULT_SETTINGS_DENY,
      });
      expect(readFileSync(join(root, '.oscode', 'vault.json'), 'utf8')).toBe('{"version":1}\n');
      // Elsewhere in the workspace, writes still land.
      expect((await writeFileTool.execute({ path: 'notes.txt', content: 'ok' }, ctx)).ok).toBe(
        true,
      );
    });

    it("refuses a member root's .oscode, and the machine vault's, from any session", async () => {
      const member = memberVaultRoot('member-1');
      mkdirSync(join(member, '.oscode'), { recursive: true });
      writeFileSync(join(member, '.oscode', 'vault.json'), '{}');
      const ctx = { cwd: home, jail: new Jail(home) } as unknown as ToolContext;
      const rel = relative(home, join(member, '.oscode', 'vault.json'));
      expect(await writeFileTool.execute({ path: rel, content: '{"x":1}' }, ctx)).toEqual({
        ok: false,
        content: VAULT_SETTINGS_DENY,
      });
      expect(workspaceWriteHitsVaultSettings(join(member, '.oscode', 'vault.json'))).toBe(true);
      expect(workspaceWriteHitsVaultSettings(join(member, 'note.md'))).toBe(false);
      expect(workspaceWriteHitsVaultSettings(join(loadVaultDir().dir, '.oscode', 'x'))).toBe(true);
      expect(readFileSync(join(member, '.oscode', 'vault.json'), 'utf8')).toBe('{}');
    });

    it('keeps the agent in the vault settings folder it names', async () => {
      writeSettings('{"agent":{"folder":"Agent"}}');
      const out = await vaultWriteTool.execute(args('Other/x.md'), vaultCtx());
      expect(out.ok).toBe(false);
      expect(out.content).toContain('"Agent"');
      expect((await vaultWriteTool.execute(args('agent/x.md'), vaultCtx())).ok).toBe(true);
    });
  });

  describe('the vault file only narrows (L4)', () => {
    it('unions its lists with the machine rules and never drops one', async () => {
      writeSettings(
        JSON.stringify({ exclude: [], localOnly: { paths: [] }, pack: 'large', context: 'full' }),
      );
      const holder = vaultPrivacyHolder(MACHINE, root);
      await holder.refresh();
      expect(holder.visibility({ path: 'Secret/a.md' })).toBe('hidden');
      expect(holder.visibility({ path: 'Private/a.md' })).toBe('local-only');
      expect(holder.visibility({ path: 'Notes/a.md', tags: ['private'] })).toBe('local-only');
      expect(holder.visibility({ path: 'Notes/a.md' })).toBe('open');
    });

    it('adds its own entries, and keeps the last good through a bad read', async () => {
      writeSettings(
        JSON.stringify({ exclude: ['Drafts/**'], localOnly: { paths: ['Clients/**'] } }),
      );
      const holder = vaultPrivacyHolder(MACHINE, root);
      await holder.refresh();
      expect(holder.visibility({ path: 'Drafts/a.md' })).toBe('hidden');
      expect(holder.visibility({ path: 'Clients/a.md' })).toBe('local-only');
      expect(holder.visibility({ path: 'Secret/a.md' })).toBe('hidden');

      writeSettings('{ not json');
      await holder.refresh({ force: true });
      expect(holder.visibility({ path: 'Clients/a.md' })).toBe('local-only');

      vaultSettingsHooksForTests.resolve = () => {
        throw new Error('not built');
      };
      await holder.refresh({ force: true });
      expect(holder.visibility({ path: 'Drafts/a.md' })).toBe('hidden');

      // No file at all: none of the file's own entries, the machine's still.
      vaultSettingsHooksForTests.resolve = fakeResolve;
      rmSync(join(root, '.oscode'), { recursive: true });
      await holder.refresh({ force: true });
      expect(holder.visibility({ path: 'Drafts/a.md' })).toBe('open');
      expect(holder.visibility({ path: 'Secret/a.md' })).toBe('hidden');
    });

    it('holds the vault tools to the union once they refresh', async () => {
      writeFileSync(join(root, 'Clients.md'), '# c');
      mkdirSync(join(root, 'Drafts'));
      writeFileSync(join(root, 'Drafts', 'd.md'), '# d');
      writeSettings(JSON.stringify({ exclude: ['Drafts/**'] }));
      const out = await vaultListTool.execute({}, vaultCtx());
      expect(out.content).toContain('Clients.md');
      expect(out.content).not.toContain('Drafts/d.md');
    });
  });

  describe('the app overrides only narrow (L13)', () => {
    const cfg = (vault: Partial<OscConfig['vault']> = {}): OscConfig => {
      const base = defaultConfig();
      return { ...base, vault: { ...base.vault, ...vault } };
    };

    it('turns the pack and the handoff off, and lowers the size', () => {
      const out = applyVaultOverrides(cfg(), { context: 'off', handoff: 'off', packSize: 'small' });
      expect(out.vault.context).toBe('off');
      expect(out.vault.handoff).toBe('off');
      expect(out.vault.packSize).toBe('small');
    });

    it('never turns a switch on or raises the size', () => {
      const off = cfg({ context: 'off', handoff: 'off', packSize: 'small' });
      for (const o of [
        {},
        { packSize: 'large' },
        { packSize: 'normal' },
        { context: 'full' },
        { context: 'auto', handoff: 'auto' },
        { packSize: 'huge' },
      ] as VaultOverrides[]) {
        expect(applyVaultOverrides(off, o).vault, JSON.stringify(o)).toEqual(off.vault);
      }
      const normal = cfg();
      expect(applyVaultOverrides(normal, { packSize: 'large' }).vault.packSize).toBe('normal');
      expect(applyVaultOverrides(normal, undefined)).toBe(normal);
      // The caller's config is never touched.
      applyVaultOverrides(normal, { context: 'off' });
      expect(normal.vault.context).toBe('auto');
    });
  });
});

// ---- M7 stream C end ----
