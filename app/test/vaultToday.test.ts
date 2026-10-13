// Today's note (Vault M6, 6.4; tech review K7, UX review X11): the day's path comes from
// Obsidian's daily-notes config (else the vault root and YYYY-MM-DD), an
// existing note opens unchanged with nothing read and nothing said, a new one
// starts from its template (found exactly, then as a wikilink resolves) or
// blank when the template is missing, a format the date core cannot read is
// refused by name, and the config is read at most once a minute.
//
// The date core (harness/vault/dates.ts) is stream A2's; a small fake stands
// in for it here, injected through `dates`. Since Vault M7 the config comes
// through the settings loader (lib/vaultSettings.ts); its resolver is M7
// stream A's, so a fake with L3's precedence for the daily fields (Obsidian,
// then the vault's own file, then the defaults) is injected through
// `settingsCore`.
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ConfigRead,
  DailyNoteConfig,
  DateParts,
  ResolvedVaultSettings,
  TemplateFill,
  VaultSettingsReads,
} from 'os-code/protocol';
import { readDailyNotesConfig, readTemplatesConfig } from '../src/lib/gitos/config.js';
import type { VaultSettingsCore } from '../src/lib/vaultSettings.js';
import {
  VAULT_TODAY_CONFIG_TTL_MS,
  clearVaultTodayCache,
  resolveVaultToday,
  vaultTodayLine,
  type VaultTodayDates,
  type VaultTodayDeps,
} from '../src/lib/vaultToday.js';
import { vaultTodayAria } from '../src/lib/vaultCopy.js';
import { clearVaultSettingsCache, resetVaultSettingsForTests } from '../src/lib/vaultSettings.js';

