// A note taken to a model from the composer (Vault M5, CTO J15): the `[[`
// picker and "Ask about this note" insert a trimmed excerpt with a cost line.
// Pure: the store hands in the notes, the privacy judge and the seat, and the
// composer (stream I) renders what comes back.
//
// The picker never lists a hidden note. A local-only note lists with a lock
// and is refused while the seat leaves the network (D5 has no person override
// in v1). "Recently from your agent" is the five newest notes tagged `crew`
// plus the device ring of paths the agent's approved writes named.
import { oscodeMarks, readFrontmatter, scanNote } from 'os-code/protocol';
import type { OscodeMark, VaultPrivacy, VaultVisibility } from 'os-code/protocol';

/** The note the excerpt is taken from. */
export interface ExcerptNote {
  path: string;
  title: string;
  text: string;
  /** ISO 8601, for "(updated <date>)". */
  updatedAt: string;
}

/** A rendered excerpt. */
export interface ComposerExcerpt {
  /** `From my note [[Title]] (updated <date>):` then the quoted excerpt. */
  text: string;
  /** `Math.ceil(text.length / 4)`. */
  tokens: number;
  /** True when the note was cut to fit. */
  trimmed: boolean;
}

/** The most an excerpt may take, whatever the seat. */
export const EXCERPT_MAX_TOKENS = 2000;
/** The share of the served window an excerpt may take. */
export const EXCERPT_WINDOW_FRACTION = 0.25;
/** The cap on a device seat. */
export const EXCERPT_DEVICE_TOKENS = 1024;

/** The line that closes an excerpt cut to fit. */
export const EXCERPT_TRIMMED_LINE = '(Trimmed to fit this model.)';

/** The refusal for a local-only note while the seat leaves the network. */
export const EXCERPT_LOCAL_ONLY_REFUSAL =
  'Private notes stay on this computer. Switch to a local model to ask about it.';

/** The excerpt's budget: `min(2000, floor(served * 0.25))`, 1024 on a device
 *  seat. */
export function composerExcerptBudget(served: number, device: boolean): number {
  if (device) return EXCERPT_DEVICE_TOKENS;
  if (!Number.isFinite(served) || served <= 0) return 0;
  return Math.min(EXCERPT_MAX_TOKENS, Math.floor(served * EXCERPT_WINDOW_FRACTION));
}

const tokensOf = (text: string) => Math.ceil(text.length / 4);

/** The body of a note without its frontmatter block. */
export function stripFrontmatter(text: string): string {
  const src = text.replace(/^\uFEFF/, '');
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
  return (m ? src.slice(m[0].length) : src).replace(/\r\n/g, '\n');
}

/** YYYY-MM-DD from an ISO time, or undefined when it is not one. */
function isoDate(iso: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : iso.slice(0, 10);
}

function quote(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
}

/** Where a cut of `body` to at most `max` characters falls: a paragraph
 *  break, else a line break, else a space, when one sits in the latter half. */
function cutPoint(body: string, max: number): number {
  if (max <= 0) return 0;
  const head = body.slice(0, max);
  for (const sep of ['\n\n', '\n', ' ']) {
    const at = head.lastIndexOf(sep);
    if (at >= max / 2) return at;
  }
  return max;
}

/** The excerpt for a note within `budgetTokens`. Frontmatter is dropped;
 *  the cut falls on a paragraph or line where it can. */
export function composerExcerpt(note: ExcerptNote, budgetTokens: number): ComposerExcerpt {
  const date = isoDate(note.updatedAt);
  const title = note.title.trim() || note.path.replace(/\.md$/i, '').split('/').pop() || note.path;
  const header = `From my note [[${title}]]${date ? ` (updated ${date})` : ''}:`;
  const body = stripFrontmatter(note.text).trim();
  const whole = body ? `${header}\n${quote(body)}` : header;
  const limit = Math.max(0, Math.floor(budgetTokens)) * 4;
  if (whole.length <= limit) return { text: whole, tokens: tokensOf(whole), trimmed: false };
  // Cut the body so the quoted lines, the header and the closing line fit.
  // Quoting adds characters per line, so shrink until it does.
  const tail = `\n${EXCERPT_TRIMMED_LINE}`;
  let room = limit - header.length - tail.length - 1;
  let text = `${header}${tail}`;
  for (let tries = 0; tries < 8 && room > 0; tries++) {
    const cut = body.slice(0, cutPoint(body, room)).trimEnd();
    const candidate = cut ? `${header}\n${quote(cut)}${tail}` : `${header}${tail}`;
    if (candidate.length <= limit) {
      text = candidate;
      break;
    }
    room -= candidate.length - limit + 8;
  }
  return { text, tokens: tokensOf(text), trimmed: true };
}

/** A count as a person reads it: exact under 100, else to the nearest ten. */
function approx(n: number): string {
  const v = n < 100 ? n : Math.round(n / 10) * 10;
  return v.toLocaleString('en-US');
}

/** The cost line under an excerpt, in words a person uses (CX, jargon
 *  rewrites): the share of the model's room it takes, "Takes about 9% of
 *  this model's room", or, when that room is not known, its length, "About
 *  280 words" (counted from the text when there is one). */
