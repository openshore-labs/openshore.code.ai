// Today's note, the pure core (Vault M6, CTO K7): the supported moment token
// subset, a refusal that names the first unsupported token, the daily note's
// path through the one new-name rule, and template variables.
import { describe, expect, it } from 'vitest';
import {
  VAULT_DAILY_DEFAULTS,
  dailyNotePath,
  datePartsOf,
  fillTemplate,
  formatVaultDate,
} from '../src/protocol.js';
import type { DateParts } from '../src/protocol.js';

/** Parts for a local wall-clock moment (the formatter reads only parts, so
 *  every row but X and x holds in any time zone). */
function at(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): DateParts {
  return datePartsOf(new Date(y, mo - 1, d, h, mi, s, ms));
}

function fmt(p: DateParts, f: string): string {
  const r = formatVaultDate(p, f);
  if (!r.ok) throw new Error(`refused ${r.token}`);
  return r.text;
}

describe('datePartsOf (K7)', () => {
  it('splits the host local clock', () => {
    const d = new Date(2026, 8, 27, 14, 5, 9, 42);
    expect(datePartsOf(d)).toEqual({
      year: 2026,
      month: 9,
      day: 27,
      weekday: 0,
      hour: 14,
      minute: 5,
      second: 9,
      millisecond: 42,
      epochMs: d.getTime(),
      offsetMinutes: -d.getTimezoneOffset(),
    });
  });
});

describe('formatVaultDate: the supported tokens (K7)', () => {
  const p = at(2026, 9, 27, 14, 5, 9); // a Sunday

  it.each([
    ['YYYY-MM-DD', '2026-09-27'],
    ['YY', '26'],
    ['Q', '3'],
    ['M MM MMM MMMM', '9 09 Sep September'],
    ['D DD Do', '27 27 27th'],
    ['DDD DDDD', '270 270'],
    ['d dd ddd dddd', '0 Su Sun Sunday'],
    ['E', '7'],
    ['H HH h hh k kk', '14 14 2 02 14 14'],
    ['m mm s ss', '5 05 9 09'],
    ['A a', 'PM pm'],
    ['dddd, MMMM Do, YYYY', 'Sunday, September 27th, 2026'],
    ['YYYY/MM/YYYY-MM-DD', '2026/09/2026-09-27'],
  ])('%s', (f, want) => {
    expect(fmt(p, f)).toBe(want);
  });

  it('pads the day of the year and the small hours', () => {
    const early = at(2026, 1, 5, 0, 7, 3);
    expect(fmt(early, 'DDD DDDD')).toBe('5 005');
    expect(fmt(early, 'H HH h hh k kk A')).toBe('0 00 12 12 24 24 AM');
    expect(fmt(at(2026, 1, 5, 12), 'h A a')).toBe('12 PM pm');
  });

  it('writes English ordinals, teens included', () => {
    const days: Array<[number, string]> = [
      [1, '1st'],
      [2, '2nd'],
      [3, '3rd'],
      [4, '4th'],
      [11, '11th'],
      [12, '12th'],
      [13, '13th'],
      [21, '21st'],
      [22, '22nd'],
      [23, '23rd'],
      [31, '31st'],
    ];
    for (const [d, want] of days) expect(fmt(at(2026, 1, d), 'Do')).toBe(want);
  });

  it('counts ISO weeks (W WW GGGG GG), which may belong to the year before', () => {
    expect(fmt(at(2026, 1, 1), 'GGGG-[W]WW E')).toBe('2026-W01 4'); // a Thursday
    expect(fmt(at(2021, 1, 1), 'GGGG-[W]WW GG W')).toBe('2020-W53 20 53'); // a Friday
    expect(fmt(at(2024, 12, 30), 'GGGG-[W]WW')).toBe('2025-W01'); // a Monday
    expect(fmt(at(2026, 9, 27), 'W')).toBe('39');
  });

  it('counts English locale weeks (w ww gggg): Sunday first, week 1 holds January 1st', () => {
    expect(fmt(at(2021, 1, 1), 'gggg w ww')).toBe('2021 1 01');
    expect(fmt(at(2020, 12, 27), 'gggg w')).toBe('2021 1'); // the Sunday before
    expect(fmt(at(2020, 12, 26), 'gggg w')).toBe('2020 52');
    expect(fmt(at(2026, 9, 27), 'w')).toBe('40');
  });

  it('writes unix seconds and milliseconds from the moment itself', () => {
    const p: DateParts = { ...at(2026, 9, 27), epochMs: 1_790_000_000_123 };
    expect(fmt(p, 'X x')).toBe('1790000000 1790000000123');
  });

  it('keeps [bracketed] text and a backslash escape literal', () => {
    const p = at(2026, 9, 27, 14, 5);
    expect(fmt(p, '[Week] W [of] YYYY')).toBe('Week 39 of 2026');
    expect(fmt(p, 'YYYY-MM-DD[T]HH:mm')).toBe('2026-09-27T14:05');
    expect(fmt(p, 'YYYY-MM-DD\\THH')).toBe('2026-09-27T14');
    expect(fmt(p, '[]YYYY')).toBe('2026');
  });

  it('passes punctuation, digits, spaces and non-ASCII letters through', () => {
    expect(fmt(at(2026, 9, 27), 'YYYY.MM.DD - 1 (,) é 日')).toBe('2026.09.27 - 1 (,) é 日');
  });
});

