// QR decoding, kept DOM-free so the scan path is testable in Node: hand it
// pixels (an ImageData or anything with the same data/width/height shape) and
// get the decoded text, or undefined. The camera loop in QrScanner feeds it
// frames; a test feeds it a rasterized QR it encoded itself. Its own file so
// the decoder (about 130 KB) loads when the camera opens, never at launch;
// reading a pairing link stays in lib/qrDecode.ts.
import jsQR from 'jsqr';

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function decodeQrFromImageData(img: PixelBuffer): string | undefined {
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  const text = code?.data?.trim();
  return text ? text : undefined;
}
