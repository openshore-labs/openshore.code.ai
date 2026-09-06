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
