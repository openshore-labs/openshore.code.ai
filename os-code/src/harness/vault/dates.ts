// Today's note (Vault M6, tech review K7): the host's local clock split into parts,
// Obsidian's moment tokens (`YYYY YY Q M MM MMM MMMM D DD Do DDD DDDD d dd ddd
// dddd E W WW GGGG GG w ww gggg H HH h hh k kk m mm s ss A a X x` and
// `[literal]`; `/` makes folders; English names only), the daily note's path,
// and a template's variables. Any other ASCII letter outside brackets refuses
// the format by name (moment's own token grammar names it whole, like `Mo` or
// `SSS`), so Today never guesses a name that would fork the day's note. A
// backslash escapes one character, as in moment; a non-ASCII letter is no
// moment token in any locale, so it passes through as text.
//
// Weeks follow moment's English locale: `w`, `ww` and `gggg` start on Sunday
// and week 1 holds January 1st; `W`, `WW`, `GGGG` and `GG` are ISO 8601
// (Monday, and week 1 holds the first Thursday).
//
// Pure and import-free past the vault core.

import { checkNewNoteName } from './paths.js';
import type {
  DailyNoteConfig,
  DateParts,
  NewNoteNameCheck,
  TemplateFill,
  VaultDateFormatResult,
} from './types.js';

/** Obsidian's defaults when `obsidian/daily-notes` and `obsidian/templates`
 *  say nothing: the vault root, `YYYY-MM-DD`, no template, `HH:mm`. */
