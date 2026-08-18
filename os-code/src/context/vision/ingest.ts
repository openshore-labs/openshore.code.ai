// Vision ingest: `osc attach-image <path>` and a watched drop folder
// (~/.os-code/inbox/). Anything landing there becomes available to the
// vision path in the next turn; from a phone, scp or Termius file transfer
// into the inbox is the drop.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, watch } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { oscHome } from '../../config/load.js';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export function inboxDir(): string {
  return join(oscHome(), 'inbox');
}

export interface InboxImage {
  path: string;
  name: string;
  addedAt: Date;
}

export function ensureInbox(): string {
  const dir = inboxDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Copy an image into the inbox; returns its inbox path. */
export function attachImage(sourcePath: string): InboxImage {
  const ext = extname(sourcePath).toLowerCase();
  if (!IMAGE_EXT.has(ext)) {
    throw new Error(
      `${sourcePath} is not a supported image (${[...IMAGE_EXT].join(', ')}). Screenshots are usually .png.`,
    );
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`No file at ${sourcePath}. Check the path.`);
  }
  const dir = ensureInbox();
  const name = `${Date.now()}-${basename(sourcePath)}`;
  const dest = join(dir, name);
  copyFileSync(sourcePath, dest);
  return { path: dest, name, addedAt: new Date() };
}

/** Everything currently in the inbox, newest first. */
export function listInbox(): InboxImage[] {
  const dir = ensureInbox();
  return readdirSync(dir)
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .map((f) => {
      const full = join(dir, f);
      return { path: full, name: f, addedAt: statSync(full).mtime };
    })
    .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
}

/** Watch the inbox; the callback fires for each new image dropped in. */
export function watchInbox(onImage: (image: InboxImage) => void): () => void {
  const dir = ensureInbox();
  const seen = new Set(readdirSync(dir));
  const watcher = watch(dir, (_event, filename) => {
    if (!filename || seen.has(filename)) return;
    const ext = extname(filename).toLowerCase();
    if (!IMAGE_EXT.has(ext)) return;
    const full = join(dir, filename);
    // Wait a beat so the copy finishes before we announce it.
    setTimeout(() => {
      if (existsSync(full)) {
        seen.add(filename);
        onImage({ path: full, name: filename, addedAt: new Date() });
      }
    }, 250);
  });
  return () => watcher.close();
}
