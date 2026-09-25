// Composer attachments. The + button captures files through the WebView file
// picker (which works inside the iOS WKWebView, so this needs no native plugin),
// and images are handed to vision-capable models. Anthropic's messages API
// takes base64 image blocks, so we keep the data URL and split it at send time.
//
// Video never reaches a model as video. A video attachment is turned, in the
// app, into a set of still frames (see lib/videoAttach.ts): compressed natively
// first when it is large, then sampled frame by frame with FFmpeg on the
// desktop or AVFoundation on the phone. Each frame rides along as an ordinary
// image attachment, tagged with the group it came from and the second it was
// sampled at, so the composer can show one tidy chip for the whole video and
// the driver can label each still with its timestamp.
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  /** A data: URL. For images this is base64 the cloud driver can forward. */
  dataUrl: string;
  isImage: boolean;
  /**
   * A frame lifted from a video. When set, this attachment is one still in a
   * larger group; isImage is true so every existing image path (the vision
   * gate, the send filter, the cloud image block) treats it exactly like a
   * pasted screenshot. Absent for a plain image or file.
   */
  frame?: FrameMeta;
}

/** The provenance of a single video frame: which video it came from, where it
 *  sits in the sequence, and the second it was sampled at. */
export interface FrameMeta {
  /** Stable id shared by every frame from the same video, so the composer can
   *  render and remove the whole set as one chip. */
  groupId: string;
  /** The video's original file name, for the chip label and the driver's note. */
  videoName: string;
  /** 1-based position of this frame in the set. */
  index: number;
  /** How many frames the video was sampled into. */
  count: number;
  /** The second in the video this frame was taken at. */
  timeSec: number;
}

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i;
const VIDEO_MIME = /^video\//i;
// A screen recording sometimes arrives with an empty or generic MIME from the
// picker; the extension is the honest signal then.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|qt)$/i;

let counter = 0;

/** A monotonic id fragment so two attachments made in the same tick never
 *  collide. Kept internal; callers get whole ids from the helpers below. */
export function nextAttachmentSeq(): number {
  counter += 1;
  return counter;
}

export function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => {
      resolve({
        id: `att-${nextAttachmentSeq()}-${file.name}`,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataUrl: String(reader.result ?? ''),
        isImage: IMAGE_MIME.test(file.type),
      });
    };
    reader.readAsDataURL(file);
  });
}

/** Can a model read this image as it is? Only png, jpeg, gif, and webp reach a
 *  model's vision input; anything else (HEIC from the iOS Files app, TIFF, BMP,
 *  AVIF, SVG) must be redrawn as a JPEG first, or it would ride along as a
 *  file chip that the drivers silently drop at send. */
export function isModelImage(file: { type?: string }): boolean {
  return IMAGE_MIME.test(file.type ?? '');
}

/** Can this image go to the model as it is? A readable format at a sane size;
 *  anything else is redrawn (imageToJpegAttachment). */
export function sendsAsIs(file: { type?: string; size: number }): boolean {
  return isModelImage(file) && file.size <= IMAGE_REDRAW_BYTES;
}

/** The longest side an attached image is sent at. Past it (or past
 *  IMAGE_REDRAW_BYTES) a photo is redrawn smaller, so a 48MP camera shot never
 *  trips a provider's image size limit at send. */
export const IMAGE_MAX_DIM = 2048;
export const IMAGE_REDRAW_BYTES = 3_500_000;

/** Redraw an image as a JPEG attachment, no longer than `maxDim` on its long
 *  side: for a format a model cannot read (HEIC, TIFF, BMP, AVIF, SVG) and for
 *  an oversized photo. Rejects when the platform cannot decode it either, so
 *  the caller can say so plainly. */