export const VAULT_DAILY_DEFAULTS: Readonly<DailyNoteConfig & { timeFormat: string }> = {
  folder: '',
  format: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Split a moment on the host's local clock. */
export function datePartsOf(d: Date): DateParts {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: d.getDay(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
    millisecond: d.getMilliseconds(),
    epochMs: d.getTime(),
    offsetMinutes: -d.getTimezoneOffset(),
  };
}

function pad(n: number, width: number): string {
  const s = String(Math.abs(n)).padStart(width, '0');
  return n < 0 ? `-${s}` : s;
}

/** Days since 1970-01-01 for a calendar date (proleptic Gregorian). */
function dayNumber(year: number, month: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return Math.floor(d.getTime() / 86_400_000);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function dayOfYear(p: DateParts): number {
  return dayNumber(p.year, p.month, p.day) - dayNumber(p.year, 1, 1) + 1;
}

/** 0 (Sunday) to 6 for a calendar date. */
function weekdayOf(year: number, month: number, day: number): number {
  return (((dayNumber(year, month, day) + 4) % 7) + 7) % 7;
}

/** moment's firstWeekOffset: where week 1 starts relative to January 1st. */
function firstWeekOffset(year: number, dow: number, doy: number): number {
  const fwd = 7 + dow - doy;
  const fwdlw = (7 + weekdayOf(year, 1, fwd) - dow) % 7;
  return -fwdlw + fwd - 1;
}

function weeksInYear(year: number, dow: number, doy: number): number {
  const offset = firstWeekOffset(year, dow, doy);
  const next = firstWeekOffset(year + 1, dow, doy);
  return ((isLeap(year) ? 366 : 365) - offset + next) / 7;
}

/** moment's weekOfYear for a first day of week `dow` and `doy`. */
function weekOfYear(p: DateParts, dow: number, doy: number): { week: number; year: number } {
  const offset = firstWeekOffset(p.year, dow, doy);
  const week = Math.floor((dayOfYear(p) - offset - 1) / 7) + 1;
  if (week < 1) return { week: week + weeksInYear(p.year - 1, dow, doy), year: p.year - 1 };
  const inYear = weeksInYear(p.year, dow, doy);
  if (week > inYear) return { week: week - inYear, year: p.year + 1 };
  return { week, year: p.year };
}

const ISO = { dow: 1, doy: 4 };
const EN = { dow: 0, doy: 6 };

function ordinal(n: number): string {
  const b = n % 10;
  const suffix =
    Math.floor((n % 100) / 10) === 1
      ? 'th'
      : b === 1
        ? 'st'
        : b === 2
          ? 'nd'
          : b === 3
            ? 'rd'
            : 'th';
  return `${n}${suffix}`;
}

function year4(y: number): string {
  return y <= 9999 ? pad(y, 4) : `+${y}`;
}

const TOKENS: Readonly<Record<string, (p: DateParts) => string>> = {
  YYYY: (p) => year4(p.year),
  YY: (p) => pad(Math.abs(p.year) % 100, 2),
  Q: (p) => String(Math.ceil(p.month / 3)),
  M: (p) => String(p.month),
  MM: (p) => pad(p.month, 2),
  MMM: (p) => MONTHS[p.month - 1]!.slice(0, 3),
  MMMM: (p) => MONTHS[p.month - 1]!,
  D: (p) => String(p.day),
  DD: (p) => pad(p.day, 2),
  Do: (p) => ordinal(p.day),
  DDD: (p) => String(dayOfYear(p)),
  DDDD: (p) => pad(dayOfYear(p), 3),
  d: (p) => String(p.weekday),
  dd: (p) => WEEKDAYS[p.weekday]!.slice(0, 2),
  ddd: (p) => WEEKDAYS[p.weekday]!.slice(0, 3),
  dddd: (p) => WEEKDAYS[p.weekday]!,
  E: (p) => String(p.weekday === 0 ? 7 : p.weekday),
  W: (p) => String(weekOfYear(p, ISO.dow, ISO.doy).week),
  WW: (p) => pad(weekOfYear(p, ISO.dow, ISO.doy).week, 2),
  GGGG: (p) => year4(weekOfYear(p, ISO.dow, ISO.doy).year),
  GG: (p) => pad(Math.abs(weekOfYear(p, ISO.dow, ISO.doy).year) % 100, 2),
  w: (p) => String(weekOfYear(p, EN.dow, EN.doy).week),
  ww: (p) => pad(weekOfYear(p, EN.dow, EN.doy).week, 2),
  gggg: (p) => year4(weekOfYear(p, EN.dow, EN.doy).year),
  H: (p) => String(p.hour),
  HH: (p) => pad(p.hour, 2),
  h: (p) => String(p.hour % 12 || 12),
  hh: (p) => pad(p.hour % 12 || 12, 2),
  k: (p) => String(p.hour || 24),
  kk: (p) => pad(p.hour || 24, 2),
  m: (p) => String(p.minute),
  mm: (p) => pad(p.minute, 2),
  s: (p) => String(p.second),
  ss: (p) => pad(p.second, 2),
  A: (p) => (p.hour < 12 ? 'AM' : 'PM'),
  a: (p) => (p.hour < 12 ? 'am' : 'pm'),
  X: (p) => String(Math.floor(p.epochMs / 1000)),
  x: (p) => String(p.epochMs),
};

/** moment's own token grammar (so an unsupported token is named whole, like
 *  `Mo` or `SSS`, not as its first letter), then any single character. */
const TOKEN_RE =
  /\[[^[]*\]|\\[\s\S]|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[ow]?|W[oW]?|Qo?|N{1,5}|YYYYYY|YYYYY|YYYY|YY|y{2,4}|yo?|gg(?:ggg?)?|GG(?:GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|[\s\S]/g;

/** Format parts with a moment format, or name the first unsupported token. */
export function formatVaultDate(parts: DateParts, fmt: string): VaultDateFormatResult {
  let out = '';
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(fmt); m; m = TOKEN_RE.exec(fmt)) {
    const tok = m[0];
    if (tok.length > 1 && tok.startsWith('[') && tok.endsWith(']')) {
      out += tok.slice(1, -1);
      continue;
    }
    if (tok.length === 2 && tok.startsWith('\\')) {
      out += tok[1];
      continue;
    }
    const fn = TOKENS[tok];
    if (fn) out += fn(parts);
    else if (/[A-Za-z]/.test(tok)) return { ok: false, token: tok };
    else out += tok;
  }
  return { ok: true, text: out };
}

/** The daily note's path for the day, `folder/<formatted>.md`, checked by
 *  `checkNewNoteName`. A `/` in the format makes folders. An unsupported
 *  token refuses with no suggestion, since any name would be a guess. */
export function dailyNotePath(parts: DateParts, cfg: DailyNoteConfig): NewNoteNameCheck {
  const format = cfg.format.trim() || VAULT_DAILY_DEFAULTS.format;
  const r = formatVaultDate(parts, format);
  if (!r.ok) {
    return {
      ok: false,
      error: `The daily note format uses "${r.token}", which the Vault cannot read yet, so it did not guess a name.`,
    };
  }
  const folder = cfg.folder
    .trim()
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
  const name = r.text.replace(/\.md$/i, '');
  return checkNewNoteName(folder ? `${folder}/${name}` : name);
}

/** `{{date}}`, `{{time}}`, `{{title}}`, `{{date:FMT}}`, `{{time:FMT}}`, with
 *  the name in any case and spaces allowed inside the braces (a format is
 *  trimmed). */
const TEMPLATE_RE = /\{\{\s*(date|time|title)\s*(?::([^}]*?))?\s*\}\}/gi;

/** Fill a template's `{{date}}`, `{{time}}`, `{{title}}`, `{{date:FMT}}` and
 *  `{{time:FMT}}`; every other byte stays. A variable whose format has an
 *  unsupported token is left as written, never guessed. */
export function fillTemplate(text: string, fill: TemplateFill): string {
  return text.replace(TEMPLATE_RE, (whole, name: string, fmt: string | undefined) => {
    const key = name.toLowerCase();
    if (key === 'title') return fmt === undefined ? fill.title : whole;
    const own = fmt?.trim();
    const use = own
      ? own
      : key === 'date'
        ? fill.dateFormat || VAULT_DAILY_DEFAULTS.format
        : fill.timeFormat || VAULT_DAILY_DEFAULTS.timeFormat;
    const r = formatVaultDate(fill.parts, use);
    return r.ok ? r.text : whole;
  });
}
