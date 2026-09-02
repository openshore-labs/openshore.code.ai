// QR decoding, kept DOM-free so the scan path is testable in Node: hand it
// pixels (an ImageData or anything with the same data/width/height shape) and
// get the decoded text, or undefined. The camera loop in QrScanner feeds it
// frames; a test feeds it a rasterized QR it encoded itself.
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

/** The desktop pairing QR carries JSON {u: address, t: token}. Returns the pair
 *  when the text is that shape, otherwise undefined (a foreign QR is ignored,
 *  never half-applied). */
export function parsePairingQr(text: string): { address: string; token: string } | undefined {
  try {
    const parsed = JSON.parse(text) as { u?: unknown; t?: unknown };
    if (typeof parsed.u === 'string' && typeof parsed.t === 'string' && parsed.u && parsed.t) {
      return { address: parsed.u, token: parsed.t };
    }
  } catch {}
  return undefined;
}
