// Positive fixture for harnessPurity.test.ts: allow-listed packages and a
// type-only Node import (erased at build) pass the guard.
import type { Stats } from 'node:fs';
import { z } from 'zod';

export const Schema = z.object({ size: z.number() });
export type Sized = Pick<Stats, 'size'>;
