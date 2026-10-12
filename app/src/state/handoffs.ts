// The app's half of the handoff (Vault M5, tech review J11 to J13): the adapter from
// a chat's transcript to the core's `HandoffTurn`s, the seed a model switch
// hands the new seat, the honest switch note, and the device store
// `oscode.handoffs.v1` a switch and a left chat write per project.
//
// Pure, except the store helpers, which take their storage as arguments. The
// handoff itself is the one core (`buildHandoff`, `fitSeed` from
// os-code/protocol), so the engine and the app extract the same way.
//
// Never thinking: thinking items are dropped and every assistant turn runs
// through `splitThinkTags` before it becomes a turn (the Chain of Thought
// rule). A reply that drew on a local-only note never rides a handoff.
import {
  HANDOFF_MAX_AGE_DAYS,
  HANDOFF_MAX_TOKENS,
  buildHandoff,
  fitSeed,
  handoffBudgetTokens,
  safeNoteName,
  splitThinkTags,
  type Handoff,
  type HandoffTurn,
} from 'os-code/protocol';
import { estimateTokens } from '../drivers/deviceModel.js';
import { clarifyText, seedEntries, type SeedTurn, type ThreadItem } from './types.js';

/** The device store key (J13): latest handoff per project id. */
export const HANDOFFS_KEY = 'oscode.handoffs.v1';

/** The folder "Save to Vault" writes into (J12). */
export const HANDOFF_NOTE_FOLDER = 'Handoffs';

/** The transcript as the handoff reads it. Withheld messages (and what
 *  answered them), thinking, and local-only replies stay out; a tool card is a
 *  tool turn naming the path it touched. */
export function threadHandoffTurns(items: readonly ThreadItem[]): HandoffTurn[] {
  const out: HandoffTurn[] = [];
  let withheld = false;
  for (const it of items) {
    if (it.kind === 'user') {
      withheld = Boolean(it.withheld);
      if (!withheld && it.text.trim()) out.push({ role: 'user', text: it.text.trim() });
      continue;
    }
    if (withheld) continue;
    switch (it.kind) {
      case 'assistant': {
        if (it.localOnly) break;
        const text = splitThinkTags(it.text).text.trim();
        if (text) out.push({ role: 'assistant', text });
        break;
      }
      case 'plan':
        if (it.text.trim()) out.push({ role: 'assistant', text: it.text.trim() });
        break;
      case 'clarify':
        out.push({ role: 'assistant', text: clarifyText(it) });
        break;
      case 'tool':
        out.push({
          role: 'tool',
          text: it.summary,
          tool: it.name,
          ...(it.path ? { paths: [it.path] } : {}),
        });
        break;
      case 'changed':
        if (it.files.length) {
          out.push({
            role: 'tool',
            text: `Changed ${it.files.length} ${it.files.length === 1 ? 'file' : 'files'}`,
            tool: 'changed',
            paths: it.files.map((f) => f.path),
          });
        }
        break;
      default:
        // thinking, notes, status lines, cards: execution detail, never content.
        break;
    }
  }
  return out;
}

/** How many spoken turns a transcript holds (the J13 "four or more turns"). */
export function spokenTurns(items: readonly ThreadItem[]): number {
  return seedEntries([...items]).length;
}

/** What a switch hands the new seat. */
export interface SwitchSeedPlan {
  /** The seed for the new driver. */
  seed: SeedTurn[];
  /** The handoff that opens it, when earlier turns had to drop. */
  handoff?: Handoff;
  /** How many seed turns were left out (summarized by the handoff). */
  dropped: number;
}

export interface SwitchSeedInput {
  /** The transcript to carry (without a message about to be resent). */
  items: readonly ThreadItem[];
  /** The target seat's served window, in tokens. */
  servedTokens: number;
  /** The system text the app knows rides with it (standing context). */
  system?: string;
  /** The model that held the chat, for the HANDOFF line. */
  from?: string;
  /** YYYY-MM-DD, passed in: the core has no clock. */
  date: string;
}

