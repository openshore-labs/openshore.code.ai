// Vault M7, the customization surface (CTO L5 to L7, L11 to L13, L18; CX Y1 to
// Y17). One file, fenced by owner so the wave 1 streams never touch the same
// lines: wave 0's guards, stream E's providers, stream F's settings loader,
// sheet logic and starter, and wave 2's room wiring.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC = join(ROOT, 'src');

// ---- M7 wave 0 begin ----

describe("the settings writer is the person's alone (L7)", () => {
  it('the app agent path never names writeConfig or vaultWriteConfig', () => {
    const text = readFileSync(join(SRC, 'lib/vaultTool.ts'), 'utf8');
    expect(text).not.toMatch(/\b(?:writeConfig|writeVaultConfigFile|vaultWriteConfig)\b/);
  });

  it('no driver names them either', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
      });
    const hits = walk(join(SRC, 'drivers')).filter((f) =>
      /\b(?:writeConfig|writeVaultConfigFile|vaultWriteConfig)\b/.test(readFileSync(f, 'utf8')),
    );
    expect(hits.map((f) => relative(SRC, f))).toEqual([]);
  });
});

// ---- M7 wave 0 end ----

// ---- M7 stream E begin ----
// Providers (L7, L16): writeConfig on the desktop folder, the hub and Local
// (ifMatch, ifAbsent, `obsidian/*` refused); settingsWrite lit only with
// writeConfig, compare-and-swap, writable and not away; the team vault on
// main has no writeConfig and reads defaults.

describe.todo('writeConfig on each provider (stream E)');

// ---- M7 stream E end ----

// ---- M7 stream F begin ----
// Settings (L5, L6, L11 to L13, L18; CX Y2, Y3, Y5, Y13, Y17): no files
// equals VAULT_SETTINGS_DEFAULTS and today's behavior; a `.obsidian` field
// renders read-only with "From Obsidian"; a widening ask yields one set-aside
// line and changes nothing; a bad file writes nothing; a same-field conflict
// shows "Use {yours}"; the cache and its invalidations; delete mode; the
// starter is refused on a non-empty vault and writes ifAbsent.

import { beforeEach, vi } from 'vitest';
import {
  PACK_BY_CLASS,
  compileVaultPrivacy,
  type ConfigRead,
  type ModelClassProfile,
  type ResolvedVaultSettings,
  type VaultPrivacyNarrowing,
  type VaultSettingsField,
  type VaultSettingsPatch,
  type VaultSettingsReads,
  type VaultSettingsSource,
} from 'os-code/protocol';
import type { StorageProvider, StoredFile, WriteGuard } from '../src/lib/gitos/providers.js';
import {
  VAULT_SETTINGS_TTL_MS,
  cachedVaultSettings,
  loadVaultSettings,
  rawFieldValue,
  resetVaultSettingsForTests,
  saveVaultSetting,
  vaultNarrowingStamp,
  vaultSettingRow,
  vaultSettingSaveLine,
  vaultSettingsHint,
  vaultSettingsKey,
  vaultSettingsSetAsideLines,
  type VaultNarrowingStore,
  type VaultSettingsCore,
} from '../src/lib/vaultSettings.js';
import { appVaultPrivacy } from '../src/lib/vaultPrivacy.js';
import { createAppVaultPack, type AppVaultPackDeps } from '../src/lib/vaultPackSource.js';
import {
  runVaultTool,
  vaultAgentWriteRefusal,
  vaultApproveRefusal,
  vaultAnthropicTool,
  type VaultProposal,
  type VaultToolContext,
} from '../src/lib/vaultTool.js';
import { treeAt, vaultTreeSortOffered } from '../src/lib/vault.js';
import {
  VAULT_STARTER_PATHS,
  applyVaultStarter,
  planVaultStarter,
  vaultStarterOffered,
  vaultStarterSettingsText,
  type VaultStarterState,
} from '../src/lib/vaultStarter.js';
import {
  VAULT_SETTINGS_AGENT_DENY,
  VAULT_SETTINGS_FROM_OBSIDIAN,
  VAULT_SETTINGS_MERGED,
  VAULT_SETTINGS_OBSIDIAN_OWN,
  VAULT_SETTINGS_SAVED,
  VAULT_SETTINGS_UNREADABLE,
  VAULT_STARTER_ADDED,
  vaultNotesInChatsSub,
  vaultSettingsUseYours,
  vaultStarterConventions,
} from '../src/lib/vaultCopy.js';
import type { DriverEvent } from 'os-code/protocol';

// The resolver and the patcher are stream A's (stubs in this tree), so a
// small fake with L3's shape stands in: Obsidian's daily-notes folder and
// app.json link style win; else the file; else the default. A widening key
// is set aside with its plain; bad JSON reads `unreadable`; a read that
// cannot answer reads `unavailable`.
const WIDENS: Record<string, string> = {
  packSize: 'give notes more room in each chat',
  handoff: 'turn the handoff back on',
};

