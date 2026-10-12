// The two media jobs that run as programs on this computer rather than as a
// server (the model library, 2026-10-12): separating a song into stems with
// audio-separator, and cleaning up a voice with DeepFilterNet's deepFilter.
// Both are MIT-licensed Python tools the person installs with pip.
//
// The rules for running them are the engine's rules for any program:
//   - the command comes from machine config (media.separator.command,
//     media.denoiser.command), never from a project file (projectPolicy);
//   - it runs with execFile, no shell, so nothing in a file name or a model
//     name is read as shell syntax, and a model name is checked as a plain
//     name before it reaches the command line (MediaPlacementSchema);
//   - its environment is this process's minus anything that looks like a
//     secret (scrubbedEnv), as runShell's is;
//   - it writes into a fresh folder under OpenShore's own media folder, and
//     the job reports the files it finds there.
import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scrubbedEnv } from '../core/exec/childEnv.js';

export interface ProgramResult {
  /** The files the program wrote, absolute paths. */
  files: string[];
}

export class ProgramError extends Error {
  constructor(
    message: string,
    readonly missing = false,
  ) {
    super(message);
    this.name = 'ProgramError';
  }
}

type Runner = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
) => Promise<void>;

/** Run a program with no shell, a scrubbed environment and a time limit. */
export const runProgram: Runner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return reject(new ProgramError(`${command} is not installed on this computer.`, true));
        }
        const tail = String(stderr ?? '')
          .trim()
          .split('\n')
          .slice(-3)
          .join(' ');
        reject(new ProgramError(`${command} stopped: ${tail || err.message}`));
      },
    );
    child.stdin?.end();
  });

/** Every file directly or one folder down under `dir` (audio-separator and
 *  deepFilter write flat; demucs-style tools write a folder per track). */
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isFile()) out.push(path);
    else if (stat.isDirectory()) {
      for (const inner of readdirSync(path)) {
        const innerPath = join(path, inner);
        if (statSync(innerPath).isFile()) out.push(innerPath);
      }
    }
  }
  return out.sort();
}

/** audio-separator's arguments for one song. `vocalsOnly` keeps just the
 *  vocals and the rest (two stems). Pure, so a test can read them. */
export function separatorArgs(input: {
  file: string;
  model: string;
  outDir: string;
  modelDir?: string;
  vocalsOnly?: boolean;
}): string[] {
  const args = [
    input.file,
    '-m',
    input.model,
    '--output_dir',
    input.outDir,
    '--output_format',
    'FLAC',
  ];
  if (input.modelDir) args.push('--model_file_dir', input.modelDir);
  if (input.vocalsOnly) args.push('--single_stem', 'Vocals');
  return args;
}

/** deepFilter's arguments for one recording. Pure, for the test. */
export function denoiserArgs(input: { file: string; model?: string; outDir: string }): string[] {
  const args = [input.file, '-o', input.outDir];
  if (input.model) args.push('-m', input.model);
  return args;
}

export interface ProgramsOptions {
  separatorCommand?: string;
  separatorModelDir?: string;
  denoiserCommand?: string;
  /** Where outputs go; a fresh folder under it per job. */
  outRoot: string;
  run?: Runner;
  timeoutMs?: number;
}

export class MediaPrograms {
  private readonly run: Runner;

  constructor(private readonly options: ProgramsOptions) {
    this.run = options.run ?? runProgram;
  }

  private freshDir(kind: string): string {
    const dir = join(this.options.outRoot, kind, `${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  async separate(input: {
    file: string;
    model: string;
    vocalsOnly?: boolean;
    signal?: AbortSignal;
  }): Promise<ProgramResult> {
    const command = this.options.separatorCommand;
    if (!command) throw new ProgramError('No stem separator is set up on this computer.', true);
    const outDir = this.freshDir('stems');
    await this.run(
      command,
      separatorArgs({
        file: input.file,
        model: input.model,
        outDir,
        ...(this.options.separatorModelDir ? { modelDir: this.options.separatorModelDir } : {}),
        ...(input.vocalsOnly ? { vocalsOnly: true } : {}),
      }),
      {
        env: scrubbedEnv(),
        timeoutMs: this.options.timeoutMs ?? 30 * 60_000,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    return { files: filesUnder(outDir) };
  }

  async denoise(input: {
    file: string;
    model?: string;
    signal?: AbortSignal;
  }): Promise<ProgramResult> {
    const command = this.options.denoiserCommand;
    if (!command) throw new ProgramError('No voice cleaner is set up on this computer.', true);
    const outDir = this.freshDir('cleanup');
    await this.run(
      command,
      denoiserArgs({ file: input.file, outDir, ...(input.model ? { model: input.model } : {}) }),
      {
        env: scrubbedEnv(),
        timeoutMs: this.options.timeoutMs ?? 30 * 60_000,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    return { files: filesUnder(outDir) };
  }
}