/** Room kept for the reply and for the parts of the system prompt the store
 *  cannot see (a driver's own base prompt). Deliberately generous: a seed
 *  that is a little short is harmless, one that overflows loses the question. */
export function switchReserveTokens(servedTokens: number): number {
  const reply = Math.min(1024, Math.floor(servedTokens / 8));
  const base = Math.min(2048, Math.floor(servedTokens / 4));
  return reply + base;
}

/**
 * The J12 seed: when everything fits the target window the seed goes whole and
 * no handoff is made; when turns drop, the handoff (sized by
 * `handoffBudgetTokens(servedTokens)`) covers exactly the turns left out and
 * opens the seed as the user turn, in place of the old "trimmed" opener, and
 * the newest turns that still fit follow it. Deterministic.
 */
export function planSwitchSeed(input: SwitchSeedInput): SwitchSeedPlan {
  const entries = seedEntries([...input.items]);
  const seed: SeedTurn[] = entries.map(({ at: _at, ...turn }) => turn);
  if (seed.length === 0 || !(input.servedTokens > 0)) return { seed, dropped: 0 };
  const messages = seed.map((t) => ({ role: t.role, content: t.text }));
  const base = {
    system: input.system ?? '',
    messages,
    replyTokens: switchReserveTokens(input.servedTokens),
    contextTokens: input.servedTokens,
    estimate: estimateTokens,
  };
  const whole = fitSeed(base);
  if (whole.dropped === 0) return { seed, dropped: 0 };
  const budget = handoffBudgetTokens(input.servedTokens);
  const meta = { ...(input.from ? { from: input.from } : {}), date: input.date };
  // The handoff takes room, so fitting it can drop a turn more; rebuild it to
  // cover what dropped until the two agree (a few rounds at most).
  let dropped = whole.dropped;
  let handoff = buildHandoff(
    threadHandoffTurns(input.items.slice(0, cutAt(entries, dropped))),
    budget,
    meta,
  );
  for (let round = 0; round < 4; round++) {
    const fit = fitSeed({ ...base, handoff: handoff.text });
    if (fit.dropped <= dropped) break;
    dropped = Math.min(fit.dropped, seed.length - 1);
    handoff = buildHandoff(
      threadHandoffTurns(input.items.slice(0, cutAt(entries, dropped))),
      budget,
      meta,
    );
  }
  const kept = seed.slice(dropped);
  const first = kept[0];
  // History never opens on an assistant turn (a chat template expects a user
  // turn first): the handoff is that turn. When the kept window already opens
  // on the person's words, the handoff leads the same turn instead, so no
  // template sees two user turns in a row.
  const opened: SeedTurn[] =
    first && first.role === 'user'
      ? [{ role: 'user', text: `${handoff.text}\n\n${first.text}` }, ...kept.slice(1)]
      : [{ role: 'user', text: handoff.text }, ...kept];
  return { seed: opened, handoff, dropped };
}

/** The transcript index where the kept seed begins, after `dropped` turns. */
function cutAt(entries: ReadonlyArray<{ at: number }>, dropped: number): number {
  return entries[dropped]?.at ?? entries[entries.length - 1]?.at ?? 0;
}

/** A handoff of the whole transcript, for the device store and the desktop
 *  agent's first task (which takes no message history). */
export function wholeHandoff(
  items: readonly ThreadItem[],
  meta: { from?: string; date: string },
  budgetTokens: number = HANDOFF_MAX_TOKENS,
): Handoff {
  return buildHandoff(threadHandoffTurns(items), budgetTokens, meta);
}

/** The switch note, honest about what came along (J12). */
export function switchNoteText(
  label: string,
  plan: { dropped: number; handoff?: Handoff } | undefined,
): string {
  if (!plan) return `Now using ${label}.`;
  if (plan.handoff && plan.dropped > 0) {
    const n = plan.handoff.turns || plan.dropped;
    return `Now using ${label}. Handed over with a summary of ${n} earlier ${n === 1 ? 'turn' : 'turns'}.`;
  }
  return `Now using ${label}. The whole chat came along.`;
}

