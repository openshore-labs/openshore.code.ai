// Video attachments, the OpenShore way: a model never sees a video, it sees the
// video's frames. When a person attaches a clip (a screen recording, a bug
// repro, a demo), the app compresses it natively if it is large, samples it into
// a handful of stills, and hands those stills to a vision model as ordinary
// image blocks. The model reviews the clip frame by frame and can say so.
//
// This module is the pure orchestration: how many frames to take and when, the
// size math for the native compressor, the human-readable labels the driver
// wraps each frame in, and the assembly of a picked file into frame
// attachments. The actual pixel work lives behind a VideoBackend (canvas in the
// browser, FFmpeg on the desktop, AVFoundation on the phone: see
// lib/videoBackends.ts) so this file stays testable without a video decoder.
import {
  frameAttachment,
  nextAttachmentSeq,
  type Attachment,
  type FrameMeta,
} from './attachments.js';

// ---- knobs ----------------------------------------------------------------

const MB = 1024 * 1024;

/** Over this, a video is compressed before its frames are taken (founder:
 *  "when you provide a video that is over 30mg"). */
export const VIDEO_COMPRESS_THRESHOLD_BYTES = 30 * MB;
/** The band the compressor aims to land the file in (founder: "between 25 and
 *  29mg with the quality required to create a frame by frame breakdown"). */
export const VIDEO_TARGET_MIN_BYTES = 25 * MB;
export const VIDEO_TARGET_MAX_BYTES = 29 * MB;
/** The single number the bitrate math aims at, mid-band with a hair of room
 *  under the ceiling so a slightly-over encode still clears 29MB. */
export const VIDEO_TARGET_BYTES = 27 * MB;

/** How many stills a clip is sampled into. Enough to follow an interaction,
 *  few enough to stay inside a vision model's image budget and the phone's
 *  memory. */
export const VIDEO_MAX_FRAMES = 12;
/** The longest edge of a sampled frame, in pixels. A UI review reads fine at
 *  this size and it keeps each base64 block small. */
export const VIDEO_FRAME_MAX_DIM = 768;
/** JPEG quality for a sampled frame (0..1). */
export const VIDEO_FRAME_QUALITY = 0.7;

export interface FramePlan {
  maxFrames: number;
  maxDimension: number;
  frameQuality: number;
  compressThresholdBytes: number;
  targetMinBytes: number;
  targetMaxBytes: number;
  targetBytes: number;
}

export function defaultFramePlan(): FramePlan {
  return {
    maxFrames: VIDEO_MAX_FRAMES,
    maxDimension: VIDEO_FRAME_MAX_DIM,
    frameQuality: VIDEO_FRAME_QUALITY,
    compressThresholdBytes: VIDEO_COMPRESS_THRESHOLD_BYTES,
    targetMinBytes: VIDEO_TARGET_MIN_BYTES,
    targetMaxBytes: VIDEO_TARGET_MAX_BYTES,
    targetBytes: VIDEO_TARGET_BYTES,
  };
}

// ---- planning -------------------------------------------------------------

/** The seconds to sample a clip at: evenly spaced, taken at the midpoint of
 *  each slice so the first and last frames are never a black lead-in or tail.
 *  One frame per roughly a second and a half, capped at maxFrames, at least
 *  one. Returned rounded to a tenth of a second, strictly increasing. */
export function planFrameTimes(durationSec: number, maxFrames: number): number[] {
  const cap = Math.max(1, Math.floor(maxFrames));
  if (!(durationSec > 0)) return [0];
  const byPace = Math.ceil(durationSec / 1.5);
  const n = Math.min(cap, Math.max(1, byPace));
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (durationSec * (i + 0.5)) / n;
    times.push(Math.round(t * 10) / 10);
  }
  return times;
}

/** The total bitrate (bits per second) a compressor should target to land a
 *  clip of this length near the byte target. Audio is dropped for review, so
 *  this is the video budget. Floored so a very short clip is not starved and
 *  ceilinged so a very long one still fits. */
export function targetTotalBitrate(durationSec: number, targetBytes: number): number {
  if (!(durationSec > 0)) return 2_000_000;
  const raw = (targetBytes * 8) / durationSec;
  const MIN = 300_000; // 300 kbps floor: below this a UI review turns to mud
  const MAX = 12_000_000; // 12 Mbps ceiling for a very short clip
  return Math.round(Math.min(MAX, Math.max(MIN, raw)));
}

