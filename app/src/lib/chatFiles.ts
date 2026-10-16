// Chats as files (folder and sync plan, M3; founder, 2026-10-16): each chat is
// also one markdown file in OpenShore/Chats on this device, filed by the month
// it started, so the person can open, search and keep their chats like any
// other file. A Settings switch, Save chats as files, on by default.
//
// The sealed store stays the source of truth. These files are a mirror the app
// keeps: written when a turn settles, moved on a rename, removed with the
// chat, and never read back into the app. Editing a file changes nothing in
// OpenShore, and the next settled turn writes the file again.
//
// This module is pure (no platform, no store): it decides the file's path and
// renders a conversation to markdown. The writers per platform are in
// chatFileWriters.ts; the store's wiring is state/chatFileOps.ts.
//
// What a file holds: a small front matter (id, title, created, updated, the
// models that answered, the project), then each spoken turn under its
// speaker's heading, with code fences kept whole. Never a model's thinking
// (Chain of Thought is never copied into history), never an attachment's
// bytes (only its name), and a tool step or a command in one line.
import type { Conversation, ThreadItem } from '../state/types.js';
import type { Platform } from './platform.js';
import { thisDeviceNoun } from './deviceNoun.js';

/** The section folder's name, under OpenShore on every device. */
export const CHATS_FOLDER = 'Chats';

/** How many characters of the title the file name keeps. */
export const CHAT_SLUG_MAX = 60;

/** The most a file may hold. A chat longer than this keeps its newest turns
 *  and says so at the top; the chat itself is untouched. */
export const CHAT_FILE_MAX_CHARS = 4 * 1024 * 1024;

/** Whether this device saves chats as files: on unless turned off. */
export function chatFilesOn(settings: { chatFiles?: boolean }): boolean {
  return settings.chatFiles !== false;
}

/** Where Save chats as files puts them, said for the device in hand, or
 *  undefined where no files are written (a plain browser). */
export function chatFilesWhere(on: Platform): string | undefined {
  if (on === 'electron') return 'In OpenShore/Chats on this computer, one markdown file per chat.';
  if (on === 'ios') return `In OpenShore/Chats on ${thisDeviceNoun()}, open in the Files app.`;
  return undefined;
}

/** The privacy page's plain words about the files, for the device in hand,
 *  or undefined where none are written. They are not sealed, and on a
 *  computer any program the person runs can read them (the plan's risk). */
export function chatFilesPrivacyLine(on: Platform): string | undefined {
  const lead =
    'With Save chats as files on, as it is unless you turn it off in Settings, Chats, each chat is also a plain markdown file in OpenShore/Chats on';
  if (on === 'electron') {
    return `${lead} this computer. Those files are not sealed: any program you run on this computer can read them.`;
  }
  if (on === 'ios') {
    return `${lead} ${thisDeviceNoun()}. Those files are not sealed: you can open them in the Files app. They are kept out of iCloud Backup unless you include them in Settings, Chats.`;
  }
  return undefined;
}

// Names Windows reserves for devices, with or without an extension. A slug is
// always followed by the id here, so the stem is never bare; the check stays
// so a name is safe on its own too.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** The title as a file-name slug, safe on Windows, macOS, iOS and Linux:
 *  letters and digits in any script, lowercased, everything else one dash,
 *  at most CHAT_SLUG_MAX characters, never a reserved device name, and
 *  "chat" when nothing is left. */
