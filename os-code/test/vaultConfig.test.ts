// Vault M7, the customization surface (CTO L1 to L8, L18). One file, fenced by
// owner so the wave 1 streams never touch the same lines: wave 0's guards,
// stream A's core half (parse, resolve, union, patch, the precedence helpers)
// and stream C's engine half (settingsFile.ts, the writer, the `.oscode/`
// deny in every write path).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAgentWritablePath } from '../src/harness/vault/paths.js';
import { VAULT_SETTINGS_FIELDS, WIDENING_KEYS } from '../src/harness/vault/settings.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// ---- M7 wave 0 begin ----

describe('isAgentWritablePath (L8)', () => {
  it('refuses any dot segment, in any case or separator', () => {
    for (const p of [
      '.oscode/vault.json',
      '.OSCODE/vault.json',
      'a/.oscode/vault.json',
      '.obsidian/app.json',
      '.trash/x.md',
      '.git/config',
      '.hidden.md',
      'a\\.oscode\\vault.json',
      '../outside.md',
      'a/../.oscode/vault.json',
      ' .oscode/vault.json',
    ]) {
      expect(isAgentWritablePath(p), p).toBe(false);
    }
  });

  it('refuses an empty or rooted path', () => {
    for (const p of ['', '   ', '/etc/passwd', '\\x.md']) {
      expect(isAgentWritablePath(p), JSON.stringify(p)).toBe(false);
    }
  });

  it('allows an ordinary note or file path', () => {
    for (const p of ['Ideas.md', 'Projects/Plan.md', 'a.b/c.md', 'Inbox/x.png', 'Notes/v1.2.md']) {
      expect(isAgentWritablePath(p), p).toBe(true);
    }
  });
});

describe("the settings writer is the person's alone (L7)", () => {
  it('no agent tool names writeConfig, writeVaultConfigFile or vaultWriteConfig', () => {
    const hits: string[] = [];
    for (const file of walkTs(join(SRC, 'core', 'tools'))) {
      const text = readFileSync(file, 'utf8');
      if (/\b(?:writeConfig|writeVaultConfigFile|vaultWriteConfig)\b/.test(text)) {
        hits.push(relative(SRC, file));
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('the settings schema contract (L2, L4)', () => {
  it('lists every in-vault field once', () => {
    expect(new Set(VAULT_SETTINGS_FIELDS).size).toBe(VAULT_SETTINGS_FIELDS.length);
    expect(VAULT_SETTINGS_FIELDS.length).toBe(21);
  });

  it('never lets a widening key be a field', () => {
    const tops = new Set(VAULT_SETTINGS_FIELDS.map((f) => f.split('.')[0]));
    for (const key of WIDENING_KEYS) expect(tops.has(key), key).toBe(false);
  });
});

// ---- M7 wave 0 end ----

// ---- M7 stream A begin ----
// Core half (L1 to L4, L13, L18): no files equals VAULT_SETTINGS_DEFAULTS; a
// `.obsidian` fixture alone configures the vault; Obsidian wins per field
// (L3); one set-aside test per WIDENING_KEYS entry, a `!` glob, an agent
// folder that climbs or names a dot folder; unknown and invalid keys; the
// lists are union only; `unreadable` for bad JSON; patch keeps unknown keys
// and refuses a non-object; the three precedence helpers.

describe.todo('vault settings core (stream A)');

// ---- M7 stream A end ----

// ---- M7 stream C begin ----
// Engine half (L5 to L8): vaultSettingsFor over the four reads, the 2 s memo;
// writeVaultConfigFile (ifMatch, ifAbsent, `.oscode` made and lstat'd, temp
// and rename, O_NOFOLLOW, refused names); a vaultWrite under `.oscode/`
// denied, a symlinked note to `.oscode/vault.json` denied, writeFile and
// editFile to the file denied under an always-allow grant; the agent folder.

describe.todo('vault settings on the engine (stream C)');

// ---- M7 stream C end ----
