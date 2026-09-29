// Test isolation: everything that would touch ~/.os-code goes to a temp dir.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.OSC_HOME = mkdtempSync(join(tmpdir(), 'osc-home-'));
// Claude Code's own folder (~/.claude, where a person keeps their commands)
// too, so no test ever reads the commands of whoever runs the suite.
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'osc-claude-home-'));
