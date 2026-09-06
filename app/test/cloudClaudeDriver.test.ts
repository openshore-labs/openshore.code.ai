// P2-14: the cloud context meter must be computed against the model's real
// context window, not a flat 1M (which read the meter roughly 5x too low).
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  buildVisionContent,
  contextPercentFor,
  contextWindowFor,
} from '../src/drivers/cloudClaudeDriver.js';
import { frameAttachment, type Attachment } from '../src/lib/attachments.js';

describe('cloud context meter (P2-14)', () => {
  it('every listed model carries a real context window', () => {
    for (const m of CLAUDE_MODELS) expect(m.contextWindow).toBeGreaterThanOrEqual(200_000);
  });

  it('reads against the model real window', () => {
    // Opus 5 (the default) has a 1M context window.
    expect(contextWindowFor(DEFAULT_CLAUDE_MODEL)).toBe(1_000_000);
    // 100k tokens is 10% of a 1M window.
    expect(contextPercentFor(DEFAULT_CLAUDE_MODEL, 100_000)).toBe(10);
    // An unknown model falls back to the 200k default window.
    expect(contextPercentFor('mystery-model', 100_000)).toBe(50);
  });

  it('clamps at 100 percent', () => {
    expect(contextPercentFor(DEFAULT_CLAUDE_MODEL, 2_000_000)).toBe(100);
  });
});

describe('buildVisionContent', () => {
  const image = (id: string): Attachment => ({
    id,
    name: `${id}.png`,
    mime: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
    isImage: true,
  });

  it('leaves a plain text turn as a string, no frames', () => {
    const { content, hasFrames } = buildVisionContent('hello', []);
    expect(content).toBe('hello');
    expect(hasFrames).toBe(false);
  });

  it('appends an image block and keeps the text, no frames', () => {
    const { content, hasFrames } = buildVisionContent('look', [image('a')]);
    expect(hasFrames).toBe(false);
    expect(Array.isArray(content)).toBe(true);
    const arr = content as Array<{ type: string; text?: string }>;
    expect(arr[0]!.type).toBe('image');
    expect(arr[arr.length - 1]).toEqual({ type: 'text', text: 'look' });
  });

  it('interleaves a header and per-frame labels for a video, flags frames', () => {
    const frames = [0, 1].map((i) =>
      frameAttachment({
        base64: `F${i}`,
        meta: { groupId: 'g1', videoName: 'clip.mp4', index: i + 1, count: 2, timeSec: i * 3 },
      }),
    );
    const { content, hasFrames } = buildVisionContent('what happens', frames);
    expect(hasFrames).toBe(true);
    const arr = content as Array<{ type: string; text?: string }>;
    // header, label, image, label, image, user text
    expect(arr[0]!.type).toBe('text');
    expect(arr[0]!.text).toContain('clip.mp4');
    expect(arr[1]).toEqual({ type: 'text', text: 'Frame 1 of 2, at 0:00' });
    expect(arr[2]!.type).toBe('image');
    expect(arr[3]).toEqual({ type: 'text', text: 'Frame 2 of 2, at 0:03' });
    expect(arr[4]!.type).toBe('image');
    expect(arr[arr.length - 1]).toEqual({ type: 'text', text: 'what happens' });
  });
});
