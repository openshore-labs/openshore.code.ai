// Chats as files on the desktop (folder and sync plan, M3): main's file work
// for the osc:chatFile* channels, kept free of Electron so the tests pin it as
// main runs it. The renderer is untrusted input (UI-6), so every path is
// checked here before anything is touched:
// - its shape is exactly `YYYY-MM/<name>.md` (one month folder, one markdown
//   file, no dot name, nothing Windows cannot hold, at most 200 characters),
//   the same rule as the app's lib/chatFiles.ts isChatFileRel;
// - it resolves inside the Chats folder through every link on the way (the
//   engine's jail rule, deepestRealpath), so a month folder linked elsewhere
//   is refused, and a file that is itself a link is never written through;
// - a write is capped and lands temp then rename, so a crash never leaves
//   half a file.
// The root is always main's own, sectionDir('chats'), never the renderer's.
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { deepestRealpath } from 'os-code/dist/src/core/security/jail.js';
import { windowsCanHold } from 'os-code/dist/src/harness/vault/paths.js';

/** The most one chat file may hold, in bytes. */
export const CHAT_FILE_MAX_BYTES = 8 * 1024 * 1024;
/** The most names one month's listing returns. */
export const CHAT_LIST_MAX = 5000;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const REL_SHAPE = /^\d{4}-(0[1-9]|1[0-2])\/[^/\\]+\.md$/;

/** Whether `rel` is a chat file path main accepts. */
export function isChatFileRel(rel: unknown): rel is string {
  if (typeof rel !== 'string' || rel.length > 200 || !REL_SHAPE.test(rel)) return false;
  const name = rel.slice(8);
  if (name.startsWith('.')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return false;
  return windowsCanHold(rel);
}

function realRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}

function inside(rootReal: string, abs: string): boolean {
  const rel = relative(rootReal, deepestRealpath(resolve(abs)));
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** The absolute path of a chat file in `root`, or a refusal. */
export function chatFileAbs(root: string, rel: unknown): string {
  if (!isChatFileRel(rel)) {
    throw new Error('blocked: only a chat file (YYYY-MM/<name>.md) crosses this bridge');
  }
  const abs = join(root, ...rel.split('/'));
  if (!inside(realRoot(root), abs)) throw new Error('blocked: that path leaves the Chats folder');
  return abs;
}

function isMissing(err: unknown): boolean {
  return (err as { code?: string })?.code === 'ENOENT';
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Write one chat file: the month folder made if needed, the path checked
 *  again once it exists, a link never written through, temp then rename. */
export async function writeChatFile(root: string, rel: unknown, text: unknown): Promise<void> {
  if (typeof text !== 'string') throw new Error('blocked: text must be a string');
  if (Buffer.byteLength(text, 'utf8') > CHAT_FILE_MAX_BYTES) {
    throw new Error('blocked: that chat file is too large');
  }
  if (!isChatFileRel(rel)) chatFileAbs(root, rel);
  await mkdir(root, { recursive: true });
  const abs = chatFileAbs(root, rel);
  // The month folder exists only after this, so the jail is asked again: a
  // month folder that is a link out of Chats is refused here.
  if (!inside(realRoot(root), dirname(abs))) {
    throw new Error('blocked: that path leaves the Chats folder');
  }
  await mkdir(dirname(abs), { recursive: true });
  const parent = await lstat(dirname(abs));
  if (!parent.isDirectory() || !inside(realRoot(root), abs)) {
    throw new Error('blocked: that path leaves the Chats folder');
  }
  try {
    const st = await lstat(abs);
    if (!st.isFile()) throw new Error('blocked: only a plain file is written');
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  const temp = join(dirname(abs), `.chat-${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temp, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temp, abs);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Remove one chat file; false when it was not there. Never a folder. */
export async function removeChatFile(root: string, rel: unknown): Promise<boolean> {
  if (isChatFileRel(rel) && !(await exists(root))) return false;
  const abs = chatFileAbs(root, rel);
  let st;
  try {
    st = await lstat(abs);
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
  if (st.isDirectory()) throw new Error('blocked: only a chat file is removed');
  await rm(abs, { force: true });
  return true;
}

/** The markdown files in one month folder, with their modified times. Links
 *  and folders are left out; a month folder that is not there lists empty. */
export async function listChatMonth(
  root: string,
  month: unknown,
): Promise<Array<{ name: string; mtimeMs: number }>> {
  if (typeof month !== 'string' || !MONTH.test(month)) {
    throw new Error('blocked: month must be YYYY-MM');
  }
  if (!(await exists(root))) return [];
  const dir = join(root, month);
  if (!inside(realRoot(root), dir)) throw new Error('blocked: that path leaves the Chats folder');
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const out: Array<{ name: string; mtimeMs: number }> = [];
  for (const e of entries) {
    if (out.length >= CHAT_LIST_MAX) break;
    if (!e.isFile() || !e.name.endsWith('.md') || e.name.startsWith('.')) continue;
    try {
      const st = await lstat(join(dir, e.name));
      out.push({ name: e.name, mtimeMs: st.mtimeMs });
    } catch {
      // Gone between the listing and the stat.
    }
  }
  return out;
}
