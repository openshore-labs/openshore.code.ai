import { describe, expect, it } from 'vitest';
import {
  buildVideoAttachment,
  clock,
  defaultFramePlan,
  frameLabel,
  planFrameTimes,
  shouldCompress,
  targetTotalBitrate,
  videoContextHeader,
  VIDEO_COMPRESS_THRESHOLD_BYTES,
  VIDEO_TARGET_MAX_BYTES,
  VIDEO_TARGET_MIN_BYTES,
  type RawVideoResult,
  type VideoBackend,
} from '../src/lib/videoAttach.js';

describe('planFrameTimes', () => {
  it('returns a single zero for a zero or unknown duration', () => {
    expect(planFrameTimes(0, 12)).toEqual([0]);
    expect(planFrameTimes(-3, 12)).toEqual([0]);
  });

  it('samples at slice midpoints, strictly increasing, inside the clip', () => {
    const times = planFrameTimes(12, 12);
    expect(times.length).toBeLessThanOrEqual(12);
    expect(times.length).toBeGreaterThan(0);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    expect(times[0]!).toBeGreaterThan(0);
    expect(times[times.length - 1]!).toBeLessThan(12);
  });

  it('never exceeds the frame cap on a long clip', () => {
    expect(planFrameTimes(600, 12).length).toBe(12);
  });

  it('takes fewer frames from a short clip (about one per 1.5s)', () => {
    // A 3s clip paces to 2 frames.
    expect(planFrameTimes(3, 12).length).toBe(2);
  });
});

describe('targetTotalBitrate', () => {
  it('lands a normal clip inside the byte band', () => {
    const durationSec = 60;
    const rate = targetTotalBitrate(durationSec, 27 * 1024 * 1024);
    const bytes = (rate * durationSec) / 8;
    expect(bytes).toBeGreaterThanOrEqual(VIDEO_TARGET_MIN_BYTES * 0.9);
    expect(bytes).toBeLessThanOrEqual(VIDEO_TARGET_MAX_BYTES * 1.1);
  });

  it('floors the bitrate so a long clip is not starved', () => {
    expect(targetTotalBitrate(100_000, 27 * 1024 * 1024)).toBe(300_000);
  });

  it('ceilings the bitrate on a very short clip', () => {
    expect(targetTotalBitrate(0.5, 27 * 1024 * 1024)).toBe(12_000_000);
  });
});

describe('shouldCompress', () => {
  const plan = defaultFramePlan();
  it('compresses over the 30MB threshold, leaves smaller clips alone', () => {
    expect(shouldCompress(VIDEO_COMPRESS_THRESHOLD_BYTES + 1, plan)).toBe(true);
    expect(shouldCompress(VIDEO_COMPRESS_THRESHOLD_BYTES, plan)).toBe(false);
    expect(shouldCompress(10 * 1024 * 1024, plan)).toBe(false);
  });
});

describe('clock', () => {
  it('formats seconds as m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(4)).toBe('0:04');
    expect(clock(67)).toBe('1:07');
  });
});

// A fake backend so the assembly is tested without a real decoder.
function fakeBackend(frameCount: number, durationSec: number): VideoBackend {
  return {
    async process(): Promise<RawVideoResult> {
      const frames = Array.from({ length: frameCount }, (_, i) => ({
        base64: `AAAA${i}`,
        mediaType: 'image/jpeg',
        timeSec: Math.round((durationSec * (i + 0.5)) / frameCount),
      }));
      return {
        frames,
        durationSec,
        originalBytes: 40 * 1024 * 1024,
        outputBytes: 27 * 1024 * 1024,
        compressed: true,
      };
    },
  };
}

function fakeFile(name: string): File {
  // A tiny stand-in File; the fake backend ignores its bytes.
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'video/mp4' });
}

describe('buildVideoAttachment', () => {
  it('turns a video into ordered frame attachments sharing one group', async () => {
    const built = await buildVideoAttachment(fakeFile('demo.mp4'), fakeBackend(4, 12));
    expect(built.frames).toHaveLength(4);
    const groups = new Set(built.frames.map((f) => f.frame?.groupId));
    expect(groups.size).toBe(1);
    built.frames.forEach((f, i) => {
      expect(f.isImage).toBe(true);
      expect(f.frame?.index).toBe(i + 1);
      expect(f.frame?.count).toBe(4);
      expect(f.frame?.videoName).toBe('demo.mp4');
      expect(f.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    });
  });

  it('throws when the backend yields no frames', async () => {
    const empty: VideoBackend = {
      async process() {
        return {
          frames: [],
          durationSec: 5,
          originalBytes: 1,
          outputBytes: 1,
          compressed: false,
        };
      },
    };
    await expect(buildVideoAttachment(fakeFile('x.mov'), empty)).rejects.toThrow();
  });
});

describe('model-facing labels', () => {
  it('the header names the video and calls the stills a frame-by-frame view', async () => {
    const built = await buildVideoAttachment(fakeFile('bug.mp4'), fakeBackend(3, 9));
    const header = videoContextHeader(built.frames);
    expect(header).toContain('bug.mp4');
    expect(header).toContain('frame-by-frame');
    expect(header).toContain('not the video itself');
  });

  it('a frame label carries its order and timestamp', () => {
    expect(frameLabel({ groupId: 'g', videoName: 'v', index: 2, count: 5, timeSec: 4 })).toBe(
      'Frame 2 of 5, at 0:04',
    );
  });

  it('the header is undefined when there are no frames', () => {
    expect(videoContextHeader([])).toBeUndefined();
  });
});