/** The note a desktop agent opened from a chat leads with (J12). */
export function desktopHandoffNote(label: string, turns: number): string {
  return `Now using ${label}. Handed over with a summary of ${turns} earlier ${turns === 1 ? 'turn' : 'turns'} from your chat.`;
}

/** This device's date as YYYY-MM-DD. */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---- Save to Vault ---------------------------------------------------------

/** The note "Save to Vault" writes: `Handoffs/<YYYY-MM-DD> <project>.md`, with
 *  " 2", " 3" and on for a name already taken (the write is `ifAbsent`). */
export function handoffNotePath(date: string, project: string | undefined, attempt = 1): string {
  const name = safeNoteName(`${date} ${project?.trim() || 'Chat'}`, date);
  return `${HANDOFF_NOTE_FOLDER}/${name}${attempt > 1 ? ` ${attempt}` : ''}.md`;
}

/** The note's body: a title and the handoff as written. */
export function handoffNoteText(h: { text: string; date: string; project?: string }): string {
  const title = `Handoff, ${h.date}${h.project ? `, ${h.project}` : ''}`;
  return `# ${title}\n\n${h.text.trim()}\n`;
}

// ---- The device store (J13) --------------------------------------------------

/** One stored handoff, latest only per project. */
export interface StoredHandoff {
  text: string;
  /** ISO time written. */
  at: string;
  /** The model that held the chat. */
  model?: string;
  turns: number;
  /** The chat it came from, so deleting that chat clears it. */
  conversationId: string;
}

export type HandoffStore = Record<string, StoredHandoff>;

interface Storage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

function asStore(raw: unknown): HandoffStore {
  if (!raw || typeof raw !== 'object') return {};
  const out: HandoffStore = {};
  for (const [k, v] of Object.entries(raw as Record<string, Partial<StoredHandoff>>)) {
    if (
      typeof v?.text === 'string' &&
      typeof v.at === 'string' &&
      typeof v.conversationId === 'string'
    ) {
      out[k] = {
        text: v.text,
        at: v.at,
        turns: typeof v.turns === 'number' ? v.turns : 0,
        conversationId: v.conversationId,
        ...(typeof v.model === 'string' ? { model: v.model } : {}),
      };
    }
  }
  return out;
}

async function edit(storage: Storage, change: (s: HandoffStore) => boolean): Promise<void> {
  const s = asStore(await storage.get(HANDOFFS_KEY).catch(() => undefined));
  if (!change(s)) return;
  if (Object.keys(s).length === 0) await storage.remove(HANDOFFS_KEY);
  else await storage.set(HANDOFFS_KEY, s);
}

/** Keep `entry` as the project's latest handoff. */
export function writeHandoff(
  storage: Storage,
  projectId: string,
  entry: StoredHandoff,
): Promise<void> {
  return edit(storage, (s) => {
    s[projectId] = entry;
    return true;
  });
}

/** Forget handoffs: a project's, every one a chat wrote, or all of them
 *  (Clear conversations, J13). */
export function clearHandoffs(
  storage: Storage,
  by: { projectId: string } | { conversationId: string } | { all: true },
): Promise<void> {
  return edit(storage, (s) => {
    let changed = false;
    for (const [k, v] of Object.entries(s)) {
      if (
        'all' in by ||
        ('projectId' in by ? k === by.projectId : v.conversationId === by.conversationId)
      ) {
        delete s[k];
        changed = true;
      }
    }
    return changed;
  });
}

/** The project's handoff when it is at most `HANDOFF_MAX_AGE_DAYS` old. */
export async function readHandoff(
  storage: Storage,
  projectId: string,
  now: number = Date.now(),
): Promise<StoredHandoff | undefined> {
  const entry = asStore(await storage.get(HANDOFFS_KEY).catch(() => undefined))[projectId];
  return entry && handoffIsFresh(entry, now) ? entry : undefined;
}

export function handoffIsFresh(entry: Pick<StoredHandoff, 'at'>, now: number): boolean {
  const at = Date.parse(entry.at);
  return (
    Number.isFinite(at) &&
    now - at <= HANDOFF_MAX_AGE_DAYS * 24 * 60 * 60 * 1000 &&
    at <= now + 60_000
  );
}
