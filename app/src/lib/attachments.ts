// Composer attachments. The + button captures files through the WebView file
// picker (which works inside the iOS WKWebView, so this needs no native plugin),
// and images are handed to vision-capable models. Anthropic's messages API
// takes base64 image blocks, so we keep the data URL and split it at send time.
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  /** A data: URL. For images this is base64 the cloud driver can forward. */
  dataUrl: string;
  isImage: boolean;
}

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i;

let counter = 0;

export function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => {
      counter += 1;
      resolve({
        id: `att-${counter}-${file.name}`,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataUrl: String(reader.result ?? ''),
        isImage: IMAGE_MIME.test(file.type),
      });
    };
    reader.readAsDataURL(file);
  });
}

// Split a data: URL into the media type and raw base64 the Anthropic image
// block wants. Returns undefined for anything that is not a base64 data URL.
export function imageBlockParts(a: Attachment): { mediaType: string; base64: string } | undefined {
  if (!a.isImage) return undefined;
  const match = /^data:([^;]+);base64,(.*)$/s.exec(a.dataUrl);
  if (!match) return undefined;
  return { mediaType: match[1], base64: match[2] };
}
