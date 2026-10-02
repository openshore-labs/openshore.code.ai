// Test isolation: everything that would touch ~/.os-code goes to a temp dir.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.OSC_HOME = mkdtempSync(join(tmpdir(), 'osc-home-'));
// Claude Code's own folder (~/.claude, where a person keeps their commands)
// too, so no test ever reads the commands of whoever runs the suite.
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'osc-claude-home-'));
// The credential file's key comes from the OS on macOS and Windows; the suite
// uses the machine-derived scheme so no test touches a real Keychain or DPAPI.
// credentialStore.test.ts restores the real one for its own round trip.
import { _setFileKeyProvider } from '../../src/auth/store.js';
_setFileKeyProvider(null);
