import { describe, expect, it } from 'vitest';
import {
  frameAttachment,
  groupAttachments,
  imageBlockParts,
  isVideoFile,
  type Attachment,
} from '../src/lib/attachments.js';

function att(partial: Partial<Attachment>): Attachment {
  return {
    id: 'a1',
    name: 'x',
    mime: 'image/png',
    dataUrl: '',
    isImage: true,
    ...partial,
  };
}

describe('imageBlockParts', () => {
  it('splits a base64 image data URL into media type and payload', () => {
    const parts = imageBlockParts(
      att({ mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }),
    );
    expect(parts).toEqual({ mediaType: 'image/png', base64: 'AAAA' });
  });

  it('returns undefined for a non-image attachment', () => {
    expect(
      imageBlockParts(att({ isImage: false, dataUrl: 'data:text/plain;base64,AAAA' })),
    ).toBeUndefined();
  });

  it('returns undefined when the data URL is not base64', () => {
    expect(imageBlockParts(att({ dataUrl: 'https://example.com/x.png' }))).toBeUndefined();
  });

  it('splits a frame attachment like any other image', () => {
    const frame = frameAttachment({
      base64: 'ZZZ',
      meta: { groupId: 'g', videoName: 'v.mp4', index: 1, count: 1, timeSec: 0 },
    });
    expect(imageBlockParts(frame)).toEqual({ mediaType: 'image/jpeg', base64: 'ZZZ' });
  });
});

describe('isVideoFile', () => {
  it('detects a video by MIME', () => {
    expect(isVideoFile({ type: 'video/mp4', name: 'a.mp4' })).toBe(true);
    expect(isVideoFile({ type: 'video/quicktime', name: 'a.mov' })).toBe(true);
  });
  it('detects a screen recording that arrives with a blank MIME, by extension', () => {
    expect(isVideoFile({ type: '', name: 'ScreenRecording.mov' })).toBe(true);
    expect(isVideoFile({ type: '', name: 'clip.webm' })).toBe(true);
  });
  it('is not fooled by an image', () => {
    expect(isVideoFile({ type: 'image/png', name: 'shot.png' })).toBe(false);
    expect(isVideoFile({ type: 'image/jpeg', name: 'a.mp4.jpg' })).toBe(false);
  });
});

describe('groupAttachments', () => {
  const img = (id: string): Attachment => ({
    id,
    name: `${id}.png`,
    mime: 'image/png',
    dataUrl: 'data:image/png;base64,AA',
    isImage: true,
  });

  it('keeps a plain image as its own group', () => {
    const groups = groupAttachments([img('a'), img('b')]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.video).toBeUndefined();
    expect(groups[0]!.label).toBe('a.png');
  });

  it('folds all frames of one video into a single group', () => {
    const frames = [0, 1, 2].map((i) =>
      frameAttachment({
        base64: `F${i}`,
        meta: { groupId: 'vid1', videoName: 'demo.mp4', index: i + 1, count: 3, timeSec: i * 2 },
      }),
    );
    const groups = groupAttachments([img('a'), ...frames]);
    expect(groups).toHaveLength(2);
    const video = groups.find((g) => g.video);
    expect(video?.items).toHaveLength(3);
    expect(video?.label).toBe('demo.mp4');
    expect(video?.video?.count).toBe(3);
    expect(video?.video?.lastTimeSec).toBe(4);
  });
});
