// Today's note (Vault M6, 6.4; CTO K7, CX X11): the day's path comes from
// Obsidian's daily-notes config (else the vault root and YYYY-MM-DD), an
// existing note opens unchanged with nothing read and nothing said, a new one
// starts from its template (found exactly, then as a wikilink resolves) or
// blank when the template is missing, a format the date core cannot read is
// refused by name, and the config is read at most once a minute.
//
// The date core (harness/vault/dates.ts) is stream A2's; a small fake stands
// in for it here, injected through `dates`.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyNoteConfig, DateParts, TemplateFill } from 'os-code/protocol';
import {
  VAULT_TODAY_CONFIG_TTL_MS,
  clearVaultTodayCache,
  resolveVaultToday,
  vaultTodayLine,
  type VaultTodayDates,
  type VaultTodayDeps,
} from '../src/lib/vaultToday.js';
import { vaultTodayAria } from '../src/lib/vaultCopy.js';

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
  };
  return { deps, calls, advance: (ms: number) => (clock += ms) };
}

beforeEach(() => clearVaultTodayCache());

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
  it('reads the config at most once a minute, three provider calls at most', async () => {
    const { deps, calls, advance } = vault(
      { 'obsidian/daily-notes': { template: 'Templates/Day' } },
      { 'Templates/Day.md': 't' },
    );
    await resolveVaultToday(deps);
    expect(calls.config.length + calls.reads.length).toBeLessThanOrEqual(3);
    advance(VAULT_TODAY_CONFIG_TTL_MS - 1000);
    await resolveVaultToday(deps);
    expect(calls.config).toHaveLength(2);
    advance(2000);
    await resolveVaultToday(deps);
    expect(calls.config).toHaveLength(4);
  });

  it('keys the cache by vault, so a repoint reads again', async () => {
    const { deps, calls } = vault({});
    await resolveVaultToday({ ...deps, cacheKey: 'a' });
    await resolveVaultToday({ ...deps, cacheKey: 'b' });
    expect(calls.config).toHaveLength(4);
  });
});

describe("the Today button's label", () => {
  it('names the day in words', () => {
    expect(vaultTodayAria(SUNDAY)).toBe("Today's note, Sunday, September 27");
  });
});
