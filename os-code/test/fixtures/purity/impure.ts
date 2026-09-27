// Negative fixture for harnessPurity.test.ts: a direct Node built-in import
// that the guard must catch. Never imported by src.
import { readFileSync } from 'node:fs';

export const read = (path: string): string => readFileSync(path, 'utf8');
