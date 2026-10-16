// Where chat files are written, one small interface per platform (folder and
// sync plan, M3). Paths are always inside Chats, `YYYY-MM/<name>.md`
// (lib/chatFiles.ts isChatFileRel), and every writer checks that before it
// touches anything.
//
// - iPhone and iPad: the app's own Documents, OpenShore/Chats, through
//   @capacitor/filesystem, so the person finds them in the Files app (On My
//   iPhone or iPad, OpenShore).
// - The desktop: ~/OpenShore/Chats, through main's guarded osc:chatFile*
//   channels, which jail every path to that folder.
// - A plain browser (the dev shell): none, so nothing is written.
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { bridge } from './electronBridge.js';
import { platform } from './platform.js';
import { CHATS_FOLDER, isChatFileRel } from './chatFiles.js';

export interface ChatFileEntry {
  name: string;
  mtimeMs: number;
}

export interface ChatFileWriter {
  write(path: string, text: string): Promise<void>;
  /** Remove a file; a file that is not there is no error. */
  remove(path: string): Promise<void>;
  /** The files in one month folder (`YYYY-MM`); empty when it is not there. */
  list(month: string): Promise<ChatFileEntry[]>;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function checked(path: string): string {
  if (!isChatFileRel(path)) throw new Error('not a chat file path');
  return path;
}

/** The phone's writer: Documents/OpenShore/Chats. */
export const phoneChatWriter: ChatFileWriter = {
  async write(path, text) {
    await Filesystem.writeFile({
      path: `OpenShore/${CHATS_FOLDER}/${checked(path)}`,
      data: text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  },
  async remove(path) {
    try {
      await Filesystem.deleteFile({
        path: `OpenShore/${CHATS_FOLDER}/${checked(path)}`,
        directory: Directory.Documents,
      });
    } catch (err) {
      if (!isChatFileRel(path)) throw err;
      // Not there (removed by hand, never written): nothing to do.
    }
  },
  async list(month) {
    if (!MONTH.test(month)) return [];
    try {
      const { files } = await Filesystem.readdir({
        path: `OpenShore/${CHATS_FOLDER}/${month}`,
        directory: Directory.Documents,
      });
      return files
        .filter((f) => f.type === 'file' && f.name.endsWith('.md'))
        .map((f) => ({ name: f.name, mtimeMs: Number(f.mtime) || 0 }));
    } catch {
      return [];
    }
  },
};

/** The desktop's writer, through main. Undefined on a desktop build too old to
 *  have the channels. */
export function desktopChatWriter(): ChatFileWriter | undefined {
  const b = bridge();
  if (!b?.chatFileWrite || !b.chatFileRemove || !b.chatFileList) return undefined;
  const { chatFileWrite, chatFileRemove, chatFileList } = b;
  return {
    write: (path, text) => chatFileWrite(checked(path), text),
    remove: async (path) => {
      await chatFileRemove(checked(path));
    },
    list: (month) => (MONTH.test(month) ? chatFileList(month) : Promise.resolve([])),
  };
}

/** The writer for the platform this runs on, or undefined where chats are
 *  not written as files (a plain browser). */
export function chatFileWriter(): ChatFileWriter | undefined {
  const p = platform();
  if (p === 'ios') return phoneChatWriter;
  if (p === 'electron') return desktopChatWriter();
  return undefined;
}
