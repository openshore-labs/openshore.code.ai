// Which shell a command runs in on this computer, and how its whole tree is
// stopped (the D2 shell package). Linux and macOS run `/bin/bash -c`, as they
// always did. Stock Windows has no /bin/bash, so the shell is resolved there:
// Git for Windows' bash when it is installed, else PowerShell. The command
// runner spawns through it, the permission engine reads its kind (a prefix
// grant is written for bash's grammar), and the prompt can name it through
// shellInfo, so all three agree on one answer.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

/** The shell one command runs in, and how it is handed the command. */
export interface ShellChoice {
  kind: 'bash' | 'powershell';
  /** The executable to spawn. */
  file: string;
  /** Its arguments for one command string. */
  args: (command: string) => string[];
}

/** Whether a candidate shell is present: a path is checked on disk, a bare
 *  name is looked up on PATH. Injected by tests. */
export type ShellProbe = (candidate: string) => boolean;

/** What the resolver reads, each defaulting to this computer. */
export interface ResolveShellOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  probe?: ShellProbe;
  /** `git --exec-path`, injected by tests. */
  gitExecPath?: () => string | undefined;
}

const BASH_C = (file: string): ShellChoice => ({
  kind: 'bash',
  file,
  args: (command) => ['-c', command],
});

const POWERSHELL = (file: string): ShellChoice => ({
  kind: 'powershell',
  file,
  args: (command) => ['-NoProfile', '-Command', command],
});

/** Git for Windows' install folder from `git --exec-path`, which answers
 *  `<root>\mingw64\libexec\git-core` (forward slashes on some builds). */
export function gitRootFromExecPath(execPath: string | undefined): string | undefined {
  if (!execPath) return undefined;
  const norm = execPath.trim().replace(/\//g, '\\');
  const m = /^(.+?)\\(?:mingw64|mingw32|clangarm64|usr)\\libexec\\git-core\\?$/i.exec(norm);
  return m?.[1];
}

function gitExecPathNow(): string | undefined {
  try {
    const res = spawnSync('git', ['--exec-path'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    return res.status === 0 ? res.stdout : undefined;
  } catch {
    return undefined;
  }
}

/** Git for Windows' bash: beside the git on PATH first, then where its
 *  installers put it. A bare `bash` on PATH is deliberately not a candidate:
 *  on Windows that is usually System32's WSL launcher, which would run the
 *  command inside a Linux distribution with a different file system and none
 *  of the project's tools. */
function gitBashCandidates(env: NodeJS.ProcessEnv, gitRoot: string | undefined): string[] {
  const out: string[] = [];
  if (gitRoot) out.push(win32.join(gitRoot, 'bin', 'bash.exe'));
  for (const root of [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']]) {
    if (root) out.push(win32.join(root, 'Git', 'bin', 'bash.exe'));
  }
  if (env.LOCALAPPDATA) {
    out.push(win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  }
  return out;
}

// Windows only (resolveShell never probes elsewhere), so the paths are win32.
function defaultProbe(env: NodeJS.ProcessEnv): ShellProbe {
  return (candidate) => {
    if (/[\\/]/.test(candidate)) return existsSync(candidate);
    const dirs = (env.PATH ?? env.Path ?? '').split(win32.delimiter).filter(Boolean);
    const names = /\.[a-z]+$/i.test(candidate) ? [candidate] : [`${candidate}.exe`, candidate];
    return dirs.some((dir) => names.some((name) => existsSync(win32.join(dir, name))));
  };
}

/**
 * The shell a command runs in. Linux and macOS always get `/bin/bash -c`, as
 * before. Windows gets Git for Windows' bash when it is installed (the model
 * writes bash, and that is where it reads the same), else PowerShell 7
 * (`pwsh`), else the Windows PowerShell every stock install carries, each
 * with `-NoProfile -Command` so a profile script never runs.
 */
export function resolveShell(opts: ResolveShellOptions = {}): ShellChoice {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return BASH_C('/bin/bash');
  const env = opts.env ?? process.env;
  const probe = opts.probe ?? defaultProbe(env);
  const gitRoot = gitRootFromExecPath((opts.gitExecPath ?? gitExecPathNow)());
  const bash = gitBashCandidates(env, gitRoot).find((candidate) => probe(candidate));
  if (bash) return BASH_C(bash);
  if (probe('pwsh')) return POWERSHELL('pwsh');
  return POWERSHELL('powershell.exe');
}

// Resolved once per process: the installed shells do not change under a
// running app, and the probe touches the disk.
let resolvedShell: ShellChoice | undefined;
export function shellForThisMachine(): ShellChoice {
  resolvedShell ??= resolveShell();
  return resolvedShell;
}

/** The platform and the shell a command runs in, for the one line of the
 *  prompt that names them (the agent loop owns that line). */
export interface ShellInfo {
  platform: NodeJS.Platform;
  shell: ShellChoice['kind'];
}

/** This computer's answer, or, with options, the answer for the platform
 *  and probes given (tests). */
export function shellInfo(opts?: ResolveShellOptions): ShellInfo {
  const platform = opts?.platform ?? process.platform;
  const shell = opts ? resolveShell(opts) : shellForThisMachine();
  return { platform, shell: shell.kind };
}

/** The operating system in words a model knows: a model told linux on a Mac
 *  reaches for the wrong commands. Linux stays "linux", the word the prompt
 *  has always carried. */
export function platformWord(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    default:
      return platform;
  }
}

/** Where a command runs, for the workspace line of the system prompt (tech review
 *  10's one helper): the platform and the shell, as "macOS, bash" or
 *  "Windows, PowerShell". Git for Windows' bash is named "Git Bash", since
 *  that is the bash a Windows model has to write for. */
export function platformAndShell(info: ShellInfo = shellInfo()): string {
  const shell =
    info.shell === 'powershell' ? 'PowerShell' : info.platform === 'win32' ? 'Git Bash' : 'bash';
  return `${platformWord(info.platform)}, ${shell}`;
}

/** How one command string is handed to the shell, for the runShell tool's
 *  schema: `bash -c` on Linux and macOS and under Git Bash, `PowerShell
 *  -Command` where Windows has no bash, so a model writes for the shell that
 *  will really run its command. */
export function shellCommandForm(info: ShellInfo = shellInfo()): string {
  return info.shell === 'powershell' ? 'PowerShell -Command' : 'bash -c';
}

/**
 * Stop a command and everything it started. POSIX signals the process group
 * (the runner spawns detached, so the group id is the child's pid). Windows
 * has no process groups to signal, so the tree is ended with `taskkill /T /F`
 * (both the polite and the forced step, since console programs ignore a
 * polite close). `spawnImpl` is injected by tests.
 */
export function killProcessTree(
  pid: number,
  signal: 'SIGTERM' | 'SIGKILL',
  platform: NodeJS.Platform = process.platform,
  spawnImpl: typeof spawn = spawn,
): void {
  if (platform === 'win32') {
    try {
      const killer = spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => undefined);
    } catch {}
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {}
}