function jsonOf(read: ConfigRead): Record<string, unknown> | 'bad' | undefined {
  if (!read.ok) return undefined;
  try {
    const v = JSON.parse(read.text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : 'bad';
  } catch {
    return 'bad';
  }
}

const FIELDS: VaultSettingsField[] = [
  'newNotes.location',
  'newNotes.folder',
  'editor.openMode',
  'tree.sort',
  'delete',
  'exclude',
  'localOnly.paths',
  'localOnly.tags',
  'agent.folder',
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
  'editor.font',
  'editor.size',
];

const resolveCalls: VaultSettingsReads[] = [];

const fakeCore: VaultSettingsCore = {
  resolve(reads) {
    resolveCalls.push(reads);
    const raw = jsonOf(reads.file);
    const file = raw === 'bad' ? undefined : raw;
    const daily = jsonOf(reads.daily);
    const app = jsonOf(reads.app);
    const obsDaily = daily && daily !== 'bad' ? daily : {};
    const obsApp = app && app !== 'bad' ? app : {};
    const source = Object.fromEntries(
      FIELDS.map((f) => [
        f,
        rawFieldValue(reads.file.ok ? reads.file.text : undefined, f) !== undefined && raw !== 'bad'
          ? 'vault'
          : 'default',
      ]),
    ) as Record<VaultSettingsField, VaultSettingsSource>;
    if (typeof obsDaily.folder === 'string') source['daily.folder'] = 'obsidian';
    if (typeof obsApp.useMarkdownLinks === 'boolean') source['links.style'] = 'obsidian';
    const fd = (file?.daily ?? {}) as Record<string, string>;
    const narrowing: VaultPrivacyNarrowing = {
      ...(Array.isArray(file?.exclude) ? { exclude: file.exclude as string[] } : {}),
      ...(file?.localOnly
        ? { localOnly: file.localOnly as VaultPrivacyNarrowing['localOnly'] }
        : {}),
    };
    return {
      newNotes: { location: 'root' },
      daily: {
        folder: (obsDaily.folder as string | undefined) ?? fd.folder ?? '',
        format: fd.format ?? 'YYYY-MM-DD',
      },
      templates: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
      attachments: {},
      links: {
        style: obsApp.useMarkdownLinks === true ? 'markdown' : 'wiki',
        format: 'shortest',
        updateOnRename: 'ask',
      },
      editor: { openMode: 'read', font: 'default', size: 'default' },
      tree: { sort: 'name' },
      delete: 'trash',
      agent: {},
      narrowing: raw === 'bad' || !file ? {} : narrowing,
      ignore: { paths: [], regexSkipped: 0 },
      source,
      setAside: file
        ? Object.keys(file)
            .filter((k) => k in WIDENS)
            .map((k) => ({ key: k, reason: 'widens' as const, plain: WIDENS[k]! }))
        : [],
      fileState: reads.file.ok
        ? raw === 'bad'
          ? 'unreadable'
          : 'ok'
        : reads.file.reason === 'absent'
          ? 'absent'
          : 'unavailable',
      ...(reads.file.ok && raw !== 'bad' ? { fileVersion: reads.file.version } : {}),
      obsidian: [reads.app, reads.daily, reads.templates].some((r) => r.ok),
    };
  },
  patch(current: string | undefined, patch: VaultSettingsPatch) {
    let obj: Record<string, unknown>;
    if (current === undefined) obj = { version: 1 };
    else {
      try {
        const v = JSON.parse(current) as unknown;
        if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
        obj = v as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
    const parts = patch.field.split('.');
    let at = obj;
    for (const part of parts.slice(0, -1)) {
      if (!at[part] || typeof at[part] !== 'object') at[part] = {};
      at = at[part] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1]!;
    if (patch.value === null) delete at[last];
    else at[last] = patch.value;
    return `${JSON.stringify(obj, null, 2)}\n`;
  },
};

/** A memory store for the last good narrowing. */
function memoryNarrowings(): VaultNarrowingStore & { kept: Map<string, VaultPrivacyNarrowing> } {
  const kept = new Map<string, VaultPrivacyNarrowing>();
  return {
    kept,
    load: async (k) => kept.get(k),
    save: async (k, n) => void kept.set(k, n),
  };
}

type ConfigFiles = Record<string, ConfigRead>;

/** A storage whose four config files are the given reads, with a guarded
 *  writeConfig over `oscode/vault`. */
function storage(files: ConfigFiles = {}) {
  const calls = { reads: [] as string[], writes: [] as Array<{ text: string; guard: WriteGuard }> };
  let n = 0;
  const provider = {
    async readConfig(_rid: string, name: string): Promise<ConfigRead> {
      calls.reads.push(name);
      return files[name] ?? { ok: false, reason: 'absent' };
    },
    async writeConfig(_rid: string, _name: string, text: string, guard: WriteGuard) {
      calls.writes.push({ text, guard });
      const cur = files['oscode/vault'];
      const theirs: StoredFile | undefined = cur?.ok
        ? { path: '.oscode/vault.json', text: cur.text, updatedAt: 't', version: cur.version }
        : undefined;
      if ('ifAbsent' in guard && cur?.ok)
        return { ok: false as const, conflict: 'exists' as const, theirs };
      if ('ifMatch' in guard && (!cur?.ok || cur.version !== guard.ifMatch)) {
        return { ok: false as const, conflict: 'changed' as const, ...(theirs ? { theirs } : {}) };
      }
      const version = `v${++n}w`;
      files['oscode/vault'] = { ok: true, text, version };
      return {
        ok: true as const,
        file: { path: '.oscode/vault.json', text, updatedAt: 't', version },
      };
    },
  };
  return { provider, calls, files };
}

const ok = (v: unknown, version = 'v1'): ConfigRead => ({
  ok: true,
  text: typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`,
  version,
});

const KEY = vaultSettingsKey('files', 'vault');
const load = (
  p: Pick<StorageProvider, 'readConfig'> | undefined,
  o: { now?: () => number; narrowings?: VaultNarrowingStore; force?: boolean } = {},
) => loadVaultSettings(p, 'vault', KEY, { core: fakeCore, narrowings: memoryNarrowings(), ...o });

beforeEach(() => {
  resetVaultSettingsForTests();
  resolveCalls.length = 0;
});

describe('loading a vault settings (L5, L6, L18)', () => {
  it('no files: the core gets four absent reads, and nothing is set aside', async () => {
    const { provider, calls } = storage();
    const s = await load(provider);
    expect(calls.reads.sort()).toEqual(
      ['obsidian/app', 'obsidian/daily-notes', 'obsidian/templates', 'oscode/vault'].sort(),
    );
    expect(resolveCalls[0]).toEqual({
      file: { ok: false, reason: 'absent' },
      app: { ok: false, reason: 'absent' },
      daily: { ok: false, reason: 'absent' },
      templates: { ok: false, reason: 'absent' },
    });
    expect(s.fileState).toBe('absent');
    expect(s.setAside).toEqual([]);
    expect(s.narrowing).toEqual({});
  });

  it('a provider without readConfig reads as unsupported everywhere, never throws', async () => {
    const s = await load(undefined);
    expect(resolveCalls[0]!.file).toEqual({ ok: false, reason: 'unsupported' });
    expect(s.fileState).toBe('unavailable');
  });

  it('caches per vault for 60 seconds, and one read in flight serves two callers', async () => {
    let now = 1_000;
    const { provider, calls } = storage();
    await Promise.all([load(provider, { now: () => now }), load(provider, { now: () => now })]);
    expect(calls.reads).toHaveLength(4);
    now += VAULT_SETTINGS_TTL_MS - 1;
    await load(provider, { now: () => now });
    expect(calls.reads).toHaveLength(4);
    now += 2;
    await load(provider, { now: () => now });
    expect(calls.reads).toHaveLength(8);
    await loadVaultSettings(provider, 'other', vaultSettingsKey('files', 'other'), {
      core: fakeCore,
      now: () => now,
    });
    expect(calls.reads).toHaveLength(12);
  });

  it('a watcher hint naming .oscode/ or the config folder reads again; a note does not', async () => {
    const { provider, calls } = storage();
    await load(provider);
    expect(vaultSettingsHint(KEY, ['Notes/a.md'])).toBe(false);
    await load(provider);
    expect(calls.reads).toHaveLength(4);
    expect(vaultSettingsHint(KEY, ['.oscode/vault.json'])).toBe(true);
    await load(provider);
    expect(calls.reads).toHaveLength(8);
    expect(vaultSettingsHint(KEY, ['.Obsidian/app.json'])).toBe(true);
    expect(vaultSettingsHint(KEY, ['.config/app.json'], '.config')).toBe(true);
    await load(provider, { force: true });
    expect(calls.reads).toHaveLength(12);
  });

  it('the privacy stamp moves with the file version', async () => {
    const { provider, files } = storage({ 'oscode/vault': ok({ version: 1 }, 'a') });
    const a = vaultNarrowingStamp(await load(provider));
    files['oscode/vault'] = ok({ version: 1 }, 'b');
    const b = vaultNarrowingStamp(await load(provider, { force: true }));
    expect(a).not.toBe(b);
    expect(vaultNarrowingStamp(undefined)).toBe('none');
  });
});

describe('the last good narrowing (L4)', () => {
  const narrow = { version: 1, exclude: ['Clients/**'], localOnly: { paths: ['Health/**'] } };

  it('a file mid-sync or unreadable keeps the last good narrowing, never none', async () => {
    const store = memoryNarrowings();
    const { provider, files } = storage({ 'oscode/vault': ok(narrow) });
    const first = await load(provider, { narrowings: store });
    expect(first.narrowing).toEqual({
      exclude: ['Clients/**'],
      localOnly: { paths: ['Health/**'] },
    });
    expect(store.kept.get(KEY)).toEqual(first.narrowing);

    files['oscode/vault'] = { ok: false, reason: 'downloading' };
    const mid = await load(provider, { narrowings: store, force: true });
    expect(mid.fileState).toBe('unavailable');
    expect(mid.narrowing).toEqual(first.narrowing);

    files['oscode/vault'] = ok('{ not json');
    const bad = await load(provider, { narrowings: store, force: true });
    expect(bad.fileState).toBe('unreadable');
    expect(bad.narrowing).toEqual(first.narrowing);
  });

  it('the device store carries it across a restart', async () => {
    const store = memoryNarrowings();
    store.kept.set(KEY, { exclude: ['Kept/**'] });
    const { provider } = storage({ 'oscode/vault': { ok: false, reason: 'downloading' } });
    expect((await load(provider, { narrowings: store })).narrowing).toEqual({
      exclude: ['Kept/**'],
    });
  });

  it('an absent file means none', async () => {
    const store = memoryNarrowings();
    const { provider, files } = storage({ 'oscode/vault': ok(narrow) });
    await load(provider, { narrowings: store });
    delete files['oscode/vault'];
    const gone = await load(provider, { narrowings: store, force: true });
    expect(gone.narrowing).toEqual({});
    expect(store.kept.get(KEY)).toEqual({});
  });
});

describe('the sheet rows (CX Y2, Y3, Y5)', () => {
  it('a .obsidian field is read-only "From Obsidian"; a field it leaves unset says Obsidian keeps its own', async () => {
    const { provider } = storage({ 'obsidian/daily-notes': ok({ folder: 'Daily' }) });
    const s = await load(provider);
    expect(s.daily.folder).toBe('Daily');
    expect(vaultSettingRow(s, 'daily.folder', { settingsWrite: true })).toMatchObject({
      readOnly: true,
      sub: VAULT_SETTINGS_FROM_OBSIDIAN,
      more: 'Set in Obsidian. Change it there, and OpenShore follows.',
    });
    expect(vaultSettingRow(s, 'daily.format', { settingsWrite: true })).toEqual({
      readOnly: false,
      sub: VAULT_SETTINGS_OBSIDIAN_OWN,
    });
    // A field Obsidian has no setting for says nothing about Obsidian.
    expect(vaultSettingRow(s, 'editor.font', { settingsWrite: true })).toEqual({ readOnly: false });
  });

  it('a .obsidian fixture alone configures the vault', async () => {
    const { provider } = storage({
      'obsidian/app': ok({ useMarkdownLinks: true }),
      'obsidian/daily-notes': ok({ folder: 'Journal/Days' }),
    });
    const s = await load(provider);
    expect(s.fileState).toBe('absent');
    expect(s.links.style).toBe('markdown');
    expect(s.daily.folder).toBe('Journal/Days');
    expect(s.source['links.style']).toBe('obsidian');
  });

  it('a bad file makes every row read-only with its line; a storage that cannot save says its own', async () => {
    const { provider } = storage({ 'oscode/vault': ok('[1, 2') });
    const s = await load(provider);
    for (const f of FIELDS.filter((x) => s.source[x] !== 'obsidian')) {
      expect(vaultSettingRow(s, f, { settingsWrite: true })).toMatchObject({
        readOnly: true,
        reason: VAULT_SETTINGS_UNREADABLE,
      });
    }
    const fresh = await load(storage().provider, { force: true });
    expect(
      vaultSettingRow(fresh, 'tree.sort', { settingsWrite: false, storageLine: 'Off.' }),
    ).toEqual({ readOnly: true, reason: 'Off.' });
  });

  it('a widening ask yields one set-aside line and changes nothing', async () => {
    const { provider } = storage({
      'oscode/vault': ok({ version: 1, packSize: 'large', handoff: 'on', exclude: ['A/**'] }),
    });
    const s = await load(provider);
    expect(vaultSettingsSetAsideLines(s)).toEqual([
      "This vault's settings file also asks to give notes more room in each chat. A settings file can only narrow what models see, so that part is set aside.",
      "This vault's settings file also asks to turn the handoff back on. A settings file can only narrow what models see, so that part is set aside.",
    ]);
    // Nothing widened: the narrowing is only the exclude it may add.
    expect(s.narrowing).toEqual({ exclude: ['A/**'] });
  });
});

describe('saving a setting (L7, CX Y5)', () => {
  const deps = (provider: ReturnType<typeof storage>['provider']) => ({
    provider,
    resourceId: 'vault',
    key: KEY,
    core: fakeCore,
    narrowings: memoryNarrowings(),
  });

  it('the first change creates the file ifAbsent with the one field', async () => {
    const { provider, calls } = storage();
    await load(provider);
    const r = await saveVaultSetting(deps(provider), { field: 'tree.sort', value: 'modified' });
    expect(r.kind).toBe('saved');
    expect(calls.writes).toHaveLength(1);
    expect(calls.writes[0]!.guard).toEqual({ ifAbsent: true });
    expect(JSON.parse(calls.writes[0]!.text)).toEqual({ version: 1, tree: { sort: 'modified' } });
    expect(vaultSettingSaveLine(r, () => '')).toBe(VAULT_SETTINGS_SAVED);
  });

  it('a later change is ifMatch on the version it read, keeps unknown keys, and seeds the cache', async () => {
    const { provider, calls } = storage({
      'oscode/vault': ok({ version: 1, someday: { x: 1 }, packSize: 'large' }, 'v7'),
    });
    await load(provider);
    const r = await saveVaultSetting(deps(provider), { field: 'editor.font', value: 'serif' });
    expect(calls.writes[0]!.guard).toEqual({ ifMatch: 'v7' });
    expect(JSON.parse(calls.writes[0]!.text)).toEqual({
      version: 1,
      someday: { x: 1 },
      packSize: 'large',
      editor: { font: 'serif' },
    });
    expect(r.kind === 'saved' && r.settings.fileVersion).toBe('v1w');
    // Seeded from the text it wrote: no read after the write.
    const before = calls.reads.length;
    expect(cachedVaultSettings(KEY)?.fileVersion).toBe('v1w');
    await load(provider);
    expect(calls.reads.length).toBe(before);
  });

  it('"Default" removes the key', async () => {
    const { provider, calls } = storage({
      'oscode/vault': ok({ version: 1, delete: 'permanent' }),
    });
    await load(provider);
    await saveVaultSetting(deps(provider), { field: 'delete', value: null });
    expect(JSON.parse(calls.writes[0]!.text)).toEqual({ version: 1 });
  });

  it('a different field changed elsewhere: re-applied on theirs once, then the merged line', async () => {
    const { provider, calls, files } = storage({ 'oscode/vault': ok({ version: 1 }, 'v1') });
    await load(provider);
    files['oscode/vault'] = ok({ version: 1, editor: { size: 'larger' } }, 'v2');
    const r = await saveVaultSetting(deps(provider), { field: 'tree.sort', value: 'name' });
    expect(calls.writes.map((w) => w.guard)).toEqual([{ ifMatch: 'v1' }, { ifMatch: 'v2' }]);
    expect(JSON.parse(calls.writes[1]!.text)).toEqual({
      version: 1,
      editor: { size: 'larger' },
      tree: { sort: 'name' },
    });
    expect(r).toMatchObject({ kind: 'saved', merged: true });
    expect(vaultSettingSaveLine(r, () => '')).toBe(VAULT_SETTINGS_MERGED);
  });

  it('the same field changed elsewhere: nothing written, theirs shown with "Use {yours}"', async () => {
    const { provider, calls, files } = storage({ 'oscode/vault': ok({ version: 1 }, 'v1') });
    await load(provider);
    files['oscode/vault'] = ok({ version: 1, tree: { sort: 'modified' } }, 'v2');
    const r = await saveVaultSetting(deps(provider), { field: 'tree.sort', value: 'name' });
    expect(calls.writes).toHaveLength(1);
    expect(r).toMatchObject({
      kind: 'same-field',
      field: 'tree.sort',
      theirs: 'modified',
      yours: 'name',
    });
    expect(r.kind === 'same-field' && r.settings.fileVersion).toBe('v2');
    expect(vaultSettingSaveLine(r, (_f, v) => (v === 'modified' ? 'Last edited' : String(v)))).toBe(
      'Sort notes by changed somewhere else while this was open, so yours was not saved. It is Last edited now.',
    );
    expect(vaultSettingsUseYours('Name')).toBe('Use Name');
  });

  it('a bad file writes nothing, ever', async () => {
    const { provider, calls } = storage({ 'oscode/vault': ok('{"version": 1,') });
    await load(provider);
    const r = await saveVaultSetting(deps(provider), { field: 'tree.sort', value: 'name' });
    expect(r).toEqual({ kind: 'unreadable' });
    expect(calls.writes).toEqual([]);
    // A file that is JSON but not an object is not overwritten either.
    resetVaultSettingsForTests();
    const arr = storage({ 'oscode/vault': ok('[]') });
    const core: VaultSettingsCore = {
      ...fakeCore,
      resolve: (reads) => ({ ...fakeCore.resolve(reads), fileState: 'ok' }),
    };
    await loadVaultSettings(arr.provider, 'vault', KEY, { core, narrowings: memoryNarrowings() });
    const r2 = await saveVaultSetting(
      { ...deps(arr.provider), core },
      { field: 'tree.sort', value: 'name' },
    );
    expect(r2).toEqual({ kind: 'unreadable' });
    expect(arr.calls.writes).toEqual([]);
  });

  it('no writeConfig is read-only; a write that throws changes nothing', async () => {
    const { provider } = storage();
    const readOnly = { readConfig: provider.readConfig };
    expect(
      await saveVaultSetting(
        { ...deps(provider), provider: readOnly },
        { field: 'delete', value: 'trash' },
      ),
    ).toEqual({
      kind: 'read-only',
    });
    await load(provider);
    const throwing = {
      readConfig: provider.readConfig,
      writeConfig: vi.fn(async () => {
        throw new Error('disk');
      }),
    };
    const r = await saveVaultSetting(
      { ...deps(provider), provider: throwing },
      { field: 'delete', value: 'trash' },
    );
    expect(r).toEqual({ kind: 'failed' });
    expect(vaultSettingSaveLine(r, () => '')).toBe(
      'Could not save that setting, so nothing changed. Try again in a moment.',
    );
  });
});

describe('the in-vault narrowing joins the privacy rules, union only (L4)', () => {
  const union = (...parts: Array<VaultPrivacyNarrowing | undefined>): VaultPrivacyNarrowing => ({
    exclude: parts.flatMap((p) => [...(p?.exclude ?? [])]),
    localOnly: {
      paths: parts.flatMap((p) => [...(p?.localOnly?.paths ?? [])]),
      tags: parts.flatMap((p) => [...(p?.localOnly?.tags ?? [])]),
    },
  });

  it("the file's lists narrow on top of the D5 rules and the device's", async () => {
    const rules = await appVaultPrivacy({
      device: { exclude: ['Device/**'], localOnly: { paths: [], tags: [] } },
      vault: { exclude: ['Clients/**'], localOnly: { paths: ['Health/**'], tags: ['medical'] } },
      union,
    });
    expect(rules.visibility({ path: 'Clients/acme.md' })).toBe('hidden');
    expect(rules.visibility({ path: 'Device/x.md' })).toBe('hidden');
    expect(rules.visibility({ path: 'Health/bp.md' })).toBe('local-only');
    expect(rules.visibility({ path: 'Notes/x.md', tags: ['medical'] })).toBe('local-only');
    expect(rules.visibility({ path: 'Private/x.md' })).toBe('local-only');
  });

  it('empty lists in the file drop nothing, and compile exactly as before', async () => {
    const union = vi.fn();
    const rules = await appVaultPrivacy({
      vault: { exclude: [], localOnly: { paths: [] } },
      union,
    });
    expect(union).not.toHaveBeenCalled();
    expect(rules.visibility({ path: 'Private/x.md' })).toBe('local-only');
    expect(rules.visibility({ path: 'Journal/y.md' })).toBe('local-only');
  });
});

describe('room for notes and the handoff switch in the pack (L13)', () => {
  const seat = { modelClass: 'small' as const, servedTokens: 4096, leavesNetwork: false };
  const deps = (over: Partial<AppVaultPackDeps> = {}): AppVaultPackDeps => ({
    setting: 'auto',
    index: () => undefined,
    read: async () => undefined,
    privacy: async () => compileVaultPrivacy({ exclude: [], localOnly: { paths: [], tags: [] } }),
    currentState: async () => ({
      path: 'Current State.md',
      text: '# Current State\n\nShips Friday.\n',
    }),
    ...over,
  });
  const budgetOf = (out: { event?: DriverEvent }) =>
    (out.event as Extract<DriverEvent, { type: 'context-pack' }>).budgetTokens;

  it('unset or Normal is byte for byte the budget before M7', async () => {
    const a = createAppVaultPack(deps());
    await a.prepare('t');
    const b = createAppVaultPack(deps({ packSize: () => 'normal' }));
    await b.prepare('t');
    expect(budgetOf(a.render(seat))).toBe(327);
    expect(budgetOf(b.render(seat))).toBe(327);
  });

  it('Small and Large ride into the core budget with the seat', async () => {
    const budget = vi.fn((_p: ModelClassProfile, served: number, size?: string) =>
      size === 'small' ? Math.floor(served / 20) : 999,
    );
    const pack = createAppVaultPack(deps({ packSize: () => 'small', budget }));
    await pack.prepare('t');
    expect(budgetOf(pack.render(seat))).toBe(204);
    expect(budget.mock.calls[0]![2]).toBe('small');
  });

  it('the Handoff switch only turns it off', async () => {
    const handoff = vi.fn(() => 'HANDOFF from X');
    const off = createAppVaultPack(deps({ handoff, handoffSetting: () => 'off' }));
    await off.prepare('one');
    expect(handoff).not.toHaveBeenCalled();
    expect(off.render(seat).text ?? '').not.toContain('HANDOFF');
    const on = createAppVaultPack(deps({ handoff, handoffSetting: () => undefined }));
    await on.prepare('one');
    expect(handoff).toHaveBeenCalledTimes(1);
  });
});

describe('a model never writes under .oscode (L8)', () => {
  function ctx(over: Partial<VaultToolContext> = {}) {
    const proposed: VaultProposal[] = [];
    const c: VaultToolContext = {
      seat: { modelClass: 'large', servedTokens: 200_000, leavesNetwork: true },
      privacy: compileVaultPrivacy({ exclude: [], localOnly: { paths: [], tags: [] } }),
      search: async () => [],
      read: async () => undefined,
      readCapChars: 24_000,
      propose: (p) => void proposed.push(p),
      ...over,
    };
    return { c, proposed };
  }

  it("refused at propose in the person's words, whatever the spelling", async () => {
    for (const path of [
      '.oscode/vault.json',
      '.OSCode/vault.md',
      'notes/../.oscode/x.md',
      ' .oscode /x',
    ]) {
      const { c, proposed } = ctx();
      const r = await runVaultTool(
        { name: 'vaultPropose', input: { path, text: '{}', mode: 'create' } },
        c,
      );
      expect(r, path).toEqual({ content: VAULT_SETTINGS_AGENT_DENY, isError: true });
      expect(proposed).toEqual([]);
    }
  });

  it('refused again at approve, on the path the write would really land on', () => {
    expect(vaultApproveRefusal({ path: 'Notes/a.md' })).toBeUndefined();
    expect(vaultApproveRefusal({ path: 'Notes/a.md' }, { realPath: '.oscode/vault.json' })).toBe(
      VAULT_SETTINGS_AGENT_DENY,
    );
    expect(vaultApproveRefusal({ path: '.oscode/vault.json' })).toBe(VAULT_SETTINGS_AGENT_DENY);
    expect(vaultAgentWriteRefusal('.obsidian/app.md')).toMatch(/dot folder/);
    expect(vaultAgentWriteRefusal('/abs.md')).toMatch(/slash/);
  });

  it("the vault's agent folder narrows where a model may propose, and the tool says so", async () => {
    expect(vaultAgentWriteRefusal('Agent/notes/a.md', 'Agent')).toBeUndefined();
    expect(vaultAgentWriteRefusal('agent/a.md', 'Agent/')).toBeUndefined();
    expect(vaultAgentWriteRefusal('Agents/a.md', 'Agent')).toMatch(/only inside "Agent\/"/);
    const { c, proposed } = ctx({ agentFolder: 'Agent' });
    const r = await runVaultTool(
      { name: 'vaultPropose', input: { path: 'Notes/a.md', text: 'x', mode: 'create' } },
      c,
    );
    expect(r.isError).toBe(true);
    expect(proposed).toEqual([]);
    expect(vaultAnthropicTool('vaultPropose', 'Agent').description).toContain('"Agent/"');
    expect(vaultAnthropicTool('vaultRead', 'Agent').description).not.toContain('Agent/');
  });
});

describe('the tree sort (L2 tree.sort)', () => {
  const files = [
    { path: 'b.md', updatedAt: '2026-09-01T00:00:00Z', size: 1 },
    { path: 'a.md', updatedAt: '2026-09-03T00:00:00Z', size: 1 },
    { path: 'c.md', updatedAt: '2026-09-02T00:00:00Z', size: 1 },
    { path: 'Z/x.md', updatedAt: '2026-09-09T00:00:00Z', size: 1 },
  ];

  it('name is the default and unchanged; modified is newest first; folders stay by name', () => {
    expect(treeAt('', files).map((e) => e.name)).toEqual(['Z', 'a', 'b', 'c']);
    expect(treeAt('', files, [], 'name')).toEqual(treeAt('', files));
    expect(treeAt('', files, ['A'], 'modified').map((e) => e.name)).toEqual([
      'A',
      'Z',
      'a',
      'c',
      'b',
    ]);
  });

  it('created is offered only where every note carries a creation time, never faked', () => {
    expect(vaultTreeSortOffered(files)).toEqual(['name', 'modified']);
    const withCreated = files.map((f, i) => ({ ...f, createdAt: `2026-08-0${i + 1}T00:00:00Z` }));
    expect(vaultTreeSortOffered(withCreated)).toEqual(['name', 'modified', 'created']);
    expect(treeAt('', withCreated, [], 'created').map((e) => e.name)).toEqual(['Z', 'c', 'a', 'b']);
  });
});

describe('the starter layout (L12, CX Y13)', () => {
  function starterVault(
    over: {
      notes?: string[];
      folders?: string[];
      config?: ConfigFiles;
      trash?: number;
      attachments?: number;
      noWriteConfig?: boolean;
      failWrite?: string;
    } = {},
  ) {
    const notes = new Map<string, string>((over.notes ?? []).map((p) => [p, 'x']));
    const folders = new Set(over.folders ?? []);
    const config: ConfigFiles = { ...(over.config ?? {}) };
    const writes: Array<{ path: string; guard?: WriteGuard }> = [];
    const provider = {
      list: async () =>
        [...notes.keys()].map((path) => ({ path, updatedAt: 't', size: 1, version: 'v' })),
      listFolders: async () => [...folders],
      listAttachments: async () =>
        Array.from({ length: over.attachments ?? 0 }, () => ({})) as never[],
      listTrash: async () => Array.from({ length: over.trash ?? 0 }, () => ({})) as never[],
      readConfig: async (_r: string, name: string) =>
        config[name] ?? ({ ok: false, reason: 'absent' } as ConfigRead),
      createFolder: async (_r: string, path: string) => {
        folders.add(path);
        return { ok: true as const };
      },
      write: async (_r: string, path: string, text: string, guard?: WriteGuard) => {
        writes.push({ path, ...(guard ? { guard } : {}) });
        if (path === over.failWrite) throw new Error('disk');
        if (notes.has(path)) return { ok: false as const, conflict: 'exists' as const };
        notes.set(path, text);
        if (path.includes('/')) folders.add(path.split('/')[0]!);
        return { ok: true as const, file: { path, text, updatedAt: 't', version: 'v' } };
      },
      ...(over.noWriteConfig
        ? {}
        : {
            writeConfig: async (_r: string, _n: string, text: string, guard: WriteGuard) => {
              writes.push({ path: '.oscode/vault.json', guard });
              config['oscode/vault'] = { ok: true, text, version: 'c1' };
              return {
                ok: true as const,
                file: { path: '.oscode/vault.json', text, updatedAt: 't', version: 'c1' },
              };
            },
          }),
    };
    const state: VaultStarterState = {
      personal: true,
      caps: { folders: true, settingsWrite: !over.noWriteConfig },
      provider: provider as unknown as VaultStarterState['provider'],
      resourceId: 'vault',
    };
    return { state, notes, folders, config, writes };
  }

  it('is offered for an empty personal vault that can make folders', async () => {
    expect(await vaultStarterOffered(starterVault().state)).toBe(true);
  });

  it('is refused on a note, a folder, Trash, an attachment, .obsidian, a config that cannot answer, or the team vault', async () => {
    const cases: Array<Parameters<typeof starterVault>[0]> = [
      { notes: ['Idea.md'] },
      { folders: ['Projects'] },
      { trash: 1 },
      { attachments: 1 },
      { config: { 'obsidian/app': ok({}) } },
      { config: { 'obsidian/daily-notes': { ok: false, reason: 'downloading' } } },
      { config: { 'oscode/vault': ok({ version: 1 }) } },
      { config: { 'obsidian/templates': { ok: false, reason: 'unsupported' } } },
    ];
    for (const c of cases) {
      const v = starterVault(c);
      expect(await vaultStarterOffered(v.state), JSON.stringify(c)).toBe(false);
      expect(await applyVaultStarter(v.state)).toEqual({ ok: false, refused: 'not-empty' });
      expect(v.writes).toEqual([]);
    }
    const v = starterVault();
    expect(await vaultStarterOffered({ ...v.state, personal: false })).toBe(false);
    expect(await vaultStarterOffered({ ...v.state, obsidianFolder: true })).toBe(false);
    expect(
      await vaultStarterOffered({ ...v.state, caps: { folders: false, settingsWrite: true } }),
    ).toBe(false);
  });

  it('adds the settings first, then every note ifAbsent, and says so', async () => {
    const v = starterVault();
    const r = await applyVaultStarter(v.state);
    expect(r).toMatchObject({
      ok: true,
      added: 5,
      total: 5,
      settingsLanded: true,
      line: VAULT_STARTER_ADDED,
    });
    expect(v.writes[0]).toEqual({ path: '.oscode/vault.json', guard: { ifAbsent: true } });
    for (const w of v.writes) expect(w.guard).toEqual({ ifAbsent: true });
    expect(v.config['oscode/vault']).toMatchObject({ text: vaultStarterSettingsText() });
    expect(JSON.parse(vaultStarterSettingsText())).toEqual({
      version: 1,
      newNotes: { location: 'folder', folder: 'Inbox' },
      daily: { template: 'Templates/Daily' },
      templates: { folder: 'Templates' },
      localOnly: { paths: ['Private/**', 'Journal/**'] },
    });
    expect(v.notes.get(VAULT_STARTER_PATHS.conventions)).toBe(vaultStarterConventions(true));
    expect(v.notes.get(VAULT_STARTER_PATHS.conventions)).toContain(
      "This vault's settings keep anything in Private or Journal off cloud models.",
    );
    expect(v.notes.get(VAULT_STARTER_PATHS.daily)).toBe('## Plan\n\n- [ ] \n\n## Notes\n');
    expect(v.folders.has('Inbox')).toBe(true);
    // Done: it is not offered again.
    expect(await vaultStarterOffered(v.state)).toBe(false);
  });

  it('without a settings write the Private and Journal line is dropped, and no settings line shows', async () => {
    const v = starterVault({ noWriteConfig: true });
    expect(planVaultStarter(v.state.caps).some((i) => i.kind === 'settings')).toBe(false);
    const r = await applyVaultStarter(v.state);
    expect(r).toMatchObject({ ok: true, added: 4, total: 4, settingsLanded: false });
    expect(v.notes.get(VAULT_STARTER_PATHS.conventions)).not.toMatch(/Private|Journal/);
  });

  it('a partial result says how much, and a second try adds the rest', async () => {
    const v = starterVault({ failWrite: VAULT_STARTER_PATHS.daily });
    const r = await applyVaultStarter(v.state);
    expect(r).toMatchObject({
      ok: true,
      added: 4,
      total: 5,
      line: 'Added 4 of 5. Try again to add the rest.',
    });
    const again = starterVault({
      notes: [...v.notes.keys()],
      folders: [...v.folders],
      config: v.config,
    });
    expect(await vaultStarterOffered(again.state)).toBe(true);
    const r2 = await applyVaultStarter(again.state);
    expect(r2).toMatchObject({ ok: true, added: 5, total: 5, line: VAULT_STARTER_ADDED });
    expect(again.writes.map((w) => w.path)).toEqual([VAULT_STARTER_PATHS.daily]);
  });
});

describe('Notes in chats says only what the pack does (CX Y7)', () => {
  it('names matching notes if and only if some class retrieves', () => {
    const retrieves = Object.values(PACK_BY_CLASS).some((m) => m === 'full');
    expect(/notes that match the task/.test(vaultNotesInChatsSub(PACK_BY_CLASS))).toBe(retrieves);
    const none = {
      tiny: 'current-state',
      small: 'current-state',
      mid: 'current-state',
      large: 'current-state',
    };
    expect(vaultNotesInChatsSub(none)).toBe(
      "Each chat starts with this project's Current State and any notes you pinned. A card shows what went. Off applies to new chats.",
    );
    expect(vaultNotesInChatsSub({ ...none, large: 'full' })).toMatch(
      /on some models notes that match the task/,
    );
    expect(
      vaultNotesInChatsSub({ tiny: 'full', small: 'full', mid: 'full', large: 'full' }),
    ).toMatch(/and notes that match the task\./);
  });
});

// ---- M7 stream F end ----

// ---- M7 wave 2 begin ----
// The room (Y4, Y7): the entry points, the Wayfinding rows, the overrides
// into vaultOverrides, the team read-only footer.

describe.todo('vault settings in the room (wave 2)');

// ---- M7 wave 2 end ----