export function excerptCostLine(tokens: number, served: number, text?: string): string {
  if (!Number.isFinite(served) || served <= 0) {
    // Without the text, about three words to every four tokens.
    const words = text
      ? text.split(/\s+/).filter(Boolean).length
      : Math.round(Math.max(0, tokens) * 0.75);
    return `About ${approx(words)} ${words === 1 ? 'word' : 'words'}`;
  }
  const pct = (Math.max(0, tokens) / served) * 100;
  return pct < 1
    ? "Takes under 1% of this model's room"
    : `Takes about ${Math.round(pct)}% of this model's room`;
}

// ---- What the composer (stream I) reads, through props ---------------------

/** The seat the next send goes to, as the composer needs it. */
export interface ComposerSeat {
  /** Its served window, in tokens. */
  servedTokens: number;
  /** A model on this device (the 1024 excerpt cap). */
  device: boolean;
  /** It leaves this network: a local-only note is refused. */
  leavesNetwork: boolean;
}

/** One row the `[[` picker (and the pin sheet) may show. */
export interface VaultPickerNote {
  path: string;
  title: string;
  updatedAt: string;
  /** Stays on this computer: shown with a lock, refused on a leaving seat. */
  localOnly: boolean;
}

/** What the index knows about a note, or what a listing gives. */
export interface VaultNoteFacts {
  path: string;
  title?: string;
  updatedAt: string;
  tags?: readonly string[];
  oscode?: readonly OscodeMark[];
}

/** A note's privacy facts from its own text (its tags, frontmatter and
 *  inline, and its `oscode:` marks), the way the index reads them, for a
 *  note the index has not seen yet. */
export function noteFactsFromText(path: string, text: string, updatedAt: string): VaultNoteFacts {
  const fm = readFrontmatter(text);
  const scan = scanNote(text);
  const marks = oscodeMarks(fm);
  return {
    path,
    updatedAt,
    tags: [...fm.tags, ...scan.tags.map((t) => t.tag)],
    ...(marks.length ? { oscode: marks } : {}),
  };
}

const titleFromPath = (path: string) => path.replace(/\.md$/i, '').split('/').pop() || path;

/** The picker's rows: hidden notes never list; local-only notes carry the
 *  lock. Newest first, then by title. */
export function pickerNotes(
  notes: readonly VaultNoteFacts[],
  privacy: VaultPrivacy,
): VaultPickerNote[] {
  const out: VaultPickerNote[] = [];
  for (const n of notes) {
    const v: VaultVisibility = privacy.visibility({ path: n.path, tags: n.tags, oscode: n.oscode });
    if (v === 'hidden') continue;
    out.push({
      path: n.path,
      title: n.title?.trim() || titleFromPath(n.path),
      updatedAt: n.updatedAt,
      localOnly: v === 'local-only',
    });
  }
  return out.sort((a, b) =>
    a.updatedAt === b.updatedAt
      ? a.title.localeCompare(b.title)
      : a.updatedAt < b.updatedAt
        ? 1
        : -1,
  );
}

/** Whether a note may go into the composer for this seat, and why not. */
export function excerptAllowed(
  note: Pick<VaultPickerNote, 'localOnly'>,
  seat: Pick<ComposerSeat, 'leavesNetwork'>,
): { ok: true } | { ok: false; reason: string } {
  return note.localOnly && seat.leavesNetwork
    ? { ok: false, reason: EXCERPT_LOCAL_ONLY_REFUSAL }
    : { ok: true };
}

/** What the store answers for one excerpt. */
export type ComposerExcerptResult =
  { ok: true; excerpt: ComposerExcerpt; costLine: string } | { ok: false; reason: string };

/** The excerpt, its cost line, or the refusal, for one seat. */
export function excerptForSeat(
  note: ExcerptNote & { localOnly: boolean },
  seat: ComposerSeat,
): ComposerExcerptResult {
  const allowed = excerptAllowed(note, seat);
  if (!allowed.ok) return allowed;
  const excerpt = composerExcerpt(note, composerExcerptBudget(seat.servedTokens, seat.device));
  return { ok: true, excerpt, costLine: excerptCostLine(excerpt.tokens, seat.servedTokens) };
}

// ---- Recently from your agent ------------------------------------------------

/** How many agent-written paths the device remembers (J15). */
export const AGENT_RECENT_RING = 20;
/** How many `crew`-tagged notes the row takes from the index. */
export const AGENT_RECENT_CREW = 5;

/** Put a path at the front of the ring, once, capped. */
export function pushAgentRecent(ring: readonly string[], path: string): string[] {
  return [path, ...ring.filter((p) => p !== path)].slice(0, AGENT_RECENT_RING);
}

/** The row's notes: the five newest tagged `crew` and every ring path the
 *  vault still holds, hidden notes left out, newest first, each once. */
export function agentRecentNotes(
  notes: readonly VaultNoteFacts[],
  ring: readonly string[],
  privacy: VaultPrivacy,
): VaultPickerNote[] {
  const byPath = new Map(notes.map((n) => [n.path, n] as const));
  const crew = notes
    .filter((n) => (n.tags ?? []).some((t) => t.replace(/^#/, '').toLowerCase() === 'crew'))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, AGENT_RECENT_CREW);
  const picked = new Map<string, VaultNoteFacts>();
  for (const n of crew) picked.set(n.path, n);
  for (const p of ring) {
    const n = byPath.get(p);
    if (n && !picked.has(p)) picked.set(p, n);
  }
  return pickerNotes([...picked.values()], privacy);
}
