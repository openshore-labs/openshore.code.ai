import { describe, expect, it } from 'vitest';
import { imageBlockParts, type Attachment } from '../src/lib/attachments.js';

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
});
