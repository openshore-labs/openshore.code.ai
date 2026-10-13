// Every clip and sound a media job makes is labeled AI-made (security review
// of the model library, 2026-10-12, L8): the self-attested record a picture
// carries, written into WAV, FLAC, MP3 and MP4 where each format's readers
// look for a note, without moving anything else in the file. A likeness the
// consent gate allows only with a label is refused when its format cannot
// carry one. An edit or an animation of a person's own picture is labeled
// edited, and its screen reads the picture's file name with the words.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  embedMediaProvenance,
  labelGeneratedMedia,
  mediaFormatOf,
  readMediaProvenance,
} from '../src/core/ethics/mediaProvenance.js';
import { buildProvenanceManifest } from '../src/core/ethics/provenance.js';
import { MediaGuard, type MediaScreen } from '../src/core/ethics/guardedMedia.js';
import { EthicsBlocked } from '../src/core/ethics/guardedProvider.js';
import { MediaHost } from '../src/media/host.js';
import { ConfigSchema } from '../src/config/schema.js';

afterEach(() => vi.restoreAllMocks());

const enc = (s: string) => new TextEncoder().encode(s);
function cat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const u32be = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];

/** A minimal WAV: a fmt chunk and an odd-sized data chunk (padded). */
function wav(): Uint8Array {
  const fmt = cat(enc('fmt '), u32le(16), new Uint8Array(16));
  const data = cat(enc('data'), u32le(3), [1, 2, 3, 0]);
  return cat(enc('RIFF'), u32le(4 + fmt.length + data.length), enc('WAVE'), fmt, data);
}

/** A minimal FLAC: STREAMINFO (last, or followed by a comment block) and frames. */
function flac(withComment = false): Uint8Array {
  const streaminfo = cat([withComment ? 0x00 : 0x80, 0, 0, 34], new Uint8Array(34));
  const vendor = enc('ref');
  const commentBody = cat(u32le(vendor.length), vendor, u32le(1), u32le(7), enc('TITLE=x'));
  const comment = cat([0x84, 0, 0, commentBody.length], commentBody);
  return cat(enc('fLaC'), streaminfo, withComment ? comment : [], [0xff, 0xf8, 1, 2, 3]);
}

const MP3_FRAME = [0xff, 0xfb, 0x90, 0x00, 9, 9, 9, 9];
function id3(major: 3 | 4, flags = 0): Uint8Array {
  const text = cat([0], enc('Lavf'));
  const size = major === 4 ? [0, 0, 0, text.length] : u32be(text.length);
  const frame = cat(enc('TSSE'), size, [0, 0], text);
  return cat(enc('ID3'), [major, 0, flags, 0, 0, 0, frame.length], frame, MP3_FRAME);
}

function mp4(lastSizeZero = false): Uint8Array {
  const ftyp = cat(u32be(16), enc('ftyp'), enc('isom'), u32be(0x200));
  const mdatBody = new Uint8Array([7, 7, 7, 7]);
  const mdat = cat(u32be(lastSizeZero ? 0 : 8 + mdatBody.length), enc('mdat'), mdatBody);
  return cat(ftyp, mdat);
}

const manifest = buildProvenanceManifest({ model: 'wan22', modelPath: 'local' });

