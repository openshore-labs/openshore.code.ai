// Provenance for generated sound and video (security review of the model
// library, 2026-10-12, L8). The same self-attested record a generated picture
// carries (provenance.ts: the C2PA assertion vocabulary, unsigned and saying
// so), written into the formats the media jobs produce, each in the place its
// own readers look for a note:
//
//   WAV   a LIST/INFO chunk with an ICMT comment
//   FLAC  a Vorbis comment, C2PA_MANIFEST=<json>, in the file's one comment block
//   MP3   an ID3v2 TXXX frame named c2pa.manifest
//   MP4   a top-level `uuid` box appended at the end, so no offset inside the
//         file moves (readers skip a box they do not know)
//
// Each embedder checks the file's structure first and declines (embedded:
// false, with a reason) rather than write into a file it does not fully
// understand; a likeness output that cannot be labeled is then refused by
// MediaGuard, as a picture is.
import {
  buildProvenanceManifest,
  PROVENANCE_KEYWORD,
  type ProvenanceInput,
  type ProvenanceManifest,
} from './provenance.js';

export interface EmbedResult {
  bytes: Uint8Array;
  embedded: boolean;
  reason: string;
}

export type MediaFormat = 'wav' | 'flac' | 'mp3' | 'mp4';

const MEDIA_TYPE: Record<MediaFormat, string> = {
  wav: 'audio/wav',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

/** The 16-byte extended type of OpenShore's provenance box: the ASCII of
 *  "OpenShoreC2PA.v1". Its own, so it is never read as a signed C2PA box. */
const MP4_UUID = new TextEncoder().encode('OpenShoreC2PA.v1');

const ascii = (bytes: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...bytes.subarray(at, at + n));
const utf8 = (text: string) => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The format a file is, by its first bytes. */
export function mediaFormatOf(bytes: Uint8Array): MediaFormat | undefined {
  if (bytes.length < 4) return undefined;
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE')
    return 'wav';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (bytes.length >= 8 && ascii(bytes, 4, 4) === 'ftyp') return 'mp4';
  if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'mp3';
  return undefined;
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

const WAV_PREFIX = `${PROVENANCE_KEYWORD}:`;

function le32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function wavChunks(bytes: Uint8Array): { id: string; start: number; size: number }[] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { id: string; start: number; size: number }[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > bytes.length) return undefined;
    out.push({ id: ascii(bytes, at, 4), start: at, size });
    at += 8 + size + (size % 2);
  }
  return at >= bytes.length ? out : undefined;
}

function embedWav(bytes: Uint8Array, json: string): EmbedResult {
  const chunks = wavChunks(bytes);
  if (!chunks?.some((c) => c.id === 'data')) {
    return { bytes, embedded: false, reason: 'the WAV file does not parse' };
  }
  const raw = utf8(`${WAV_PREFIX}${json}\0`);
  const text = raw.length % 2 ? concat(raw, new Uint8Array(1)) : raw;
  const icmt = concat(utf8('ICMT'), le32(text.length), text);
  const list = concat(utf8('LIST'), le32(4 + icmt.length), utf8('INFO'), icmt);
  const tail = bytes.length % 2 ? new Uint8Array(1) : new Uint8Array(0);
  const out = concat(bytes, tail, list);
  if (out.length - 8 > 0xffffffff) return { bytes, embedded: false, reason: 'too large for WAV' };
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return { bytes: out, embedded: true, reason: 'provenance written as a LIST/INFO comment' };
}