export function chatSlug(title: string): string {
  const cleaned = (title ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // Bound by characters (code points), never by UTF-16 units, so no letter is
  // cut in half.
  let slug = Array.from(cleaned).slice(0, CHAT_SLUG_MAX).join('').replace(/-+$/, '');
  if (!slug) slug = 'chat';
  if (WINDOWS_RESERVED.test(slug)) slug = `${slug}-chat`;
  return slug;
}

/** The id's first eight characters, as a file name may carry them. */
export function chatIdTag(id: string): string {
  const tag = (id ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return tag || 'chat';
}

/** The month a chat started, YYYY-MM, read from its ISO creation time (UTC),
 *  so the folder is the same on every device whatever its time zone. */
export function chatMonth(createdAt: string): string {
  const t = Date.parse(createdAt);
  const d = Number.isNaN(t) ? new Date(0) : new Date(t);
  return d.toISOString().slice(0, 7);
}

/** The file's path inside Chats: `YYYY-MM/<slug>-<id8>.md`. */
export function chatFilePath(conv: Pick<Conversation, 'id' | 'title' | 'createdAt'>): string {
  return `${chatMonth(conv.createdAt)}/${chatSlug(conv.title)}-${chatIdTag(conv.id)}.md`;
}

const REL_SHAPE = /^\d{4}-(0[1-9]|1[0-2])\/[^/\\]+\.md$/;

/** Whether `rel` is a path this mirror writes: a month folder and one .md
 *  file in it, no dot name, no separator other than the one slash, nothing
 *  Windows cannot hold. The desktop's main process holds the same rule. */
export function isChatFileRel(rel: unknown): rel is string {
  if (typeof rel !== 'string' || rel.length > 200 || !REL_SHAPE.test(rel)) return false;
  const name = rel.slice(8);
  if (name.startsWith('.')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f:*?"<>|]/.test(name)) return false;
  return !WINDOWS_RESERVED.test(name.split('.')[0]!);
}

/** Whether a file name in a month folder belongs to this chat id. */
export function fileIsForChat(name: string, id: string): boolean {
  return name.endsWith(`-${chatIdTag(id)}.md`);
}

/** Whether a conversation is ready to be written: no turn in flight, nothing
 *  streaming, something said, and, for a chat whose transcript lives in the
 *  engine's journal, the whole of it in hand (a read-only snapshot holds
 *  only the newest turns, and must never overwrite the full file). */
export function chatReadyToMirror(conv: Conversation, snapshotItems: number): boolean {
  const t = conv.thread;
  if (t.busy) return false;
  if (!t.items.some((i) => i.kind === 'user' || i.kind === 'assistant')) return false;
  if (t.items.some((i) => (i.kind === 'assistant' || i.kind === 'thinking') && i.streaming)) {
    return false;
  }
  if (conv.source.kind === 'desktop' && t.lastSeq <= 0 && t.items.length >= snapshotItems) {
    return false;
  }
  return true;
}

/** A cheap fingerprint of what the file would say, so an unchanged chat is
 *  not written again. */
export function chatStamp(conv: Conversation, projectName?: string): string {
  const items = conv.thread.items;
  const last = items[items.length - 1];
  const lastLen = last && 'text' in last && typeof last.text === 'string' ? last.text.length : 0;
  return [
    conv.title,
    conv.updatedAt,
    items.length,
    last?.id ?? '',
    lastLen,
    projectName ?? '',
  ].join('|');
}

function sourceModel(conv: Conversation): string | undefined {
  const s = conv.source;
  if (s.kind === 'device') return s.modelName || s.modelId;
  if (s.kind === 'cloud') return s.model;
  if (s.kind === 'desktop-chat') return s.model;
  return undefined;
}

/** The models that answered in this chat, in the order they first spoke. */
export function chatModels(conv: Conversation): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (m?: string) => {
    const name = m?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  for (const item of conv.thread.items) if (item.kind === 'assistant') add(item.model);
  add(conv.thread.model?.name);
  if (!out.length) add(sourceModel(conv));
  return out;
}

/** A YAML scalar, double quoted. JSON's string escapes are YAML's too. */
function yamlString(s: string): string {
  return JSON.stringify(s);
}

/** One line of plain text: whitespace folded, bounded. */
function oneLine(s: string, max = 200): string {
  const line = (s ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/** An inline code span that holds `s` whatever backticks it contains. */
function inlineCode(s: string): string {
  const runs = s.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}`;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A message's text with every code fence it opens closed again, so one
 *  unclosed fence never swallows the turns after it. */
export function closeFences(text: string): string {
  let open: string | undefined;
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line);
    if (!m) continue;
    const run = m[1]!;
    if (!open) {
      open = run;
    } else if (run[0] === open[0] && run.length >= open.length && line.trim() === run) {
      open = undefined;
    }
  }
  return open ? `${text.replace(/\n*$/, '')}\n${open}` : text;
}

/** A reply's text with any reasoning a model sent in-line left out. */
function withoutThinking(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?(<\/think>|$)\s*/i, '');
}

type Item = ThreadItem;

function turnBody(text: string): string {
  return closeFences(text.replace(/\r\n?/g, '\n')).replace(/\n+$/, '');
}

function renderItem(item: Item, conv: Conversation): string | undefined {
  switch (item.kind) {
    case 'user': {
      if (item.withheld) {
        return '> A message here was held back by the ethical boundaries and was not sent.';
      }
      const names = item.attachments?.length
        ? `\n\n_Attached: ${item.attachments.map((n) => oneLine(n, 120)).join(', ')}_`
        : '';
      return `### You\n\n${turnBody(item.text)}${names}`;
    }
    case 'assistant': {
      const text = withoutThinking(item.text);
      if (!text.trim()) return undefined;
      const who = item.model || conv.thread.model?.name || sourceModel(conv) || 'Assistant';
      return `### ${oneLine(who, 80)}\n\n${turnBody(text)}`;
    }
    case 'plan':
      return `### Plan\n\n${turnBody(item.text)}`;
    case 'tool': {
      const state =
        item.state === 'fail' ? ', failed' : item.state === 'denied' ? ', not allowed' : '';
      const what = item.summary ? `: ${oneLine(item.summary)}` : '';
      return `> Tool ${inlineCode(oneLine(item.name, 60))}${what}${state}`;
    }
    case 'command': {
      const exit =
        item.state === 'killed'
          ? ', stopped'
          : typeof item.exitCode === 'number'
            ? `, exit ${item.exitCode}`
            : '';
      return `> Ran ${inlineCode(oneLine(item.command))}${exit}`;
    }
    case 'verify':
      return `> Check ${item.passed ? 'passed' : 'failed'}: ${oneLine(item.summary)}`;
    case 'changed': {
      const names = item.files.slice(0, 10).map((f) => f.path);
      const more = item.files.length > 10 ? `, and ${item.files.length - 10} more` : '';
      const n = item.files.length;
      return `> Changed ${n} ${n === 1 ? 'file' : 'files'}: ${oneLine(names.join(', '))}${more}`;
    }
    case 'stopped':
      return item.byYou ? '> Stopped.' : `> Stopped: ${oneLine(item.message)}`;
    // Thinking is never written (Chain of Thought stays out of history); the
    // rest are the app's own cards, not the conversation.
    default:
      return undefined;
  }
}

export interface ChatFileOptions {
  /** The project the chat belongs to, by name. */
  projectName?: string;
}

/** One conversation as a markdown file. */
export function renderChatMarkdown(conv: Conversation, opts: ChatFileOptions = {}): string {
  const head = ['---', `id: ${yamlString(conv.id)}`, `title: ${yamlString(conv.title)}`];
  head.push(`created: ${yamlString(conv.createdAt)}`, `updated: ${yamlString(conv.updatedAt)}`);
  const models = chatModels(conv);
  if (models.length) {
    head.push('models:');
    for (const m of models) head.push(`  - ${yamlString(m)}`);
  }
  if (opts.projectName) head.push(`project: ${yamlString(opts.projectName)}`);
  head.push('---', '');

  const title = oneLine(conv.title, 200) || 'Chat';
  const parts: string[] = [];
  for (const item of conv.thread.items) {
    const block = renderItem(item, conv);
    if (block) parts.push(block);
  }
  // A very long chat keeps its newest turns, whole.
  let dropped = 0;
  let size = parts.reduce((n, p) => n + p.length + 2, 0);
  while (size > CHAT_FILE_MAX_CHARS && parts.length > 1) {
    size -= parts.shift()!.length + 2;
    dropped++;
  }
  const lead = dropped
    ? [`_This file keeps the newest turns; ${dropped} earlier ones are left out._`, '']
    : [];
  return [...head, `# ${title}`, '', ...lead, parts.join('\n\n'), ''].join('\n');
}

/** Record the names of the files sent with the newest message (never their
 *  bytes), on the last user item whose words match and that has none yet. */
export function nameAttachments(items: ThreadItem[], text: string, names: string[]): ThreadItem[] {
  if (!names.length) return items;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== 'user') continue;
    if (item.text !== text || item.attachments?.length) return items;
    const next = items.slice();
    next[i] = { ...item, attachments: names.slice(0, 20) };
    return next;
  }
  return items;
}
