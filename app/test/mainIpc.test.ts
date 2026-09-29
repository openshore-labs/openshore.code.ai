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

  // The free chat (CTO ruling 8): two guarded channels, the request id and
  // the body type-checked, each event sent under its request id, and every
  // answer still running stopped when the page reloads.
  it('the free chat channels are guarded, checked, and stopped on a reload', () => {
    expect(preload).toContain("freeChat: invoke('osc:freeChat')");
    expect(preload).toContain("freeChatAbort: invoke('osc:freeChatAbort')");
    expect(preload).toContain("onFreeChat: listen('osc:free-chat')");
    expect(main).toMatch(/guarded\('osc:freeChat', \(requestId: unknown, body: unknown\) =>/);
    expect(main).toMatch(/str\(requestId, 'requestId'\);[\s\S]{0,80}obj\(body, 'body'\)/);
    expect(main).toMatch(/webContents\.send\('osc:free-chat', \{ requestId: id, event \}\)/);
    expect(main).toMatch(/did-finish-load[\s\S]{0,240}host\.stopFreeChats\(\)/);
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

  // The D2 shell package. A handler's block, from its registration to the
  // next top-level statement, so a check is read inside the right handler.
  const handler = (ch: string): string => {
    const start = main.indexOf(`guarded('${ch}'`);
    expect(start, ch).toBeGreaterThan(-1);
    const end = main.indexOf('\n);\n', start);
    const endBlock = main.indexOf('\n});\n', start);
    const stop = [end, endBlock].filter((i) => i > -1).sort((a, b) => a - b)[0]!;
    return main.slice(start, stop);
  };

  it('revoke takes only a whole token hash: never a prefix, a label, or an empty id', () => {
    expect(handler('osc:revokeDeviceCredential')).toMatch(
      /host\.revokeDeviceCredential\(deviceHash\(id, 'id'\)\)/,
    );
    const fn = main.slice(
      main.indexOf('function deviceHash'),
      main.indexOf('function deviceHash') + 300,
    );
    expect(fn).toMatch(/if \(!isTokenHash\(v\)\) throw/);
  });

  it('every irreversible or exec IPC asks main a second time, or needs the window in focus', () => {
    for (const ch of ['osc:trustFolder', 'osc:cloneRepo', 'osc:setLaunchAtLogin']) {
      expect(handler(ch), ch).toMatch(/await confirmInMain\(/);
    }
    // CX cleanup 2: each dialog's words come from mainGuards.ts, and the trust
    // dialog lists what trusting turns on, read by the engine in main.
    expect(handler('osc:trustFolder')).toMatch(
      /await confirmInMain\(trustConfirm\(host\.trustWaiting\(folder\), folder\)\)/,
    );
    expect(handler('osc:cloneRepo')).toMatch(
      /await confirmInMain\(cloneConfirm\(cloneUrlForDialog\(address\)\)\)/,
    );
    expect(handler('osc:setLaunchAtLogin')).toMatch(
      /await confirmInMain\(LAUNCH_AT_LOGIN_CONFIRM\)/,
    );
    for (const ch of ['osc:runCommand', 'osc:terminalStdin']) {
      expect(handler(ch), ch).toMatch(/if \(!windowFocused\(\)\) return/);
    }
    // The second key is a native dialog whose default is Cancel, so a
    // keystroke meant for the chat can never confirm it.
    const confirm = main.slice(main.indexOf('async function confirmInMain'));
    expect(confirm).toMatch(/dialog\.showMessageBox/);
    expect(confirm).toMatch(/defaultId: 1,\s*cancelId: 1/);
    expect(main).toMatch(/win\.isFocused\(\)/);
    expect(main).not.toContain("OpenShore will follow the project's own settings in it");
  });

  it('a session root is a realpath, and never the disk, home, or the settings folder', () => {
    const fn = main.slice(main.indexOf('function dir('), main.indexOf('function deviceHash'));
    expect(fn).toMatch(/realpathSync\(s\)/);
    expect(fn).toMatch(/sessionRootRefusal\(real,/);
    expect(fn).toMatch(/oscHome: realOr\(oscHome\(\)\)/);
    expect(fn).toMatch(/return real;/);
  });

  it('the main window answers device permissions through the one check', () => {
    expect(main).toMatch(
      /setPermissionRequestHandler\([\s\S]*?callback\(appPermissionAllowed\(permission, details, appEntry\.href\)\)/,
    );
    expect(main).toMatch(
      /setPermissionCheckHandler\([\s\S]*?appPermissionAllowed\(permission, details, appEntry\.href\)/,
    );
  });

  it('the sign-in listener keeps listening past a stray request', () => {
    const wait = handler('osc:gdriveOAuthWait');
    expect(wait).toMatch(/readOAuthCallback\(req\.method, req\.url\)/);
    expect(wait).toMatch(/server\.on\('request', onRequest\)/);
    expect(wait).not.toMatch(/server\.once\('request'/);
  });

  it('the updater runs through the one state machine, with a not-available handler', () => {
    expect(main).toMatch(/autoUpdater\.on\('update-not-available', \(\) => applyUpdate\(/);
    expect(main).toMatch(/if \(!mayCheckForUpdate\(updater\)\) return;/);
    expect(handler('osc:installUpdate')).toMatch(/applyUpdate\(\{ type: 'click' \}\)/);
    expect(main).not.toMatch(/let pendingUpdate|let installWhenReady/);
  });

  // Build 2026-09-29 (CTO ruling 7): a model seat's reply streams through
  // its own guarded channel, validated in electron/chatStream.ts, with its
  // data on osc:chat-stream and every stream torn down when the page goes.
  // httpFetch keeps its own rules, untouched.
  it('the chat stream channel is guarded, in lockstep, and torn down with the page', () => {
    for (const ch of ['chatStream', 'chatStreamAbort']) {
      expect(preload).toContain(`${ch}: invoke('osc:${ch}')`);
      expect(main).toMatch(new RegExp(`guarded\\('osc:${ch}'`));
    }
    expect(preload).toContain("onChatStream: listen('osc:chat-stream')");
    expect(main).toMatch(
      /guarded\('osc:chatStream', \(req: unknown\) => chatStreams\.start\(req\)\)/,
    );
    expect(main).toMatch(/webContents\.send\('osc:chat-stream', event\)/);
    expect(main).toMatch(/'did-start-loading', \(\) => chatStreams\.closeAll\(\)/);
    expect(main).toMatch(/'render-process-gone', \(\) => chatStreams\.closeAll\(\)/);
    expect(main).toMatch(/guarded\('osc:httpFetch', async \(req: unknown\) => \{/);
    const bridgeTypes = readFileSync(
      join(process.cwd(), 'src', 'lib', 'electronBridge.ts'),
      'utf8',
    );
    expect(bridgeTypes).toMatch(
      /chatStream\(req: ChatStreamRequest\): Promise<\{ status: number \}>/,
    );
    expect(bridgeTypes).toMatch(
      /onChatStream\(cb: \(event: ChatStreamEvent\) => void\): \(\) => void/,
    );
  });

  // The truncation card's action (C1, the security package): only a provider
  // id crosses, main writes machine config through the engine's host, and the
  // channel is in lockstep with the preload.
  it('giveMoreRoom takes only a provider id, through the engine host', () => {
    expect(preload).toContain("giveMoreRoom: invoke('osc:giveMoreRoom')");
    expect(main).toMatch(
      /guarded\('osc:giveMoreRoom', \(provider: unknown\) => host\.giveMoreRoom\(str\(provider, 'provider'\)\)\);/,
    );
  });

  // Rewind (P2): one guarded channel in lockstep with the preload, a session
  // id, the message's journal seq as a number, and the files only on an
  // explicit true, through the engine host like undo.
  it('rewind takes a session id, a seq, and an explicit files flag, through the host', () => {
    expect(preload).toContain("rewind: invoke('osc:rewind')");
    expect(main).toMatch(
      /guarded\('osc:rewind', \(sessionId: unknown, toSeq: unknown, files: unknown\) =>/,
    );
    expect(handler('osc:rewind')).toMatch(
      /host\.rewind\(str\(sessionId, 'sessionId'\), num\(toSeq, 'toSeq'\), bool\(files\)\)/,
    );
    const host = readFileSync(join(process.cwd(), 'electron', 'engineHost.ts'), 'utf8');
    expect(host).toMatch(/return driver\.rewind\(toSeq, \{ files \}\);/);
  });

  // A commit card's ticked files (D3): a list of strings or nothing at all.
  it('an approval answer carries a commit card files only as a list of strings', () => {
    expect(handler('osc:answerApproval')).toMatch(/files: strList\(a\.files, 'files'\)/);
  });

  it('exposes secureHas so the renderer can tell absent from unreadable (P0-3)', () => {
    expect(preload).toContain("secureHas: invoke('osc:secureHas')");
    expect(main).toMatch(/guarded\('osc:secureHas'/);
  });
});
