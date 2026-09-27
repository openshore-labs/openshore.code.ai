// Vault M7, the customization surface (CTO L5 to L7, L11 to L13, L18; CX Y1 to
// Y17). One file, fenced by owner so the wave 1 streams never touch the same
// lines: wave 0's guards, stream E's providers, stream F's settings loader,
// sheet logic and starter, and wave 2's room wiring.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC = join(ROOT, 'src');

// ---- M7 wave 0 begin ----

describe("the settings writer is the person's alone (L7)", () => {
  it('the app agent path never names writeConfig or vaultWriteConfig', () => {
    const text = readFileSync(join(SRC, 'lib/vaultTool.ts'), 'utf8');
    expect(text).not.toMatch(/\b(?:writeConfig|writeVaultConfigFile|vaultWriteConfig)\b/);
  });

  it('no driver names them either', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
      });
    const hits = walk(join(SRC, 'drivers')).filter((f) =>
      /\b(?:writeConfig|writeVaultConfigFile|vaultWriteConfig)\b/.test(readFileSync(f, 'utf8')),
    );
    expect(hits.map((f) => relative(SRC, f))).toEqual([]);
  });
});

// ---- M7 wave 0 end ----

// ---- M7 stream E begin ----
// Providers (L7, L16): writeConfig on the desktop folder, the hub and Local
// (ifMatch, ifAbsent, `obsidian/*` refused); settingsWrite lit only with
// writeConfig, compare-and-swap, writable and not away; the team vault on
// main has no writeConfig and reads defaults.

describe.todo('writeConfig on each provider (stream E)');

// ---- M7 stream E end ----

// ---- M7 stream F begin ----
// Settings (L5, L6, L11 to L13, L18; CX Y2, Y3, Y5, Y13, Y17): no files
// equals VAULT_SETTINGS_DEFAULTS and today's behavior; a `.obsidian` field
// renders read-only with "From Obsidian"; a widening ask yields one set-aside
// line and changes nothing; a bad file writes nothing; a same-field conflict
// shows "Use {yours}"; the cache and its invalidations; delete mode; the
// starter is refused on a non-empty vault and writes ifAbsent.

describe.todo('vault settings in the app (stream F)');

// ---- M7 stream F end ----

// ---- M7 wave 2 begin ----
// The room (Y4, Y7): the entry points, the Wayfinding rows, the overrides
// into vaultOverrides, the team read-only footer.

describe.todo('vault settings in the room (wave 2)');

// ---- M7 wave 2 end ----