describe('labeling a clip or a sound', () => {
  const cases: [string, Uint8Array][] = [
    ['WAV', wav()],
    ['FLAC', flac()],
    ['FLAC with a comment block', flac(true)],
    ['MP3 with no tag', new Uint8Array(MP3_FRAME)],
    ['MP3 with an ID3v2.4 tag', id3(4)],
    ['MP3 with an ID3v2.3 tag', id3(3)],
    ['MP4', mp4()],
    ['MP4 whose last box runs to the end', mp4(true)],
  ];

  for (const [name, bytes] of cases) {
    it(`writes a record a reader finds, into ${name}`, () => {
      expect(readMediaProvenance(bytes)).toBeUndefined();
      const out = embedMediaProvenance(bytes, manifest);
      expect(out.embedded).toBe(true);
      expect(mediaFormatOf(out.bytes)).toBe(mediaFormatOf(bytes));
      expect(readMediaProvenance(out.bytes)?.claim_generator).toBe('OpenShore OS Code');
    });
  }

  it('leaves the audio and video data where they were', () => {
    // An MP4 grows only at the end, so no offset inside it moves.
    const clip = mp4();
    const out = embedMediaProvenance(clip, manifest).bytes;
    expect(out.subarray(0, clip.length)).toEqual(clip);
    // A FLAC keeps its frames, and its comments.
    const sound = flac(true);
    const labeled = embedMediaProvenance(sound, manifest).bytes;
    expect(labeled.subarray(labeled.length - 5)).toEqual(new Uint8Array([0xff, 0xf8, 1, 2, 3]));
    expect(new TextDecoder().decode(labeled)).toContain('TITLE=x');
  });

  it('declines a file it does not fully understand, rather than write into it', () => {
    for (const bytes of [
      id3(4, 0x80),
      enc('OggS........'),
      cat(enc('RIFF'), u32le(99), enc('WAVE')),
    ]) {
      const out = embedMediaProvenance(bytes, manifest);
      expect(out.embedded).toBe(false);
      expect(out.bytes).toBe(bytes);
    }
  });

  it('names the format and marks an edit as one', () => {
    const made = labelGeneratedMedia(mp4(), { model: 'wan22', modelPath: 'local' });
    expect(made.manifest.format).toBe('video/mp4');
    const edited = labelGeneratedMedia(mp4(), { model: 'wan22', modelPath: 'local', edited: true });
    const actions = (edited.manifest.assertions[0]!.data as { actions: { action: string }[] })
      .actions;
    expect(actions[0]!.action).toBe('c2pa.edited');
  });
});

describe('the guard', () => {
  const plain = { result: { decision: { action: 'allow' } } } as unknown as MediaScreen;
  const likeness = {
    result: {
      decision: {
        action: 'allow',
        tier: 2,
        category: 'likeness',
        requiresProvenance: true,
        subject: 'Jane Doe',
        signals: [],
      },
    },
  } as unknown as MediaScreen;

  it('labels a likeness it allowed, naming the subject', () => {
    const out = new MediaGuard().labelMedia(new Uint8Array(MP3_FRAME), likeness, {
      model: 'kokoro',
    });
    const record = readMediaProvenance(out);
    expect(JSON.stringify(record)).toContain('Jane Doe');
  });

  it('refuses a likeness whose format cannot carry the label, and keeps anything else', () => {
    const ogg = enc('OggS........');
    expect(() => new MediaGuard().labelMedia(ogg, likeness, { model: 'x' })).toThrow(EthicsBlocked);
    expect(new MediaGuard().labelMedia(ogg, plain, { model: 'x' })).toBe(ogg);
  });
});

describe('the media host', () => {
  function host(media: Record<string, unknown>) {
    const config = ConfigSchema.parse({ stack: { media } });
    const out = mkdtempSync(join(tmpdir(), 'media-out-'));
    const h = new MediaHost({ config, guard: new MediaGuard(), outRoot: out });
    return h;
  }

  it('labels every clip it makes, and an animation of a picture as an edit', async () => {
    const h = host({ 'image-to-video': { runtime: 'comfyui', graph: 'wan22-ti2v' } });
    (h as unknown as { comfyJob: () => Promise<unknown[]> }).comfyJob = async () => [
      {
        file: { filename: 'clip.mp4', subfolder: '', type: 'output' },
        bytes: mp4(),
        mediaType: 'video/mp4',
      },
    ];
    const screened: string[] = [];
    vi.spyOn(MediaGuard.prototype, 'screen').mockImplementation(async (text: string) => {
      screened.push(text);
      return { result: { decision: { action: 'allow' } } } as unknown as MediaScreen;
    });
    const [file] = await h.video({ prompt: 'make her wave', imagePath: '/w/ceo-headshot.jpg' });
    const record = readMediaProvenance(new Uint8Array(readFileSync(file!)));
    expect(JSON.stringify(record)).toContain('c2pa.edited');
    // The screen read the picture's name with the words.
    expect(screened).toEqual(['make her wave\n(the file: ceo-headshot.jpg)']);
  });
});
