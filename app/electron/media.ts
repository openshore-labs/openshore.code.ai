// Desktop video framing over FFmpeg. A model never receives a video; it
// receives the video's frames. This mirrors the phone's OscodeMedia plugin
// (AVFoundation) so the app's one media contract behaves the same on both:
// compress a large clip into the size band, then sample it into downscaled
// JPEG stills. Runs in the Electron main process, where spawning a binary is
// allowed; the renderer never touches Node.
//
// FFmpeg is invoked with an explicit argument array (never a shell string), so
// a path or option can carry no injection. If FFmpeg is not installed the call
// throws, and the renderer falls back to canvas framing (Chromium can decode
// most clips on its own), so the desktop still reviews a video, just without
// the size-targeted compression step.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const run = promisify(execFile);

export interface DesktopMediaOptions {
  path: string;
  maxFrames: number;
  maxDimension: number;
  frameQuality: number;
  compressThresholdBytes: number;
  targetMinBytes: number;
  targetMaxBytes: number;
  targetBytes: number;
}

export interface DesktopMediaFrame {
  base64: string;
  mediaType: string;
  timeSec: number;
}

export interface DesktopMediaResult {
  frames: DesktopMediaFrame[];
  durationSec: number;
  originalBytes: number;
  outputBytes: number;
  compressed: boolean;
}

const FFMPEG_MISSING =
  'FFmpeg is not installed on this computer, so a video cannot be framed here. Install ffmpeg (it also provides ffprobe) and try again.';

/** Evenly spaced sample times at the midpoint of each slice, so the first and
 *  last frames are never a black lead-in or tail. Mirrors planFrameTimes in
 *  app/src/lib/videoAttach.ts. */
function planTimes(durationSec: number, maxFrames: number): number[] {
  const cap = Math.max(1, Math.floor(maxFrames));
  if (!(durationSec > 0)) return [0];
  const byPace = Math.ceil(durationSec / 1.5);
  const n = Math.min(cap, Math.max(1, byPace));
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(Math.round(((durationSec * (i + 0.5)) / n) * 10) / 10);
  return times;
}

/** The total (video) bitrate to aim at for the byte target. Mirrors
 *  targetTotalBitrate in app/src/lib/videoAttach.ts. */
function targetBitrate(durationSec: number, targetBytes: number): number {
  if (!(durationSec > 0)) return 2_000_000;
  const raw = (targetBytes * 8) / durationSec;
  return Math.round(Math.min(12_000_000, Math.max(300_000, raw)));
}

async function ffprobeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch (err) {
    if (isMissingBinary(err)) throw new Error(FFMPEG_MISSING);
    return 0;
  }
}

function isMissingBinary(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT');
}

/** Compress under the byte ceiling, dropping audio (only frames are used). One
 *  pass with a capped rate; libx264 if present. Returns the temp output path,
 *  or null when compression could not run so the caller frames the original. */
async function compress(
  input: string,
  durationSec: number,
  targetBytes: number,
  workDir: string,
): Promise<string | null> {
  const rate = targetBitrate(durationSec, targetBytes);
  const out = join(workDir, 'compressed.mp4');
  try {
    await run(
      'ffmpeg',
      [
        '-y',
        '-i',
        input,
        '-an',
        '-c:v',
        'libx264',
        '-b:v',
        String(rate),
        '-maxrate',
        String(rate),
        '-bufsize',
        String(rate * 2),
        '-vf',
        "scale='min(1280,iw)':-2",
        '-movflags',
        '+faststart',
        out,
      ],
      { maxBuffer: 1024 * 1024 * 16 },
    );
    return existsSync(out) ? out : null;
  } catch (err) {
    if (isMissingBinary(err)) throw new Error(FFMPEG_MISSING);
    return null;
  }
}

/** frameQuality 0..1 to an ffmpeg -q:v (2 best, 31 worst); a review reads fine
 *  in the 2..15 band. */
function qscale(quality: number): number {
  const q = Math.round(2 + (1 - Math.max(0, Math.min(1, quality))) * 13);
  return Math.max(2, Math.min(15, q));
}

async function frameAt(
  input: string,
  timeSec: number,
  maxDimension: number,
  quality: number,
  workDir: string,
  index: number,
): Promise<DesktopMediaFrame | null> {
  const out = join(workDir, `frame-${index}.jpg`);
  try {
    await run(
      'ffmpeg',
      [
        '-y',
        '-ss',
        String(timeSec),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${Math.round(maxDimension)},iw)':-2`,
        '-q:v',
        String(qscale(quality)),
        out,
      ],
      { maxBuffer: 1024 * 1024 * 16 },
    );
    if (!existsSync(out)) return null;
    const base64 = readFileSync(out).toString('base64');
    return { base64, mediaType: 'image/jpeg', timeSec };
  } catch (err) {
    if (isMissingBinary(err)) throw new Error(FFMPEG_MISSING);
    return null;
  }
}

export async function processVideoDesktop(
  options: DesktopMediaOptions,
): Promise<DesktopMediaResult> {
  const input = options.path;
  if (!input || !existsSync(input) || !statSync(input).isFile()) {
    throw new Error('That video file could not be found.');
  }
  const originalBytes = statSync(input).size;
  const durationSec = await ffprobeDuration(input);

  const workDir = mkdtempSync(join(tmpdir(), 'oscode-media-'));
  try {
    let framingInput = input;
    let outputBytes = originalBytes;
    let compressed = false;
    if (
      originalBytes > options.compressThresholdBytes &&
      options.compressThresholdBytes > 0 &&
      options.targetBytes > 0 &&
      durationSec > 0
    ) {
      const out = await compress(input, durationSec, options.targetBytes, workDir);
      if (out) {
        const size = statSync(out).size;
        // Only keep the compressed copy if it is actually smaller.
        if (size > 0 && size < originalBytes) {
          framingInput = out;
          outputBytes = size;
          compressed = true;
        }
      }
    }

    const times = planTimes(durationSec, options.maxFrames);
    const frames: DesktopMediaFrame[] = [];
    let i = 0;
    for (const t of times) {
      const frame = await frameAt(
        framingInput,
        t,
        options.maxDimension,
        options.frameQuality,
        workDir,
        i++,
      );
      if (frame) frames.push(frame);
    }
    if (!frames.length) throw new Error('No frames could be read from that video.');

    return { frames, durationSec, originalBytes, outputBytes, compressed };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
