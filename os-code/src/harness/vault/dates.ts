// Today's note (Vault M6, CTO K7): the host's local clock split into parts,
// Obsidian's moment tokens (`YYYY YY Q M MM MMM MMMM D DD Do DDD DDDD d dd ddd
// dddd E W WW GGGG GG w ww gggg H HH h hh k kk m mm s ss A a X x` and
// `[literal]`; `/` makes folders; English names only), the daily note's path,
// and a template's variables. Any other letter outside brackets refuses the
// format by name.
//
// Wave 0 stub: the signatures are the contract; stream A2 builds the bodies.
// Pure and import-free past the vault core.

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

function notBuilt(name: string): never {
  throw new Error(`not built: ${name} (Vault M6, stream A2)`);
}

/** Split a moment on the host's local clock. */
export function datePartsOf(_d: Date): DateParts {
  return notBuilt('datePartsOf');
}

/** Format parts with a moment format, or name the first unsupported token. */
export function formatVaultDate(_parts: DateParts, _fmt: string): VaultDateFormatResult {
  return notBuilt('formatVaultDate');
}

/** The daily note's path for the day, checked by `checkNewNoteName`. */
export function dailyNotePath(_parts: DateParts, _cfg: DailyNoteConfig): NewNoteNameCheck {
  return notBuilt('dailyNotePath');
}

/** Fill a template's `{{date}}`, `{{time}}`, `{{title}}`, `{{date:FMT}}` and
 *  `{{time:FMT}}`; every other byte stays. */
export function fillTemplate(_text: string, _fill: TemplateFill): string {
  return notBuilt('fillTemplate');
}
