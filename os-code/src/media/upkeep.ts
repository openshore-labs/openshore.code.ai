// Upkeep for the media jobs (security review of the model library,
// 2026-10-12): what they made, cleared on request, and a removed model's
// files, deleted on request.
//
//   Outputs  the pictures, clips and sounds the media tools and the image
//            maker saved in OpenShore's own folders (media/, images/). They
//            stay until the person clears them in the Stack's Media group;
//            clearing chats on a phone does not reach a computer, as with the
//            session journals.
//   Files    Get records each file it downloads into ComfyUI's models folder
//            (media-downloads.json, beside the config, never in a project).
//            Removing a job can delete the files Get wrote for its model, and
//            only those: never a file the person already had, and never one
//            another placed model uses (a text encoder two models share).
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { OscConfig } from '../config/schema.js';
import { oscHome } from '../config/home.js';
import type { Catalog } from '../market/schema.js';
import { comfyModelsDir, destPath } from './install.js';
import { ledgerPath, readLedger, writeLedger } from './downloads.js';
import type { MediaJob } from './jobs.js';

export interface FileTally {
  files: number;
  bytes: number;
}

function tally(dir: string, into: FileTally): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) tally(path, into);
    else if (entry.isFile()) {
      into.files += 1;
      into.bytes += statSync(path).size;
    }
  }
}

/** OpenShore's folders for what media jobs make. */
export function outputDirs(home: string = oscHome()): string[] {
  return [join(home, 'media'), join(home, 'images')];
}

/** How many files the media jobs have saved here, and their size. */
export function mediaOutputs(home: string = oscHome()): FileTally {
  const out = { files: 0, bytes: 0 };
  for (const dir of outputDirs(home)) tally(dir, out);
  return out;
}

/** Delete everything the media jobs saved here; returns what went. */
export function clearMediaOutputs(home: string = oscHome()): FileTally {
  const gone = mediaOutputs(home);
  for (const dir of outputDirs(home)) rmSync(dir, { recursive: true, force: true });
  return gone;
}

// ---------------------------------------------------------------------------
// The files Get downloaded
// ---------------------------------------------------------------------------

/** The files a job's model could take with it: the ones Get wrote for it,
 *  still there, that no other placed model needs. */
export function removableFiles(
  catalog: Catalog,
  config: OscConfig,
  job: MediaJob,
  path = ledgerPath(),
): { files: { path: string; bytes: number }[]; bytes: number } {
  const placed = config.stack.media[job];
  if (!placed?.catalogId) return { files: [], bytes: 0 };
  const ledger = readLedger(path);
  const modelsDir = comfyModelsDir(config);
  const keep = new Set<string>();
  for (const [other, p] of Object.entries(config.stack.media)) {
    if (other === job || !p?.catalogId) continue;
    for (const f of ledger.files) if (f.catalogId === p.catalogId) keep.add(f.path);
    const model = catalog.models.find((m) => m.id === p.catalogId);
    for (const f of model?.source.files ?? []) {
      if (!modelsDir) continue;
      try {
        keep.add(destPath(modelsDir, f.dest));
      } catch {
        // A dest that would leave the folder names no file to keep.
      }
    }
  }
  const files = [
    ...new Set(ledger.files.filter((f) => f.catalogId === placed.catalogId).map((f) => f.path)),
  ]
    .filter((file) => !keep.has(file) && existsSync(file) && statSync(file).isFile())
    .map((file) => ({ path: file, bytes: statSync(file).size }));
  return { files, bytes: files.reduce((n, f) => n + f.bytes, 0) };
}

/** Delete the files removableFiles names, and forget them. */
export function removeModelFiles(
  catalog: Catalog,
  config: OscConfig,
  job: MediaJob,
  path = ledgerPath(),
): FileTally {
  const { files, bytes } = removableFiles(catalog, config, job, path);
  for (const f of files) rmSync(f.path, { force: true });
  const gone = new Set(files.map((f) => f.path));
  const ledger = readLedger(path);
  writeLedger(path, { version: 1, files: ledger.files.filter((f) => !gone.has(f.path)) });
  return { files: files.length, bytes };
}
