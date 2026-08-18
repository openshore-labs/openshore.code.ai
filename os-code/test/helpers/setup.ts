// Test isolation: everything that would touch ~/.os-code goes to a temp dir.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.OSC_HOME = mkdtempSync(join(tmpdir(), 'osc-home-'));
