// The Electron IPC surface is untrusted input (UI-6): every handler must go
// through the one `guarded` wrapper that checks the sender is the app's own
// bundled page and validates its arguments, so a future XSS in rendered
// markdown can never become code execution in the main process. Read-tests,
// because registering real handlers needs a running Electron.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
const preload = readFileSync(join(process.cwd(), 'electron', 'preload.cjs'), 'utf8');

const channels = (src: string, call: string): string[] =>
  [...src.matchAll(new RegExp(`${call}\\('(osc:[A-Za-z]+)'`, 'g'))].map((m) => m[1]!);

describe('main-process IPC guard (UI-6)', () => {
  it('registers handlers only through guarded()', () => {
    // The one raw registration is inside the wrapper itself.
    const raw = [...main.matchAll(/ipcMain\.handle\(/g)];
    expect(raw).toHaveLength(1);
    const guardedDef = main.indexOf('function guarded');
    expect(guardedDef).toBeGreaterThan(-1);
    const wrapperEnd = main.indexOf('\n}\n', guardedDef);
    expect(raw[0]!.index).toBeGreaterThan(guardedDef);
    expect(raw[0]!.index).toBeLessThan(wrapperEnd);
  });

  it('checks the sender frame against the bundled app entry', () => {
    expect(main).toMatch(/senderFrame\?\.url/);
    expect(main).toMatch(/appEntry\.href/);
  });

  it('every channel the preload invokes is guarded in main, and nothing else is', () => {
    const invoked = channels(preload, 'invoke').sort();
    const guarded = channels(main, 'guarded').sort();
    expect(invoked.length).toBeGreaterThan(40);
    expect(guarded).toEqual(invoked);
  });

  it('type-checks string arguments and requires cwd to be a directory', () => {
    expect(main).toMatch(/typeof v !== 'string'/);
    expect(main).toMatch(/statSync\([^)]*\)\.isDirectory\(\)/);
    // createSession's cwd goes through the directory check.
    expect(main).toMatch(/guarded\('osc:createSession'[\s\S]*?dir\(/);
  });

  // Vault M1 1.4, CTO F7: the renderer never sends a vault path. The folder
  // controls take no argument, and the one refinement names a choice main
  // checks against what it found itself.
  it('the vault folder IPCs take no path from the renderer', () => {
    for (const ch of [
      'osc:vaultDirInfo',
      'osc:vaultChooseDir',
      'osc:vaultReveal',
      'osc:vaultOpenObsidian',
      'osc:openPrivacySettings',
      // Bring (CTO ruling): copies from main's own previous folder into the
      // current one; any argument the renderer sends is ignored.
      'osc:vaultBringPrevious',
    ]) {
      expect(main, ch).toMatch(new RegExp(`guarded\\('${ch}', (async )?\\(\\) =>`));
    }
    expect(main).toMatch(/guarded\('osc:vaultRefineDir', \(choice: unknown\) =>/);
    expect(main).toContain("title: 'Choose your vault folder'");
    // Written through the engine's one config writer, as an absolute realpath.
    expect(main).toMatch(/saveGlobalConfig\(\{ vault: \{ dir \} \}\)/);
  });

  // Vault M3 (CTO H3, H5): the index and config IPCs take no path. The index
  // is keyed by the vault root main reads itself and capped at 32 MB; a config
  // read names a logical file main maps through its own allow-list.
  it('the vault index and config IPCs take no path, and each holds its bound', () => {
    expect(main).toMatch(
      /guarded\('osc:vaultIndexLoad', \(\) => loadVaultIndexFile\(vaultDir\(\)\)\)/,
    );
    expect(main).toMatch(/guarded\('osc:vaultIndexSave', \(blob: unknown\) =>/);
    expect(main).toMatch(/saveVaultIndexFile\(vaultDir\(\), text\)/);
    expect(main).toMatch(/text\.length > VAULT_INDEX_FILE_MAX_BYTES/);
    expect(main).toMatch(/guarded\('osc:vaultReadConfig', \(name: unknown\) =>/);
    expect(main).toMatch(/if \(!isVaultConfigName\(name\)\)[^\n]*reason: 'refused'/);
    expect(main).toMatch(/readVaultConfigFile\(vaultDir\(\), name\)/);
    for (const ch of ['vaultIndexLoad', 'vaultIndexSave', 'vaultReadConfig']) {
      expect(preload).toContain(`${ch}: invoke('osc:${ch}')`);
    }
  });

  // Vault M6 (CTO K13): every new vault channel is guarded, takes only
  // vault-relative paths main checks through the engine's folderFs, and
  // validates each guard, target and option like parseVaultGuard.
  it('the M6 vault IPCs are guarded, root-free, and validate every argument', () => {
    const m6 = [
      'vaultRename',
      'vaultFolders',
      'vaultFolderCreate',
      'vaultFolderRename',
      'vaultTrash',
      'vaultTrashList',
      'vaultTrashRestore',
      'vaultTrashEmpty',
      'vaultAttachments',
      'vaultReadBytes',
      'vaultOpenAttachment',
    ];
    for (const ch of m6) {
      expect(preload).toContain(`${ch}: invoke('osc:${ch}')`);
      expect(main).toMatch(new RegExp(`guarded\\('osc:${ch}'`));
    }
    expect(main).toMatch(
      /renameVaultFile\(vaultDir\(\), str\(from, 'from'\), str\(to, 'to'\), parseVaultRenameGuard\(g\)\)/,
    );
    expect(main).toMatch(/trashVaultPath\(vaultDir\(\), parseVaultTrashTarget\(t\)\)/);
    expect(main).toMatch(/emptyVaultTrash\(vaultDir\(\), parseVaultTrashIds\(ids\)\)/);
    expect(main).toMatch(
      /readVaultBytes\(vaultDir\(\), str\(p, 'path'\), parseReadBytesOptions\(o\)\)/,
    );
    // Opening an attachment is jailed to the attachment rule and a real file.
    expect(main).toMatch(/vaultAttachmentAbs\(vaultDir\(\), str\(p, 'path'\)\)/);
    expect(main).toMatch(/if \(!st\.isFile\(\)\) return \{ ok: false \}/);
  });

  // Vault M7 (CTO L7, L13): the settings write takes a logical name, the
  // text and a guard, never a path; it runs the daemon's own write
  // (putVaultSettingsFile: oscode/vault only, capped, parsed, link-safe) on
  // the root main reads itself, and every guard is parsed first. The session
  // overrides go through the daemon's parser, so a bad value is dropped.
  it('the M7 settings write is guarded, root-free, and guard-checked', () => {
    expect(preload).toContain("vaultWriteConfig: invoke('osc:vaultWriteConfig')");
    expect(main).toMatch(
      /guarded\('osc:vaultWriteConfig', \(name: unknown, text: unknown, guard: unknown\) =>/,
    );
    expect(main).toMatch(
      /putVaultSettingsFile\(vaultDir\(\), name, str\(text, 'text'\), parseConfigWriteGuard\(guard\)\)/,
    );
    expect(main).toMatch(/vaultOverrides: parseVaultOverrides\(o\.vaultOverrides\)/);
  });

  it('exposes secureHas so the renderer can tell absent from unreadable (P0-3)', () => {
    expect(preload).toContain("secureHas: invoke('osc:secureHas')");
    expect(main).toMatch(/guarded\('osc:secureHas'/);
  });
});