export async function imageToJpegAttachment(
  file: File,
  maxDim: number = IMAGE_MAX_DIM,
): Promise<Attachment> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 1024;
    const h0 = img.naturalHeight || 1024;
    const scale = Math.min(1, maxDim / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas.');
    ctx.drawImage(img, 0, 0, w, h);
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return {
      id: `att-${nextAttachmentSeq()}-${name}`,
      name,
      mime: 'image/jpeg',
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      isImage: true,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const TEXT_MIME =
  /^(text\/|application\/(json|xml|javascript|x-sh|x-yaml|yaml|toml|x-httpd-php|sql|graphql))/i;
const TEXT_EXT =
  /\.(txt|md|markdown|mdx|json|jsonc|ya?ml|toml|ini|cfg|conf|env|csv|tsv|log|xml|html?|css|scss|sass|less|[cm]?[jt]sx?|py|rb|go|rs|java|kt|kts|swift|m|mm|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|ps1|sql|graphql|gql|proto|lua|dart|scala|clj|ex|exs|erl|hs|ml|r|jl|pl|vue|svelte|astro|gradle|dockerfile|makefile|lock|gitignore|editorconfig)$/i;

/** Is this file text a model can read as pasted text? Trusts a text MIME or a
 *  known source extension, and otherwise sniffs the first bytes: a NUL byte
 *  means binary (a PDF, a zip, a .docx), which must never be pasted in as
 *  mojibake. */
export async function isTextFile(file: File): Promise<boolean> {
  if (TEXT_MIME.test(file.type) || TEXT_EXT.test(file.name)) return true;
  if (file.type && !file.type.startsWith('application/octet-stream')) return false;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return !head.includes(0);
}

/** Is this picked file a video we should turn into frames? Reads the MIME, and
 *  falls back to the extension when the picker hands over a blank type (screen
 *  recordings do this). */
export function isVideoFile(file: { type?: string; name?: string }): boolean {
  if (file.type && VIDEO_MIME.test(file.type)) return true;
  if (file.type && IMAGE_MIME.test(file.type)) return false;
  return Boolean(file.name && VIDEO_EXT.test(file.name));
}

/** Build a frame attachment from raw base64 JPEG/PNG bytes and its place in the
 *  set. Shared by every backend (native and the web fallback) so a frame looks
 *  the same however it was produced. */
export function frameAttachment(opts: {
  base64: string;
  mediaType?: string;
  meta: FrameMeta;
}): Attachment {
  const mediaType = opts.mediaType ?? 'image/jpeg';
  return {
    id: `frame-${opts.meta.groupId}-${opts.meta.index}`,
    name: `${opts.meta.videoName} · frame ${opts.meta.index}/${opts.meta.count}`,
    mime: mediaType,
    dataUrl: `data:${mediaType};base64,${opts.base64}`,
    isImage: true,
    frame: opts.meta,
  };
}

// Split a data: URL into the media type and raw base64 the Anthropic image
// block wants. Returns undefined for anything that is not a base64 data URL.
export function imageBlockParts(a: Attachment): { mediaType: string; base64: string } | undefined {
  if (!a.isImage) return undefined;
  const match = /^data:([^;]+);base64,(.*)$/s.exec(a.dataUrl);
  if (!match) return undefined;
  return { mediaType: match[1], base64: match[2] };
}

/** Group frame attachments by their video, preserving first-seen order, so the
 *  composer can render one chip per video and a plain image stays on its own.
 *  A non-frame attachment is returned as a singleton group with no meta. */
export interface AttachmentGroup {
  groupId: string;
  /** The video name for a frame group, or the attachment name for a lone item. */
  label: string;
  items: Attachment[];
  /** Present only for a video: how many frames and the span they cover. */
  video?: { count: number; lastTimeSec: number };
}

export function groupAttachments(attachments: Attachment[]): AttachmentGroup[] {
  const order: string[] = [];
  const byId = new Map<string, AttachmentGroup>();
  for (const a of attachments) {
    const key = a.frame ? `video:${a.frame.groupId}` : `one:${a.id}`;
    let group = byId.get(key);
    if (!group) {
      group = a.frame
        ? {
            groupId: a.frame.groupId,
            label: a.frame.videoName,
            items: [],
            video: { count: a.frame.count, lastTimeSec: 0 },
          }
        : { groupId: a.id, label: a.name, items: [] };
      byId.set(key, group);
      order.push(key);
    }
    group.items.push(a);
    if (a.frame && group.video) {
      group.video.lastTimeSec = Math.max(group.video.lastTimeSec, a.frame.timeSec);
    }
  }
  return order.map((k) => byId.get(k)!);
}
