// The terminal's shell choice per platform (A5). SHELL is unset on Windows, so
// the old `process.env.SHELL || '/bin/bash'` spawned a path that does not
// exist there. The default is now platform-true, and a PowerShell that fails
// to spawn falls back to cmd.exe once, through the injected factory so the
// path is testable on any machine.
import { describe, expect, it } from 'vitest';
import {
  TerminalManager,
  defaultShell,
  fallbackShell,
  type PtySpawnOptions,
  type TerminalPty,
} from '../src/daemon/terminal.js';

function fakePty(): TerminalPty {
  return {
    write() {},
    resize() {},
    kill() {},
    onData() {},
    onExit() {},
  };
}

describe('defaultShell', () => {
  it('honors SHELL wherever it is set', () => {
    expect(defaultShell('linux', { SHELL: '/usr/bin/zsh' })).toBe('/usr/bin/zsh');
    expect(defaultShell('win32', { SHELL: 'C:\\msys64\\usr\\bin\\bash.exe' })).toBe(
      'C:\\msys64\\usr\\bin\\bash.exe',
    );
  });

  it('spawns PowerShell on Windows when SHELL is unset, bash elsewhere', () => {
    expect(defaultShell('win32', {})).toBe('powershell.exe');
    expect(defaultShell('linux', {})).toBe('/bin/bash');
    expect(defaultShell('darwin', {})).toBe('/bin/bash');
  });

  it('falls back to cmd.exe (COMSPEC when set) on Windows only', () => {
    expect(fallbackShell('win32', {})).toBe('cmd.exe');
    expect(fallbackShell('win32', { COMSPEC: 'C:\\Windows\\system32\\cmd.exe' })).toBe(
      'C:\\Windows\\system32\\cmd.exe',
    );
    expect(fallbackShell('linux', {})).toBeUndefined();
  });
});

describe('TerminalManager shell fallback', () => {
  it('retries once with cmd.exe when PowerShell cannot spawn on win32', async () => {
    const attempts: string[] = [];
    const manager = new TerminalManager({
      platform: 'win32',
      env: {},
      spawn: async (opts: PtySpawnOptions) => {
        attempts.push(opts.shell);
        if (opts.shell === 'powershell.exe') throw new Error('spawn powershell.exe ENOENT');
        return fakePty();
      },
    });
    const info = await manager.ensure({ sessionId: 's1', cwd: 'C:\\work' });
    expect(info.termId).toBeTruthy();
    expect(attempts).toEqual(['powershell.exe', 'cmd.exe']);
  });

  it('does not retry on Linux: a failed spawn surfaces as the error it is', async () => {
    const attempts: string[] = [];
    const manager = new TerminalManager({
      platform: 'linux',
      env: {},
      spawn: async (opts: PtySpawnOptions) => {
        attempts.push(opts.shell);
        throw new Error('spawn /bin/bash EACCES');
      },
    });
    await expect(manager.ensure({ sessionId: 's1', cwd: '/tmp' })).rejects.toThrow(/EACCES/);
    expect(attempts).toEqual(['/bin/bash']);
  });
});
