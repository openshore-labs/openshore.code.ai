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
import {
  VAULT_SETTINGS_DEFAULTS,
  VAULT_SETTINGS_FIELDS,
  VAULT_SETTINGS_LIST_MAX,
  WIDENING_KEYS,
  WIDENING_PLAIN,
  parseVaultSettingsFile,
  patchVaultSettingsFile,
  readObsidianAppConfig,
  resolveVaultSettings,
  unionNarrowing,
  vaultContextOn,
  vaultHandoffOn,
  vaultPackSize,
} from '../src/harness/vault/settings.js';
import { compileVaultPrivacy } from '../src/harness/vault/privacy.js';
import { PACK_SIZE_FACTOR, packBudgetTokens } from '../src/harness/vaultContext.js';
import { VAULT_PACK_MAX_TOKENS } from '../src/harness/profile.js';
import type {
  ConfigRead,
  ResolvedVaultSettings,
  VaultOverrides,
  VaultSettingsField,
  VaultSettingsReads,
} from '../src/harness/vault/types.js';
// Stream C's engine half.
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

const REPO = join(HERE, '..', '..');

const ok = (text: string, version = 'v1'): ConfigRead => ({ ok: true, text, version });
const absent: ConfigRead = { ok: false, reason: 'absent' };

function reads(over: Partial<VaultSettingsReads> = {}): VaultSettingsReads {
  return { file: absent, app: absent, daily: absent, templates: absent, ...over };
}

function fileOf(obj: unknown) {
  const r = parseVaultSettingsFile(JSON.stringify(obj));
  if ('unreadable' in r) throw new Error('unreadable');
  return r;
}

