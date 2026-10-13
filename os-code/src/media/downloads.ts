// The record of what Get downloaded into ComfyUI's models folder (security
// review of the model library, 2026-10-12): one file beside this machine's
// config, never in a project, so removing a model can delete only the files
// Get itself wrote (src/media/upkeep.ts).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { oscHome } from '../config/home.js';

export interface Ledger {
  version: 1;
  files: { path: string; catalogId: string }[];
}

/** Where the record of Get's downloads lives: this machine's own folder. */
export function ledgerPath(home: string = oscHome()): string {
  return join(home, 'media-downloads.json');
}

export function readLedger(path: string): Ledger {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Ledger>;
    const files = Array.isArray(raw.files)
      ? raw.files.filter(
          (f): f is { path: string; catalogId: string } =>
            typeof f?.path === 'string' && typeof f?.catalogId === 'string',
        )
      : [];
    return { version: 1, files };
  } catch {
    return { version: 1, files: [] };
  }
}

export function writeLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** Note that Get wrote `file` for `catalogId`. */
export function recordDownload(file: string, catalogId: string, path = ledgerPath()): void {
  const ledger = readLedger(path);
  if (ledger.files.some((f) => f.path === file && f.catalogId === catalogId)) return;
  ledger.files.push({ path: file, catalogId });
  writeLedger(path, ledger);
}
