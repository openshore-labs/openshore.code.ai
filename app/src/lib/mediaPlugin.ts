// The native media plugin: compress a video and lift stills from it, on the
// hardware that can do it well. On the phone that is AVFoundation
// (AVAssetExportSession for the size target, AVAssetImageGenerator for the
// frames); the Swift side lives in app/plugins/oscode-media. On the desktop the
// same contract is served over the Electron bridge, which drives FFmpeg (see
// lib/videoBackends.ts). This file is the JS contract plus a web stub, so the
// app builds and runs everywhere the native side is absent; in the browser the
// frames come from a canvas instead (videoBackends.ts), so the stub only ever
// reports "not here."
import { registerPlugin } from '@capacitor/core';

/** One frame the native side produced: raw base64 (no data: prefix), its media
 *  type, and the second in the clip it was taken at. */
export interface NativeFrame {
  base64: string;
  mediaType: string;
  timeSec: number;
}

export interface MediaProcessResult {
  frames: NativeFrame[];
  durationSec: number;
  originalBytes: number;
  /** The size actually framed: the compressed size when compression ran, else
   *  the original. */
  outputBytes: number;
  compressed: boolean;
}

export interface MediaProcessOptions {
  /** A native file path (file:// or a plain path) to the source video. */
  path: string;
  maxFrames: number;
  maxDimension: number;
  frameQuality: number;
  compressThresholdBytes: number;
  targetMinBytes: number;
  targetMaxBytes: number;
  /** The byte size the compressor aims at; it computes the bitrate from the
   *  clip's own duration. */
  targetBytes: number;
}

export interface MediaPluginContract {
  /** Whether native compression and framing can run here. */
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  /** Compress the video if it is over the threshold, then sample it into frames.
   *  Each returned frame carries the real second it was taken at. */
  processVideo(options: MediaProcessOptions): Promise<MediaProcessResult>;
}

const NOT_HERE = 'Native video processing is not available in this environment.';

// The web stub. The browser path never calls this (it frames on a canvas
// instead), so the stub stays honest: it says it cannot run rather than
// pretend. Reaching processVideo here is a bug in the backend selector, so it
// throws loudly instead of returning empty frames.
class MediaWeb implements MediaPluginContract {
  async isAvailable() {
    return { available: false, reason: NOT_HERE };
  }
  async processVideo(): Promise<MediaProcessResult> {
    throw new Error(NOT_HERE);
  }
}

export const Media = registerPlugin<MediaPluginContract>('OscodeMedia', {
  web: () => new MediaWeb() as unknown as MediaPluginContract,
});