function readWav(bytes: Uint8Array): string | undefined {
  for (const c of wavChunks(bytes) ?? []) {
    if (c.id !== 'LIST' || ascii(bytes, c.start + 8, 4) !== 'INFO') continue;
    let at = c.start + 12;
    const end = c.start + 8 + c.size;
    while (at + 8 <= end) {
      const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at + 4, true);
      const text = new TextDecoder()
        .decode(bytes.subarray(at + 8, at + 8 + size))
        .replace(/\0+$/, '');
      if (ascii(bytes, at, 4) === 'ICMT' && text.startsWith(WAV_PREFIX)) {
        return text.slice(WAV_PREFIX.length);
      }
      at += 8 + size + (size % 2);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// FLAC
// ---------------------------------------------------------------------------

const FLAC_KEY = 'C2PA_MANIFEST=';

interface FlacBlock {
  type: number;
  last: boolean;
  start: number;
  length: number;
}

function flacBlocks(bytes: Uint8Array): FlacBlock[] | undefined {
  const out: FlacBlock[] = [];
  let at = 4;
  for (;;) {
    if (at + 4 > bytes.length) return undefined;
    const head = bytes[at]!;
    const length = (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (at + 4 + length > bytes.length) return undefined;
    out.push({ type: head & 0x7f, last: (head & 0x80) !== 0, start: at, length });
    at += 4 + length;
    if (head & 0x80) return out;
  }
}

function blockHead(type: number, last: boolean, length: number): Uint8Array {
  return new Uint8Array([
    (last ? 0x80 : 0) | type,
    length >> 16,
    (length >> 8) & 0xff,
    length & 0xff,
  ]);
}

function embedFlac(bytes: Uint8Array, json: string): EmbedResult {
  const blocks = flacBlocks(bytes);
  if (!blocks || blocks[0]?.type !== 0) {
    return { bytes, embedded: false, reason: 'the FLAC file does not parse' };
  }
  const entry = utf8(`${FLAC_KEY}${json}`);
  const existing = blocks.find((b) => b.type === 4);
  let body: Uint8Array;
  if (existing) {
    const data = bytes.subarray(existing.start + 4, existing.start + 4 + existing.length);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const vendor = view.getUint32(0, true);
    if (4 + vendor + 4 > data.length) {
      return { bytes, embedded: false, reason: 'the FLAC comment block does not parse' };
    }
    const count = view.getUint32(4 + vendor, true);
    body = concat(
      data.subarray(0, 4 + vendor),
      le32(count + 1),
      data.subarray(8 + vendor),
      le32(entry.length),
      entry,
    );
  } else {
    const vendor = utf8('OpenShore');
    body = concat(le32(vendor.length), vendor, le32(1), le32(entry.length), entry);
  }
  if (body.length > 0xffffff) return { bytes, embedded: false, reason: 'too large for FLAC' };
  // Rebuild the metadata: every block as it was, the comment block replaced
  // (or added after STREAMINFO), the last-block flag on the final one.
  const kept = blocks.filter((b) => b !== existing);
  const parts: { type: number; data: Uint8Array }[] = kept.map((b) => ({
    type: b.type,
    data: bytes.subarray(b.start + 4, b.start + 4 + b.length),
  }));
  parts.splice(1, 0, { type: 4, data: body });
  const audioStart = blocks[blocks.length - 1]!.start + 4 + blocks[blocks.length - 1]!.length;
  const meta = parts.flatMap((p, i) => [
    blockHead(p.type, i === parts.length - 1, p.data.length),
    p.data,
  ]);
  return {
    bytes: concat(bytes.subarray(0, 4), ...meta, bytes.subarray(audioStart)),
    embedded: true,
    reason: 'provenance written as a Vorbis comment',
  };
}

function readFlac(bytes: Uint8Array): string | undefined {
  const block = flacBlocks(bytes)?.find((b) => b.type === 4);
  if (!block) return undefined;
  const data = bytes.subarray(block.start + 4, block.start + 4 + block.length);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 4 + view.getUint32(0, true);
  const count = view.getUint32(at, true);
  at += 4;
  for (let i = 0; i < count && at + 4 <= data.length; i++) {
    const len = view.getUint32(at, true);
    const text = new TextDecoder().decode(data.subarray(at + 4, at + 4 + len));
    if (text.startsWith(FLAC_KEY)) return text.slice(FLAC_KEY.length);
    at += 4 + len;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// MP3 (ID3v2)
// ---------------------------------------------------------------------------

function synchsafe(n: number): Uint8Array {
  return new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function readSynchsafe(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 21) | (bytes[at + 1]! << 14) | (bytes[at + 2]! << 7) | bytes[at + 3]!;
}

function be32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

/** A TXXX frame for ID3v2.3 (UTF-16 with a BOM) or 2.4 (UTF-8). */
function txxx(major: 3 | 4, json: string): Uint8Array {
  let text: Uint8Array;
  if (major === 4) {
    text = concat(new Uint8Array([3]), utf8(PROVENANCE_KEYWORD), new Uint8Array([0]), utf8(json));
  } else {
    const utf16 = (s: string) => {
      const out = new Uint8Array(2 + s.length * 2);
      out.set([0xff, 0xfe]);
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        out[2 + i * 2] = c & 0xff;
        out[3 + i * 2] = c >> 8;
      }
      return out;
    };
    text = concat(
      new Uint8Array([1]),
      utf16(PROVENANCE_KEYWORD),
      new Uint8Array([0, 0]),
      utf16(json),
    );
  }
  const size = major === 4 ? synchsafe(text.length) : be32(text.length);
  return concat(utf8('TXXX'), size, new Uint8Array([0, 0]), text);
}

function embedMp3(bytes: Uint8Array, json: string): EmbedResult {
  if (ascii(bytes, 0, 3) !== 'ID3') {
    const frame = txxx(4, json);
    const header = concat(utf8('ID3'), new Uint8Array([4, 0, 0]), synchsafe(frame.length));
    return {
      bytes: concat(header, frame, bytes),
      embedded: true,
      reason: 'provenance written in a new ID3v2.4 tag',
    };
  }
  const major = bytes[3];
  const flags = bytes[5]!;
  // Unsynchronised or extended-header tags are left alone rather than risk
  // writing a frame where a reader will not find it.
  if ((major !== 3 && major !== 4) || flags & 0xc0) {
    return { bytes, embedded: false, reason: 'the ID3 tag uses a layout this does not write into' };
  }
  const size = readSynchsafe(bytes, 6);
  if (10 + size > bytes.length)
    return { bytes, embedded: false, reason: 'the ID3 tag does not parse' };
  const frame = txxx(major, json);
  return {
    bytes: concat(bytes.subarray(0, 6), synchsafe(size + frame.length), frame, bytes.subarray(10)),
    embedded: true,
    reason: 'provenance written as an ID3 TXXX frame',
  };
}

function readMp3(bytes: Uint8Array): string | undefined {
  if (ascii(bytes, 0, 3) !== 'ID3') return undefined;
  const major = bytes[3];
  const end = 10 + readSynchsafe(bytes, 6);
  let at = 10;
  while (at + 10 <= end) {
    const id = ascii(bytes, at, 4);
    const size =
      major === 4
        ? readSynchsafe(bytes, at + 4)
        : new DataView(bytes.buffer, bytes.byteOffset).getUint32(at + 4, false);
    if (!/^[A-Z0-9]{4}$/.test(id) || size === 0) return undefined;
    if (id === 'TXXX') {
      const data = bytes.subarray(at + 10, at + 10 + size);
      const enc = data[0];
      const text =
        enc === 1
          ? new TextDecoder('utf-16le').decode(data.subarray(3)).replace(/\uFEFF/g, '')
          : new TextDecoder().decode(data.subarray(1));
      const [desc, ...value] = text.split('\0');
      if (desc === PROVENANCE_KEYWORD) return value.filter(Boolean).join('');
    }
    at += 10 + size;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// MP4
// ---------------------------------------------------------------------------

function mp4Boxes(bytes: Uint8Array): { type: string; start: number; size: number }[] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { type: string; start: number; size: number }[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) return undefined;
    let size = view.getUint32(at, false);
    if (size === 1) {
      if (at + 16 > bytes.length) return undefined;
      size = Number(view.getBigUint64(at + 8, false));
    } else if (size === 0) {
      size = bytes.length - at;
    }
    if (size < 8 || at + size > bytes.length) return undefined;
    out.push({ type: ascii(bytes, at + 4, 4), start: at, size });
    at += size;
  }
  return out;
}

function embedMp4(bytes: Uint8Array, json: string): EmbedResult {
  const boxes = mp4Boxes(bytes);
  if (!boxes || boxes[0]?.type !== 'ftyp') {
    return { bytes, embedded: false, reason: 'the MP4 file does not parse' };
  }
  let base = bytes;
  const last = boxes[boxes.length - 1]!;
  // A last box that runs "to the end of the file" (size 0) would swallow an
  // appended box, so it is given its real size first.
  if (new DataView(bytes.buffer, bytes.byteOffset).getUint32(last.start, false) === 0) {
    if (last.size > 0xffffffff) return { bytes, embedded: false, reason: 'too large to label' };
    base = bytes.slice();
    new DataView(base.buffer).setUint32(last.start, last.size, false);
  }
  const payload = utf8(json);
  const box = concat(be32(8 + 16 + payload.length), utf8('uuid'), MP4_UUID, payload);
  return {
    bytes: concat(base, box),
    embedded: true,
    reason: 'provenance written as a top-level uuid box',
  };
}

function readMp4(bytes: Uint8Array): string | undefined {
  for (const box of mp4Boxes(bytes) ?? []) {
    if (box.type !== 'uuid') continue;
    const id = bytes.subarray(box.start + 8, box.start + 24);
    if (id.every((b, i) => b === MP4_UUID[i])) {
      return new TextDecoder().decode(bytes.subarray(box.start + 24, box.start + box.size));
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------

/** Write a provenance record into a generated sound or clip. */
export function embedMediaProvenance(bytes: Uint8Array, manifest: ProvenanceManifest): EmbedResult {
  const format = mediaFormatOf(bytes);
  const json = JSON.stringify(manifest);
  try {
    if (format === 'wav') return embedWav(bytes, json);
    if (format === 'flac') return embedFlac(bytes, json);
    if (format === 'mp3') return embedMp3(bytes, json);
    if (format === 'mp4') return embedMp4(bytes, json);
  } catch {
    return { bytes, embedded: false, reason: 'the file could not be labeled' };
  }
  return { bytes, embedded: false, reason: 'a format this does not label' };
}

/** The provenance record in a sound or clip, when it has one. */
export function readMediaProvenance(bytes: Uint8Array): ProvenanceManifest | undefined {
  const format = mediaFormatOf(bytes);
  try {
    const json =
      format === 'wav'
        ? readWav(bytes)
        : format === 'flac'
          ? readFlac(bytes)
          : format === 'mp3'
            ? readMp3(bytes)
            : format === 'mp4'
              ? readMp4(bytes)
              : undefined;
    return json ? (JSON.parse(json) as ProvenanceManifest) : undefined;
  } catch {
    return undefined;
  }
}

/** Build and embed in one call, for a generated sound or clip. */
export function labelGeneratedMedia(
  bytes: Uint8Array,
  input: Omit<ProvenanceInput, 'format'>,
): EmbedResult & { manifest: ProvenanceManifest } {
  const format = mediaFormatOf(bytes);
  const manifest = buildProvenanceManifest({
    ...input,
    format: format ? MEDIA_TYPE[format] : 'application/octet-stream',
  });
  return { ...embedMediaProvenance(bytes, manifest), manifest };
}