const SUNDAY: DateParts = {
  year: 2026,
  month: 9,
  day: 27,
  weekday: 0,
  hour: 9,
  minute: 5,
  second: 0,
  millisecond: 0,
  epochMs: Date.UTC(2026, 8, 27, 9, 5),
  offsetMinutes: 0,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY, MM, DD and literal separators; anything else is refused by name. */
const dates: VaultTodayDates = {
  datePartsOf: () => SUNDAY,
  formatVaultDate: (p, fmt) => {
    const bad = fmt.replace(/YYYY|MM|DD|HH|mm/g, '').match(/[A-Za-z]+/);
    if (bad) return { ok: false, token: bad[0] };
    return {
      ok: true,
      text: fmt
        .replace('YYYY', String(p.year))
        .replace('MM', pad(p.month))
        .replace('DD', pad(p.day))
        .replace('HH', pad(p.hour))
        .replace('mm', pad(p.minute)),
    };
  },
  dailyNotePath: (p: DateParts, cfg: DailyNoteConfig) => {
    const r = dates.formatVaultDate(p, cfg.format);
    if (!r.ok) return { ok: false, error: `bad ${r.token}` };
    return { ok: true, path: `${cfg.folder ? `${cfg.folder}/` : ''}${r.text}.md` };
  },
  fillTemplate: (text: string, fill: TemplateFill) =>
    text
      .replace('{{title}}', fill.title)
      .replace(
        '{{date}}',
        (dates.formatVaultDate(fill.parts, fill.dateFormat) as { text: string }).text,
      )
      .replace(
        '{{time}}',
        (dates.formatVaultDate(fill.parts, fill.timeFormat) as { text: string }).text,
      ),
};

function fileJson(read: ConfigRead): Record<string, Record<string, string>> {
  if (!read.ok) return {};
  try {
    return JSON.parse(read.text) as Record<string, Record<string, string>>;
  } catch {
    return {};
  }
}

/** L3 for the daily fields only: Obsidian, then the vault file, then the
 *  defaults. */
const settingsCore: VaultSettingsCore = {
  resolve(reads: VaultSettingsReads) {
    const od = readDailyNotesConfig(reads.daily);
    const ot = readTemplatesConfig(reads.templates);
    const f = fileJson(reads.file);
    const template = od.template ?? f.daily?.template;
    return {
      daily: {
        folder: od.folder ?? f.daily?.folder ?? '',
        format: od.format ?? f.daily?.format ?? 'YYYY-MM-DD',
        ...(template ? { template } : {}),
      },
      templates: {
        dateFormat: ot.dateFormat ?? f.templates?.dateFormat ?? 'YYYY-MM-DD',
        timeFormat: ot.timeFormat ?? f.templates?.timeFormat ?? 'HH:mm',
      },
      narrowing: {},
      fileState: reads.file.ok ? 'ok' : 'absent',
    } as unknown as ResolvedVaultSettings;
  },
  patch: () => undefined,
};

function vault(config: Record<string, unknown>, bodies: Record<string, string> = {}) {
  const calls = { config: [] as string[], reads: [] as string[] };
  let clock = Date.UTC(2026, 8, 27, 9, 5);
  const deps: VaultTodayDeps = {
    provider: {
      async readConfig(_rid, name) {
        calls.config.push(name);
        const v = config[name];
        return v === undefined
          ? { ok: false, reason: 'absent' }
          : { ok: true, text: JSON.stringify(v), version: '1' };
      },
    },
    resourceId: 'vault',
    paths: Object.keys(bodies),
    readBody: async (p) => {
      calls.reads.push(p);
      return bodies[p];
    },
    now: () => new Date(clock),
    dates,
    settingsCore,
  };
  return { deps, calls, advance: (ms: number) => (clock += ms) };
}

beforeEach(() => resetVaultSettingsForTests());

describe("today's note path", () => {
  it('uses the vault root and YYYY-MM-DD when Obsidian says nothing', async () => {
    const { deps } = vault({});
    const plan = await resolveVaultToday({ ...deps, provider: undefined });
    expect(plan).toMatchObject({ ok: true, path: '2026-09-27.md', exists: false, text: '' });
    expect(vaultTodayLine(plan)).toBe("Started today's note.");
  });

  it('follows the daily-notes folder and format', async () => {
    const { deps } = vault({ 'obsidian/daily-notes': { folder: 'Daily', format: 'YYYY/MM-DD' } });
    const plan = await resolveVaultToday(deps);
    expect(plan).toMatchObject({ ok: true, path: 'Daily/2026/09-27.md', title: '09-27' });
  });

  it('an existing note opens unchanged: no template read, nothing said', async () => {
    const { deps, calls } = vault(
      { 'obsidian/daily-notes': { folder: 'Daily', template: 'Templates/Day' } },
      { 'Daily/2026-09-27.md': 'my morning', 'Templates/Day.md': '# {{title}}' },
    );
    const plan = await resolveVaultToday(deps);
    expect(plan).toMatchObject({ ok: true, path: 'Daily/2026-09-27.md', exists: true, text: '' });
    expect(calls.reads).toEqual([]);
    expect(vaultTodayLine(plan)).toBeUndefined();
  });

  it('matches an existing note whatever its case', async () => {
    const { deps } = vault(
      { 'obsidian/daily-notes': { folder: 'daily' } },
      { 'Daily/2026-09-27.md': 'x' },
    );
    const plan = await resolveVaultToday(deps);
    expect(plan).toMatchObject({ ok: true, path: 'Daily/2026-09-27.md', exists: true });
  });

  it('refuses a format it cannot read by name, and makes nothing', async () => {
    const { deps } = vault({ 'obsidian/daily-notes': { format: 'YYYY-MM-DD ZZ' } });
    const plan = await resolveVaultToday(deps);
    expect(plan).toEqual({ ok: false, reason: 'format', format: 'YYYY-MM-DD ZZ', token: 'ZZ' });
    expect(vaultTodayLine(plan)).toBe(
      'Your daily notes format "YYYY-MM-DD ZZ" uses "ZZ", which OpenShore cannot read yet, so no note was made.',
    );
  });
});

describe("today's template", () => {
  it('starts a new note from the template, with the templates date format', async () => {
    const { deps, calls } = vault(
      {
        'obsidian/daily-notes': { template: 'Templates/Day' },
        'obsidian/templates': { dateFormat: 'DD.MM.YYYY', timeFormat: 'HH:mm' },
      },
      { 'Templates/Day.md': '# {{title}}\n{{date}} at {{time}}\n' },
    );
    const plan = await resolveVaultToday(deps);
    expect(plan).toMatchObject({
      ok: true,
      path: '2026-09-27.md',
      exists: false,
      text: '# 2026-09-27\n27.09.2026 at 09:05\n',
      template: { path: 'Templates/Day.md', found: true },
    });
    expect(calls.reads).toEqual(['Templates/Day.md']);
    expect(vaultTodayLine(plan)).toBe("Started today's note from Day.");
  });

  it('finds a template by name the way a wikilink does', async () => {
    const { deps } = vault(
      { 'obsidian/daily-notes': { template: 'Day' } },
      { 'Templates/Day.md': 'hello' },
    );
    const plan = await resolveVaultToday(deps);
    expect(plan).toMatchObject({
      ok: true,
      text: 'hello',
      template: { path: 'Templates/Day.md', found: true },
    });
  });

  it('a missing template starts the note blank and says so', async () => {
    const { deps } = vault({ 'obsidian/daily-notes': { template: 'Templates/Gone' } });
    const plan = await resolveVaultToday(deps);
    expect(plan).toMatchObject({
      ok: true,
      text: '',
      template: { path: 'Templates/Gone', found: false },
    });
    expect(vaultTodayLine(plan)).toBe(
      "Started today's note. The template Templates/Gone was not found, so it is blank.",
    );
  });
});

describe("today's budget", () => {
  it('reads the config at most once a minute, five provider calls at most', async () => {
    const { deps, calls, advance } = vault(
      { 'obsidian/daily-notes': { template: 'Templates/Day' } },
      { 'Templates/Day.md': 't' },
    );
    await resolveVaultToday(deps);
    // The settings loader's four config reads (Vault M7, tech review L5) and the
    // template.
    expect(calls.config.length + calls.reads.length).toBeLessThanOrEqual(5);
    advance(VAULT_TODAY_CONFIG_TTL_MS - 1000);
    await resolveVaultToday(deps);
    expect(calls.config).toHaveLength(4);
    advance(2000);
    await resolveVaultToday(deps);
    expect(calls.config).toHaveLength(8);
  });

  it('keys the cache by vault, so a repoint reads again', async () => {
    const { deps, calls } = vault({});
    await resolveVaultToday({ ...deps, cacheKey: 'a' });
    await resolveVaultToday({ ...deps, cacheKey: 'b' });
    expect(calls.config).toHaveLength(8);
  });

  it('clearVaultTodayCache is the settings cache: one clear reads both again', async () => {
    expect(clearVaultTodayCache).toBe(clearVaultSettingsCache);
    const { deps, calls } = vault({});
    await resolveVaultToday(deps);
    clearVaultTodayCache();
    await resolveVaultToday(deps);
    expect(calls.config).toHaveLength(8);
  });
});

describe("today's note from the vault's own settings (Vault M7, tech review L3)", () => {
  it("uses the vault file's daily folder, format and template when Obsidian sets none", async () => {
    const { deps } = vault(
      {
        'oscode/vault': {
          version: 1,
          daily: { folder: 'Journal/Days', format: 'YYYY/MM-DD', template: 'Templates/Daily' },
        },
      },
      { 'Templates/Daily.md': '## Plan {{date}}' },
    );
    const plan = await resolveVaultToday(deps);
    expect(plan).toMatchObject({
      ok: true,
      path: 'Journal/Days/2026/09-27.md',
      text: '## Plan 2026-09-27',
      template: { path: 'Templates/Daily.md', found: true },
    });
  });

  it('Obsidian wins where it sets a field, so the two apps never make the day twice', async () => {
    const { deps } = vault({
      'obsidian/daily-notes': { folder: 'Daily' },
      'oscode/vault': { version: 1, daily: { folder: 'Elsewhere' } },
    });
    const plan = await resolveVaultToday(deps);
    expect(plan).toMatchObject({ ok: true, path: 'Daily/2026-09-27.md' });
  });
});

describe("the Today button's label", () => {
  it('names the day in words', () => {
    expect(vaultTodayAria(SUNDAY)).toBe("Today's note, Sunday, September 27");
  });
});