describe('no config is today (L18)', () => {
  it('four absent reads resolve to exactly VAULT_SETTINGS_DEFAULTS', () => {
    expect(resolveVaultSettings(reads())).toEqual(VAULT_SETTINGS_DEFAULTS);
  });

  it('the defaults are today: the folder in view, reading, name, Trash, wikilinks, the root day', () => {
    const d = VAULT_SETTINGS_DEFAULTS;
    expect(d.newNotes).toEqual({ location: 'current' });
    expect(d.editor).toEqual({ openMode: 'read', font: 'default', size: 'default' });
    expect(d.tree.sort).toBe('name');
    expect(d.delete).toBe('trash');
    expect(d.links).toEqual({ style: 'wiki', format: 'shortest', updateOnRename: 'ask' });
    // vaultToday.ts today: folder root, YYYY-MM-DD, no template, the
    // template date format falls back to the daily format, HH:mm.
    expect(d.daily).toEqual({ folder: '', format: 'YYYY-MM-DD' });
    expect(d.templates).toEqual({ dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' });
    expect(d.attachments).toEqual({});
    expect(d.agent).toEqual({});
    expect(d.narrowing).toEqual({ exclude: [], localOnly: { paths: [], tags: [] } });
    expect(d.fileState).toBe('absent');
    expect(d.obsidian).toBe(false);
    for (const f of VAULT_SETTINGS_FIELDS) expect(d.source[f], f).toBe('default');
    expect(Object.isFrozen(d) && Object.isFrozen(d.narrowing.exclude)).toBe(true);
  });

  it('an empty file, or one holding only its version, is still the defaults', () => {
    for (const text of ['{}', '{"version":1}\n']) {
      const r = resolveVaultSettings(reads({ file: ok(text, 'f1') }));
      expect({ ...r, fileState: 'absent', fileVersion: undefined }).toEqual({
        ...VAULT_SETTINGS_DEFAULTS,
        fileVersion: undefined,
      });
      expect(r.fileState).toBe('ok');
      expect(r.fileVersion).toBe('f1');
    }
  });

  it('the privacy judge with the file narrowing unioned in is the machine judge alone', () => {
    const machine = {
      exclude: ['Secret/**'],
      localOnly: { paths: ['Private/**'], tags: ['private'] },
    };
    const a = compileVaultPrivacy(machine);
    const b = compileVaultPrivacy(
      machine,
      unionNarrowing(undefined, VAULT_SETTINGS_DEFAULTS.narrowing),
    );
    for (const path of ['Secret/a.md', 'Private/b.md', 'Open/c.md']) {
      expect(b.visibility({ path })).toBe(a.visibility({ path }));
    }
  });

  it('packBudgetTokens with no size or max is the M4 number', () => {
    for (const fraction of [0.08, 0.15, 0.25]) {
      for (const served of [0, 4096, 8192, 16384, 131072, 1_000_000]) {
        const m4 = Math.max(0, Math.min(VAULT_PACK_MAX_TOKENS, Math.floor(served * fraction)));
        expect(packBudgetTokens({ vaultPackFraction: fraction }, served)).toBe(m4);
        expect(packBudgetTokens({ vaultPackFraction: fraction }, served, 'normal')).toBe(m4);
      }
    }
  });
});

describe('a .obsidian folder alone configures the vault (L2, L3)', () => {
  const app = ok(
    JSON.stringify({
      newFileLocation: 'folder',
      newFileFolderPath: 'Inbox',
      attachmentFolderPath: './assets',
      newLinkFormat: 'relative',
      useMarkdownLinks: true,
      alwaysUpdateLinks: true,
      defaultViewMode: 'source',
      trashOption: 'none',
      userIgnoreFilters: ['Archive/', '/^tmp.*/', 'Old'],
    }),
  );
  const daily = ok(
    JSON.stringify({ folder: 'Journal/Daily', format: 'YYYY/MM/DD', template: 'Templates/Day' }),
  );
  const templates = ok(
    JSON.stringify({ folder: 'Templates', dateFormat: 'DD MMM', timeFormat: 'h:mm A' }),
  );

  it('every seeded field reads from Obsidian, the rest stay default', () => {
    const r = resolveVaultSettings(reads({ app, daily, templates }));
    expect(r.newNotes).toEqual({ location: 'folder', folder: 'Inbox' });
    expect(r.attachments).toEqual({ folder: './assets' });
    expect(r.links).toEqual({ style: 'markdown', format: 'relative', updateOnRename: 'always' });
    expect(r.editor.openMode).toBe('edit');
    expect(r.delete).toBe('permanent');
    expect(r.daily).toEqual({
      folder: 'Journal/Daily',
      format: 'YYYY/MM/DD',
      template: 'Templates/Day',
    });
    expect(r.templates).toEqual({
      folder: 'Templates',
      dateFormat: 'DD MMM',
      timeFormat: 'h:mm A',
    });
    expect(r.ignore).toEqual({ paths: ['Archive/', 'Old'], regexSkipped: 1 });
    expect(r.obsidian).toBe(true);
    expect(r.fileState).toBe('absent');
    const fromObsidian: VaultSettingsField[] = [
      'newNotes.location',
      'newNotes.folder',
      'editor.openMode',
      'delete',
      'daily.folder',
      'daily.format',
      'daily.template',
      'templates.folder',
      'templates.dateFormat',
      'templates.timeFormat',
      'links.style',
      'links.format',
      'links.updateOnRename',
      'attachments.folder',
    ];
    for (const f of VAULT_SETTINGS_FIELDS) {
      expect(r.source[f], f).toBe(fromObsidian.includes(f) ? 'obsidian' : 'default');
    }
    // Obsidian's Excluded files are never privacy.
    expect(r.narrowing).toEqual(VAULT_SETTINGS_DEFAULTS.narrowing);
  });

  it('Obsidian wins per field over the vault file, which fills only what Obsidian leaves unset', () => {
    const file = ok(
      JSON.stringify({
        version: 1,
        newNotes: { location: 'root' },
        daily: { folder: 'Days', format: 'DD-MM-YYYY' },
        tree: { sort: 'modified' },
        editor: { font: 'serif', openMode: 'read' },
      }),
    );
    const r = resolveVaultSettings(
      reads({
        file,
        app: ok('{"newFileLocation":"folder","defaultViewMode":"source"}'),
        daily: ok('{"folder":"Journal"}'),
      }),
    );
    expect(r.newNotes.location).toBe('folder');
    expect(r.source['newNotes.location']).toBe('obsidian');
    expect(r.editor.openMode).toBe('edit');
    expect(r.daily.folder).toBe('Journal');
    expect(r.source['daily.folder']).toBe('obsidian');
    expect(r.daily.format).toBe('DD-MM-YYYY');
    expect(r.source['daily.format']).toBe('vault');
    expect(r.tree.sort).toBe('modified');
    expect(r.source['tree.sort']).toBe('vault');
    expect(r.editor.font).toBe('serif');
    expect(r.source['editor.font']).toBe('vault');
  });

  it('an Obsidian false is still a setting: wikilinks and ask, from Obsidian', () => {
    const r = resolveVaultSettings(
      reads({
        app: ok('{"useMarkdownLinks":false,"alwaysUpdateLinks":false,"trashOption":"local"}'),
        file: ok('{"links":{"style":"markdown"},"delete":"permanent"}'),
      }),
    );
    expect(r.links.style).toBe('wiki');
    expect(r.source['links.style']).toBe('obsidian');
    expect(r.links.updateOnRename).toBe('ask');
    expect(r.delete).toBe('trash');
    expect(r.source.delete).toBe('obsidian');
  });

  it('reads the three new app.json keys tolerantly', () => {
    expect(
      readObsidianAppConfig(
        ok('{"defaultViewMode":"weird","trashOption":3,"userIgnoreFilters":"x"}'),
      ),
    ).toEqual({});
    expect(
      readObsidianAppConfig(
        ok(
          '{"defaultViewMode":"preview","trashOption":"system","userIgnoreFilters":[1," A/ ",""]}',
        ),
      ),
    ).toEqual({
      defaultViewMode: 'preview',
      trashOption: 'system',
      userIgnoreFilters: ['A/'],
    });
  });
});

describe('the file states (L4, CX Y5)', () => {
  it('bad JSON or a non-object is unreadable, and nothing of it applies', () => {
    for (const text of ['{', '[]', 'null', '"x"', '7', '']) {
      expect(parseVaultSettingsFile(text), text).toEqual({ unreadable: true });
      const r = resolveVaultSettings(reads({ file: ok(text, 'bad') }));
      expect(r.fileState).toBe('unreadable');
      expect(r.narrowing).toEqual(VAULT_SETTINGS_DEFAULTS.narrowing);
    }
  });

  it('a refusal other than absent is unavailable, so the host keeps its last good narrowing', () => {
    for (const reason of ['downloading', 'unsupported', 'refused', 'too-large'] as const) {
      expect(resolveVaultSettings(reads({ file: { ok: false, reason } })).fileState).toBe(
        'unavailable',
      );
    }
  });

  it('a BOM is fine', () => {
    expect(fileOf({}).setAside).toEqual([]);
    const r = parseVaultSettingsFile('\uFEFF{"tree":{"sort":"created"}}');
    expect(r).toEqual({ file: { tree: { sort: 'created' } }, setAside: [] });
  });
});

describe('the vault file may only narrow (L4)', () => {
  for (const key of WIDENING_KEYS) {
    it(`sets aside "${key}" as widening, with its plain, and applies the rest`, () => {
      const r = fileOf({
        [key]: key === 'handoff' ? 'auto' : { anything: true },
        tree: { sort: 'modified' },
      });
      expect(r.setAside).toEqual([{ key, reason: 'widens', plain: WIDENING_PLAIN[key] }]);
      expect(r.file).toEqual({ tree: { sort: 'modified' } });
      expect(WIDENING_PLAIN[key]).toMatch(/^[a-z]/);
    });
  }

  it('gives the pack keys and the handoff their CX plains', () => {
    expect(WIDENING_PLAIN.pack).toBe('give notes more room in each chat');
    expect(WIDENING_PLAIN.packSize).toBe('give notes more room in each chat');
    expect(WIDENING_PLAIN.handoff).toBe('turn the handoff back on');
  });

  it('a widening name nested in a section is set aside too', () => {
    const r = fileOf({ localOnly: { paths: ['A'], unexclude: ['Private'] } });
    expect(r.setAside).toEqual([
      { key: 'localOnly.unexclude', reason: 'widens', plain: WIDENING_PLAIN.unexclude },
    ]);
    expect(r.file).toEqual({ localOnly: { paths: ['A'] } });
  });

  it('rejects a negated glob in every list', () => {
    const r = fileOf({
      exclude: ['Drafts/**', '!Drafts/keep.md'],
      localOnly: { paths: ['  !Private/**', 'Work/**'], tags: ['!private', 'secret'] },
    });
    expect(r.file).toEqual({
      exclude: ['Drafts/**'],
      localOnly: { paths: ['Work/**'], tags: ['secret'] },
    });
    expect(r.setAside).toEqual([
      { key: 'exclude[1]', reason: 'widens', plain: 'let models see "Drafts/keep.md"' },
      { key: 'localOnly.paths[0]', reason: 'widens', plain: 'send "Private/**" to cloud models' },
      {
        key: 'localOnly.tags[0]',
        reason: 'widens',
        plain: 'send notes tagged #private to cloud models',
      },
    ]);
  });

  it('an agent folder that climbs or names a dot folder widens', () => {
    for (const folder of ['../outside', 'a/../../b', '/etc', '.oscode', 'Notes/.git', '\\abs']) {
      const r = fileOf({ agent: { folder } });
      expect(r.file, folder).toEqual({});
      expect(r.setAside[0]?.reason, folder).toBe('widens');
      expect(r.setAside[0]?.key).toBe('agent.folder');
    }
    expect(fileOf({ agent: { folder: 'Agent/Drafts/' } }).file).toEqual({
      agent: { folder: 'Agent/Drafts' },
    });
  });

  it('an unknown key is set aside as unknown, a wrong type as invalid, and the rest applies', () => {
    const r = fileOf({
      version: 1,
      theme: 'dark',
      __proto__x: 1,
      newNotes: { location: 'somewhere', folder: 'Inbox', colour: 'red' },
      tree: 'name',
      delete: true,
      exclude: 'Private',
      daily: { folder: '../up', format: 7, template: '.hidden/Day' },
      editor: { size: 'larger' },
    });
    expect(r.file).toEqual({
      version: 1,
      newNotes: { folder: 'Inbox' },
      editor: { size: 'larger' },
    });
    const by = Object.fromEntries(r.setAside.map((s) => [s.key, s.reason]));
    expect(by).toEqual({
      theme: 'unknown',
      __proto__x: 'unknown',
      'newNotes.location': 'invalid',
      'newNotes.colour': 'unknown',
      tree: 'invalid',
      delete: 'invalid',
      exclude: 'invalid',
      'daily.folder': 'invalid',
      'daily.format': 'invalid',
      'daily.template': 'invalid',
    });
    for (const s of r.setAside) expect(s.plain.length).toBeGreaterThan(0);
  });

  it('a __proto__ key never reaches a prototype', () => {
    const r = parseVaultSettingsFile('{"__proto__":{"polluted":true},"tree":{"sort":"name"}}');
    expect(r).toEqual({
      file: { tree: { sort: 'name' } },
      setAside: [{ key: '__proto__', reason: 'unknown', plain: expect.any(String) }],
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('a version other than 1 is set aside', () => {
    expect(fileOf({ version: 2 }).setAside[0]).toMatchObject({ key: 'version', reason: 'invalid' });
  });

  it('caps a list at 200 entries and a string at 512 characters', () => {
    const many = Array.from({ length: 205 }, (_, i) => `F${i}/**`);
    const r = fileOf({ exclude: many, localOnly: { tags: ['x'.repeat(513), 'ok'] } });
    expect(r.file.exclude).toHaveLength(VAULT_SETTINGS_LIST_MAX);
    expect(r.file.localOnly?.tags).toEqual(['ok']);
    expect(r.setAside.map((s) => s.key)).toEqual(['exclude[200]', 'localOnly.tags[0]']);
  });

  it("attachments keep Obsidian's forms", () => {
    for (const [inp, out] of [
      ['/', '/'],
      ['./', './'],
      ['./sub', './sub'],
      ['Assets', 'Assets'],
    ] as const) {
      expect(fileOf({ attachments: { folder: inp } }).file.attachments?.folder).toBe(out);
    }
    for (const bad of ['../x', './../x', '.git', '/abs']) {
      expect(fileOf({ attachments: { folder: bad } }).setAside[0]?.reason, bad).toBe('invalid');
    }
  });
});

describe('union only (L4)', () => {
  const machine = {
    exclude: ['Secret/**'],
    localOnly: { paths: ['Private/**', 'Journal/**'], tags: ['private'] },
  };

  it('never removes a machine entry, whatever the file says', () => {
    const file = resolveVaultSettings(
      reads({ file: ok('{"exclude":[],"localOnly":{"paths":[],"tags":[]}}') }),
    ).narrowing;
    const u = unionNarrowing(machine, file);
    expect(u).toEqual({
      exclude: ['Secret/**'],
      localOnly: { paths: ['Private/**', 'Journal/**'], tags: ['private'] },
    });
    const p = compileVaultPrivacy({ exclude: [], localOnly: { paths: [], tags: [] } }, u);
    expect(p.visibility({ path: 'Private/a.md' })).toBe('local-only');
    expect(p.visibility({ path: 'Secret/a.md' })).toBe('hidden');
    expect(p.visibility({ path: 'x.md', tags: ['private'] })).toBe('local-only');
  });

  it('joins every part in order, drops only exact repeats, and ignores holes', () => {
    const file = {
      exclude: ['Drafts/**', 'Secret/**'],
      localOnly: { paths: ['Work/**'], tags: ['client'] },
    };
    expect(unionNarrowing(machine, undefined, file, {})).toEqual({
      exclude: ['Secret/**', 'Drafts/**'],
      localOnly: { paths: ['Private/**', 'Journal/**', 'Work/**'], tags: ['private', 'client'] },
    });
    expect(unionNarrowing()).toEqual({ exclude: [], localOnly: { paths: [], tags: [] } });
  });

  it('every machine entry survives any file narrowing (a sweep)', () => {
    const files = [
      {},
      { exclude: [] },
      { localOnly: {} },
      { localOnly: { paths: ['Private/**'] } },
      { exclude: ['!Secret/**'] },
      { localOnly: { paths: ['!Private/**'], tags: ['!private'] } },
    ];
    for (const f of files) {
      const parsed = resolveVaultSettings(reads({ file: ok(JSON.stringify(f)) })).narrowing;
      const u = unionNarrowing(machine, parsed);
      for (const e of machine.exclude) expect(u.exclude).toContain(e);
      for (const e of machine.localOnly.paths) expect(u.localOnly?.paths).toContain(e);
      for (const e of machine.localOnly.tags) expect(u.localOnly?.tags).toContain(e);
    }
  });
});

describe('patchVaultSettingsFile (L7)', () => {
  it('starts a new file at version 1', () => {
    expect(patchVaultSettingsFile(undefined, { field: 'tree.sort', value: 'modified' })).toBe(
      '{\n  "version": 1,\n  "tree": {\n    "sort": "modified"\n  }\n}\n',
    );
  });

  it('changes one field and keeps unknown and set-aside keys as found', () => {
    const cur = '{"pack":"large","theme":"dark","tree":{"sort":"name","x":1},"exclude":["A"]}';
    const next = patchVaultSettingsFile(cur, { field: 'tree.sort', value: 'created' })!;
    expect(JSON.parse(next)).toEqual({
      pack: 'large',
      theme: 'dark',
      tree: { sort: 'created', x: 1 },
      exclude: ['A'],
    });
    expect(next.endsWith('}\n')).toBe(true);
    const list = patchVaultSettingsFile(cur, { field: 'exclude', value: ['A', 'B/**'] })!;
    expect(JSON.parse(list).exclude).toEqual(['A', 'B/**']);
  });

  it('Default removes the key, and a section it empties', () => {
    const cur = '{"version":1,"tree":{"sort":"name"},"editor":{"font":"mono","size":"larger"}}';
    expect(JSON.parse(patchVaultSettingsFile(cur, { field: 'tree.sort', value: null })!)).toEqual({
      version: 1,
      editor: { font: 'mono', size: 'larger' },
    });
    expect(JSON.parse(patchVaultSettingsFile(cur, { field: 'editor.font', value: null })!)).toEqual(
      {
        version: 1,
        tree: { sort: 'name' },
        editor: { size: 'larger' },
      },
    );
    expect(
      JSON.parse(
        patchVaultSettingsFile('{"delete":"permanent"}', { field: 'delete', value: null })!,
      ),
    ).toEqual({});
  });

  it('never overwrites a file that is not a JSON object', () => {
    for (const cur of ['{', '[]', 'null', '', 'hello']) {
      expect(
        patchVaultSettingsFile(cur, { field: 'tree.sort', value: 'name' }),
        cur,
      ).toBeUndefined();
    }
  });

  it('round-trips through the parser', () => {
    let text: string | undefined;
    text = patchVaultSettingsFile(text, { field: 'newNotes.location', value: 'folder' });
    text = patchVaultSettingsFile(text, { field: 'newNotes.folder', value: 'Inbox' });
    text = patchVaultSettingsFile(text, {
      field: 'localOnly.paths',
      value: ['Private/**', 'Journal/**'],
    });
    const r = resolveVaultSettings(reads({ file: ok(text!) }));
    expect(r.newNotes).toEqual({ location: 'folder', folder: 'Inbox' });
    expect(r.narrowing.localOnly?.paths).toEqual(['Private/**', 'Journal/**']);
    expect(r.setAside).toEqual([]);
  });

  it('refuses a list on a scalar field and the reverse', () => {
    expect(() =>
      patchVaultSettingsFile(undefined, { field: 'tree.sort', value: ['name'] }),
    ).toThrow(TypeError);
    expect(() => patchVaultSettingsFile(undefined, { field: 'exclude', value: 'A' })).toThrow(
      TypeError,
    );
  });
});

describe('the reach switches (L13)', () => {
  it('vaultContextOn: any off wins, the app only turns it off', () => {
    expect(vaultContextOn(undefined, undefined, undefined)).toBe(true);
    expect(vaultContextOn('auto', 'full', undefined)).toBe(true);
    expect(vaultContextOn('off', undefined, undefined)).toBe(false);
    expect(vaultContextOn('auto', 'off', undefined)).toBe(false);
    expect(vaultContextOn('full', 'full', 'off')).toBe(false);
  });

  it('vaultHandoffOn: machine, project and app must all allow it', () => {
    expect(vaultHandoffOn(undefined, undefined, undefined)).toBe(true);
    expect(vaultHandoffOn('auto', 'auto', undefined)).toBe(true);
    expect(vaultHandoffOn('off', 'auto', undefined)).toBe(false);
    expect(vaultHandoffOn('auto', 'off', undefined)).toBe(false);
    expect(vaultHandoffOn('auto', 'auto', 'off')).toBe(false);
  });

  it('vaultPackSize: the app may only lower the machine', () => {
    expect(vaultPackSize(undefined, undefined)).toBe('normal');
    expect(vaultPackSize('large', undefined)).toBe('large');
    expect(vaultPackSize('large', 'small')).toBe('small');
    expect(vaultPackSize('normal', 'large')).toBe('normal');
    expect(vaultPackSize('small', 'large')).toBe('small');
    expect(vaultPackSize(undefined, 'large')).toBe('normal');
    expect(vaultPackSize('huge' as never, 'tiny' as never)).toBe('normal');
  });

  it('packBudgetTokens: 0.5, 1, 1.5 on the class budget, always capped by max', () => {
    expect(PACK_SIZE_FACTOR).toEqual({ small: 0.5, normal: 1, large: 1.5 });
    const p = { vaultPackFraction: 0.1 };
    expect(packBudgetTokens(p, 16000, 'small')).toBe(800);
    expect(packBudgetTokens(p, 16000, 'normal')).toBe(1600);
    expect(packBudgetTokens(p, 16000, 'large')).toBe(2400);
    expect(packBudgetTokens(p, 100000, 'large')).toBe(VAULT_PACK_MAX_TOKENS);
    expect(packBudgetTokens(p, 100000, 'large', 8000)).toBe(8000);
    expect(packBudgetTokens(p, 16000, 'large', 1000)).toBe(1000);
    expect(packBudgetTokens(p, 16000, 'huge' as never)).toBe(1600);
    expect(packBudgetTokens(p, 16000, 'constructor' as never)).toBe(1600);
    expect(packBudgetTokens(p, 16000, 'normal', Number.NaN)).toBe(1600);
  });
});

// Every L2 field and the runtime code that reads it (L18). The files exist
// today; wave 2 wires each one to the resolved settings.
const CONSUMERS: Readonly<
  Record<VaultSettingsField, ReadonlyArray<{ file: string; reads: RegExp }>>
> = {
  'newNotes.location': [{ file: 'app/src/screens/VaultScreen.tsx', reads: /newNotes\.location/ }],
  'newNotes.folder': [{ file: 'app/src/screens/VaultScreen.tsx', reads: /newNotes\.folder/ }],
  'editor.openMode': [{ file: 'app/src/screens/VaultScreen.tsx', reads: /editor\.openMode/ }],
  'tree.sort': [{ file: 'app/src/lib/vault.ts', reads: /\bsort\b.*(modified|created)|tree\.sort/ }],
  delete: [{ file: 'app/src/lib/vaultCaps.ts', reads: /\.delete\b.*permanent|permanent/ }],
  exclude: [
    { file: 'os-code/src/harness/vault/privacy.ts', reads: /narrowing\?\.exclude/ },
    { file: 'app/src/lib/vaultPrivacy.ts', reads: /unionNarrowing/ },
    { file: 'os-code/src/core/agent/registry.ts', reads: /unionNarrowing/ },
  ],
  'localOnly.paths': [
    { file: 'os-code/src/harness/vault/privacy.ts', reads: /narrowing\?\.localOnly\?\.paths/ },
    { file: 'app/src/lib/vaultPrivacy.ts', reads: /unionNarrowing/ },
    { file: 'os-code/src/core/agent/registry.ts', reads: /unionNarrowing/ },
  ],
  'localOnly.tags': [
    { file: 'os-code/src/harness/vault/privacy.ts', reads: /narrowing\?\.localOnly\?\.tags/ },
    { file: 'app/src/lib/vaultPrivacy.ts', reads: /unionNarrowing/ },
    { file: 'os-code/src/core/agent/registry.ts', reads: /unionNarrowing/ },
  ],
  'agent.folder': [
    { file: 'os-code/src/core/tools/vault.ts', reads: /agent\.folder|agentFolder/ },
    { file: 'app/src/lib/vaultTool.ts', reads: /agent\.folder|agentFolder/ },
  ],
  'daily.folder': [
    {
      file: 'app/src/lib/vaultToday.ts',
      reads: /\.daily\b|resolveVaultSettings|loadVaultSettings/,
    },
    { file: 'os-code/src/routines/scheduler.ts', reads: /vaultSettingsFor/ },
  ],
  'daily.format': [
    {
      file: 'app/src/lib/vaultToday.ts',
      reads: /\.daily\b|resolveVaultSettings|loadVaultSettings/,
    },
    { file: 'os-code/src/routines/scheduler.ts', reads: /vaultSettingsFor/ },
  ],
  'daily.template': [
    {
      file: 'app/src/lib/vaultToday.ts',
      reads: /\.daily\b|resolveVaultSettings|loadVaultSettings/,
    },
  ],
  'templates.folder': [
    { file: 'app/src/lib/vaultToday.ts', reads: /templates\.folder|loadVaultSettings/ },
    { file: 'app/src/lib/vaultPackSource.ts', reads: /templates\.folder/ },
  ],
  'templates.dateFormat': [
    { file: 'app/src/lib/vaultToday.ts', reads: /templates\.dateFormat|loadVaultSettings/ },
  ],
  'templates.timeFormat': [
    { file: 'app/src/lib/vaultToday.ts', reads: /templates\.timeFormat|loadVaultSettings/ },
  ],
  'links.style': [
    { file: 'app/src/components/vault/VaultLinkSuggest.tsx', reads: /links\.style|linkStyle/ },
    { file: 'app/src/components/vault/VaultAccessoryBar.tsx', reads: /links\.style|linkStyle/ },
  ],
  'links.format': [
    { file: 'app/src/components/vault/VaultLinkSuggest.tsx', reads: /links\.format|linkFormat/ },
  ],
  'links.updateOnRename': [
    { file: 'app/src/components/vault/VaultRenameSheet.tsx', reads: /updateOnRename/ },
  ],
  'attachments.folder': [{ file: 'app/src/state/store.ts', reads: /attachments\.folder/ }],
  'editor.font': [{ file: 'app/src/theme.css', reads: /--vault-font/ }],
  'editor.size': [{ file: 'app/src/theme.css', reads: /--vault-size-step/ }],
};

describe('every field has a runtime consumer (L18)', () => {
  it('the table names every field, each at a file that exists', () => {
    expect(Object.keys(CONSUMERS).sort()).toEqual([...VAULT_SETTINGS_FIELDS].sort());
    for (const [field, rows] of Object.entries(CONSUMERS)) {
      expect(rows.length, field).toBeGreaterThan(0);
      for (const row of rows) {
        expect(() => statSync(join(REPO, row.file)), `${field}: ${row.file}`).not.toThrow();
      }
    }
  });

  // Emergency door, targeted: the consumers are wired by streams C and F and
  // the wave 2 integrator, which unskips this once they land.
  it.skip('each consumer reads its field (unskip in wave 2, when the consumers are wired)', () => {
    const missing: string[] = [];
    for (const [field, rows] of Object.entries(CONSUMERS)) {
      for (const row of rows) {
        if (!row.reads.test(readFileSync(join(REPO, row.file), 'utf8')))
          missing.push(`${field}: ${row.file}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

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
