// The pixel workers behind a video attachment, one per platform, all speaking
// the VideoBackend contract from videoAttach.ts:
//   web      a canvas: seek an <video> and draw each frame (no compression).
//   ios      the OscodeMedia plugin: AVFoundation compresses then frames.
//   electron the desktop bridge: FFmpeg compresses then frames.
// pickVideoBackend chooses by platform and falls back to the canvas whenever
// the native side is missing, so a video always yields frames somewhere.
import { Directory, Filesystem } from '@capacitor/filesystem';
import { platform } from './platform.js';
import { bridge } from './electronBridge.js';
import { Media, type MediaProcessResult } from './mediaPlugin.js';
import {
  planFrameTimes,
  type FramePlan,
  type FrameProgress,
  type RawFrame,
  type RawVideoResult,
  type VideoBackend,
} from './videoAttach.js';

// ---- web: a canvas over an <video> ---------------------------------------

/** Wait for an event on a media element, or reject after a timeout so a wedged
 *  seek never hangs the whole attach. */
function once(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      el.removeEventListener(event, onEvent);
      el.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onEvent = () => {
      done();
      resolve();
    };
    const onError = () => {
      done();
      reject(new Error('The video could not be read.'));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('The video took too long to read.'));
    }, timeoutMs);
    el.addEventListener(event, onEvent, { once: true });
    el.addEventListener('error', onError, { once: true });
  });
}

const browserBackend: VideoBackend = {
  async process(file: File, plan: FramePlan, onProgress?: FrameProgress): Promise<RawVideoResult> {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    (video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
    video.src = url;
    const frames: RawFrame[] = [];
    try {
      await once(video, 'loadedmetadata', 15_000);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const times = planFrameTimes(duration, plan.maxFrames);
      onProgress?.(0, times.length);
      const vw = video.videoWidth || plan.maxDimension;
      const vh = video.videoHeight || plan.maxDimension;
      const scale = Math.min(1, plan.maxDimension / Math.max(vw, vh));
      const cw = Math.max(1, Math.round(vw * scale));
      const ch = Math.max(1, Math.round(vh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot render video frames.');
      for (const t of times) {
        video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
        try {
          await once(video, 'seeked', 10_000);
        } catch {
          continue; // a frame that will not seek is skipped, not fatal
        }
        ctx.drawImage(video, 0, 0, cw, ch);
        const dataUrl = canvas.toDataURL('image/jpeg', plan.frameQuality);
        const comma = dataUrl.indexOf(',');
        if (comma < 0) continue;
        frames.push({ base64: dataUrl.slice(comma + 1), mediaType: 'image/jpeg', timeSec: t });
        onProgress?.(frames.length, times.length);
      }
      return {
        frames,
        durationSec: duration,
        originalBytes: file.size,
        outputBytes: file.size,
        compressed: false,
      };
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  },
};

// ---- native: the plugin (ios) or the desktop bridge (electron) -----------

function toRawResult(r: MediaProcessResult): RawVideoResult {
  return {
    frames: r.frames.map((f) => ({ base64: f.base64, mediaType: f.mediaType, timeSec: f.timeSec })),
    durationSec: r.durationSec,
    originalBytes: r.originalBytes,
    outputBytes: r.outputBytes,
    compressed: r.compressed,
  };
}

function processOptions(path: string, plan: FramePlan) {
  return {
    path,
    maxFrames: plan.maxFrames,
    maxDimension: plan.maxDimension,
    frameQuality: plan.frameQuality,
    compressThresholdBytes: plan.compressThresholdBytes,
    targetMinBytes: plan.targetMinBytes,
    targetMaxBytes: plan.targetMaxBytes,
    targetBytes: plan.targetBytes,
  };
}

/** Read a File as raw base64 (no data: prefix), for handing a video's bytes to
 *  the phone's temp store where the native plugin can open it. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => {
      const s = String(reader.result ?? '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.readAsDataURL(file);
  });
}

const iosBackend: VideoBackend = {
  async unavailable() {
    try {
      const { available, reason } = await Media.isAvailable();
      return available ? null : (reason ?? 'Native video processing is not available.');
    } catch {
      return 'Native video processing is not available.';
    }
  },
  async process(file: File, plan: FramePlan, onProgress?: FrameProgress): Promise<RawVideoResult> {
    // WKWebView hands JS a copy of the picked file but no path the native side
    // can open, so stage the bytes in the app cache and pass that path along.
    // The temp copy is removed once the frames are back.
    onProgress?.(0, 0);
    const base64 = await fileToBase64(file);
    const name = `oscode-video-${Date.now()}-${(file.name || 'clip').replace(/[^a-z0-9.]+/gi, '_')}`;
    await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
    try {
      // The plugin returns the whole set in one call, so progress is a single
      // step to done once the frames are back.
      const result = await Media.processVideo(processOptions(uri, plan));
      const raw = toRawResult(result);
      onProgress?.(raw.frames.length, raw.frames.length);
      return raw;
    } finally {
      await Filesystem.deleteFile({ path: name, directory: Directory.Cache }).catch(() => {});
    }
  },
};

const electronBackend: VideoBackend = {
  async unavailable() {
    const b = bridge();
    if (!b?.mediaProcess) return 'The desktop bridge cannot process video.';
    return null;
  },
  async process(file: File, plan: FramePlan, onProgress?: FrameProgress): Promise<RawVideoResult> {
    const b = bridge();
    if (!b?.mediaProcess) throw new Error('The desktop bridge cannot process video.');
    // Electron exposes the real path on a picked File, so FFmpeg reads the
    // original in place with no copy.
    const path = (file as File & { path?: string }).path;
    if (!path) throw new Error('The desktop could not locate that video file.');
    onProgress?.(0, 0);
    const result = await b.mediaProcess(processOptions(path, plan));
    const raw = toRawResult(result);
    onProgress?.(raw.frames.length, raw.frames.length);
    return raw;
  },
};

/** The backend for this platform, with the canvas as the universal fallback so
 *  a native gap never leaves a video unframed. */
export function pickVideoBackend(): VideoBackend {
  const p = platform();
  const native = p === 'ios' ? iosBackend : p === 'electron' ? electronBackend : undefined;
  if (!native) return browserBackend;
  return {
    unavailable: native.unavailable,
    async process(file, plan, onProgress) {
      const why = native.unavailable ? await native.unavailable() : null;
      if (why) return browserBackend.process(file, plan, onProgress);
      try {
        return await native.process(file, plan, onProgress);
      } catch {
        // Native tried and failed (an odd codec, a permissions edge): the canvas
        // still gets usable frames from most clips, so fall back rather than
        // fail the attach.
        return browserBackend.process(file, plan, onProgress);
      }
    },
  };
}

export { browserBackend };