/** Should this file be compressed before framing? */
export function shouldCompress(sizeBytes: number, plan: FramePlan): boolean {
  return sizeBytes > plan.compressThresholdBytes;
}

// ---- backend contract -----------------------------------------------------

/** One frame as the backend produces it: raw base64 (no data: prefix), its
 *  media type, and the second it was taken at. */
export interface RawFrame {
  base64: string;
  mediaType: string;
  timeSec: number;
}

/** What a backend returns for one video. */
export interface RawVideoResult {
  frames: RawFrame[];
  durationSec: number;
  originalBytes: number;
  /** The byte size actually framed: the compressed size when compression ran,
   *  otherwise the original. */
  outputBytes: number;
  compressed: boolean;
}

/** The pixel worker. Takes a picked file and a plan, returns frames plus what
 *  it did about size. Implemented per platform in lib/videoBackends.ts. */
export interface VideoBackend {
  /** A short reason this backend cannot run, or null when it can. */
  unavailable?(): Promise<string | null>;
  process(file: File, plan: FramePlan): Promise<RawVideoResult>;
}

// ---- assembly -------------------------------------------------------------

/** A stable, filesystem-free id for one video's frame set. */
function newGroupId(name: string): string {
  const slug =
    name
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'video';
  return `vid-${nextAttachmentSeq()}-${slug}`;
}

export interface VideoAttachment {
  groupId: string;
  videoName: string;
  frames: Attachment[];
  result: RawVideoResult;
}

/** Turn a picked video file into a set of frame attachments. The frames carry
 *  the group id, the video name, their order, and their timestamp, so the
 *  composer shows one chip and the driver can label each still. Throws if the
 *  backend produced no frames (the caller shows a friendly message). */
export async function buildVideoAttachment(
  file: File,
  backend: VideoBackend,
): Promise<VideoAttachment> {
  const plan = defaultFramePlan();
  const result = await backend.process(file, plan);
  if (!result.frames.length) {
    throw new Error('No frames could be read from that video.');
  }
  const groupId = newGroupId(file.name || 'video');
  const count = result.frames.length;
  const frames = result.frames.map((f, i) => {
    const meta: FrameMeta = {
      groupId,
      videoName: file.name || 'video',
      index: i + 1,
      count,
      timeSec: f.timeSec,
    };
    return frameAttachment({ base64: f.base64, mediaType: f.mediaType, meta });
  });
  return { groupId, videoName: file.name || 'video', frames, result };
}

// ---- the model harness copy ----------------------------------------------

/** Minutes:seconds for a frame label, e.g. 0:04 or 1:07. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** The one-line context block that leads a video's frames in the model turn.
 *  Factual and short: the model gets the name, the length, the frame count, and
 *  the honest note that these are stills, not the video. */
export function videoContextHeader(frames: Attachment[]): string | undefined {
  const first = frames.find((f) => f.frame)?.frame;
  if (!first) return undefined;
  const count = first.count;
  const last = frames.reduce((m, f) => (f.frame ? Math.max(m, f.frame.timeSec) : m), 0);
  const span = last > 0 ? ` spanning ${clock(0)} to ${clock(last)}` : '';
  return `Frames from the video "${first.videoName}": ${count} stills${span}, in order. This is a frame-by-frame view of the clip, not the video itself.`;
}

/** The per-frame caption the driver puts before each frame's image block. */
export function frameLabel(meta: FrameMeta): string {
  return `Frame ${meta.index} of ${meta.count}, at ${clock(meta.timeSec)}`;
}

/** The system-prompt note that tells a vision model how to read a frame set.
 *  Injected only when a turn actually carries video frames. */
export const VIDEO_FRAMES_SYSTEM_NOTE = [
  'Some turns include a series of still images labeled as frames taken from a video, in order, with a timestamp on each.',
  'Treat them as sequential frames of one clip: read them in order, track what changes between them, and answer as if you watched the video.',
  'You may say plainly that you reviewed it frame by frame. Keep that brief and do not dwell on the mechanics.',
].join(' ');