describe('formatVaultDate: unsupported tokens refuse by name (K7)', () => {
  const p = at(2026, 9, 27);
  it.each([
    ['YYYY-MM-DDTHH', 'T'],
    ['Mo', 'Mo'],
    ['Qo', 'Qo'],
    ['DDDo', 'DDDo'],
    ['HH:mm:ss.SSS', 'SSS'],
    ['YYYYY', 'YYYYY'],
    ['Y', 'Y'],
    ['gg', 'gg'],
    ['GGGGG', 'GGGGG'],
    ['e', 'e'],
    ['Z', 'Z'],
    ['ZZ', 'ZZ'],
    ['z', 'z'],
    ['N', 'N'],
    ['wo', 'wo'],
    ['YYYY-MM-DD [ok] note', 'n'],
  ])('%s refuses %s', (f, token) => {
    expect(formatVaultDate(p, f)).toEqual({ ok: false, token });
  });

  it('names the FIRST unsupported token', () => {
    expect(formatVaultDate(p, 'YYYY SSS Z')).toEqual({ ok: false, token: 'SSS' });
  });

  it('refuses a letter that an unclosed bracket leaves outside', () => {
    expect(formatVaultDate(p, '[Week W')).toEqual({ ok: false, token: 'e' });
  });
});

describe('dailyNotePath (K7)', () => {
  const p = at(2026, 9, 27, 9, 30);

  it('defaults to the vault root and YYYY-MM-DD', () => {
    expect(dailyNotePath(p, VAULT_DAILY_DEFAULTS)).toEqual({ ok: true, path: '2026-09-27.md' });
    expect(dailyNotePath(p, { folder: '', format: '' })).toEqual({
      ok: true,
      path: '2026-09-27.md',
    });
  });

  it('puts the note in the folder, and a / in the format makes folders', () => {
    expect(dailyNotePath(p, { folder: '/Daily/', format: 'YYYY/MM/YYYY-MM-DD' })).toEqual({
      ok: true,
      path: 'Daily/2026/09/2026-09-27.md',
    });
    expect(dailyNotePath(p, { folder: 'Journal', format: 'dddd, MMMM Do YYYY' })).toEqual({
      ok: true,
      path: 'Journal/Sunday, September 27th 2026.md',
    });
  });

  it('refuses an unsupported token by name with no suggestion', () => {
    const r = dailyNotePath(p, { folder: 'Daily', format: 'YYYY-MM-DD SSS' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('"SSS"');
      expect(r.suggestion).toBeUndefined();
    }
  });

  it('runs the new-name rule, so a colon is refused with a clean suggestion', () => {
    const r = dailyNotePath(p, { folder: '', format: 'YYYY-MM-DD HH:mm' });
    expect(r).toMatchObject({ ok: false, suggestion: '2026-09-27 0930.md' });
  });
});

describe('fillTemplate (K7)', () => {
  const fill = {
    parts: at(2026, 9, 27, 8, 4),
    title: '2026-09-27',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
  };

  it('fills date, time and title, and every other byte stays', () => {
    const tpl = '---\ntags: [daily]\n---\n# {{title}}\r\nOpened {{date}} at {{time}}.\n{{other}}\n';
    expect(fillTemplate(tpl, fill)).toBe(
      '---\ntags: [daily]\n---\n# 2026-09-27\r\nOpened 2026-09-27 at 08:04.\n{{other}}\n',
    );
  });

  it('takes a format after a colon, in any case, with spaces inside the braces', () => {
    expect(fillTemplate('{{date:dddd}} {{ TIME : h:mm A }} {{Date:[W]W}}', fill)).toBe(
      'Sunday 8:04 AM W39',
    );
  });

  it('falls back to the defaults when the vault gives no formats', () => {
    expect(fillTemplate('{{date}} {{time}}', { ...fill, dateFormat: '', timeFormat: '' })).toBe(
      '2026-09-27 08:04',
    );
  });

  it('leaves a variable whose format it cannot read as written', () => {
    expect(fillTemplate('{{date:YYYY SSS}} {{title:x}}', fill)).toBe(
      '{{date:YYYY SSS}} {{title:x}}',
    );
    expect(fillTemplate('{{date}}', { ...fill, dateFormat: 'YYYY Z' })).toBe('{{date}}');
  });

  it('does not re-read a title that looks like a variable', () => {
    expect(fillTemplate('{{title}}', { ...fill, title: '{{date}}' })).toBe('{{date}}');
  });
});
