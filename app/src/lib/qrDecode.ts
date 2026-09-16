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

/** The desktop pairing QR carries JSON {u: address, c: claim}, a one-time claim
 *  code the phone trades at POST /pair/claim for its own per-device credential,
 *  never a credential itself. Returns the pair when the text is that shape,
 *  otherwise undefined (a foreign QR is ignored, never half-applied). */
export function parsePairingQr(text: string): { address: string; claim: string } | undefined {
  try {
    const parsed = JSON.parse(text) as { u?: unknown; c?: unknown };
    if (typeof parsed.u === 'string' && typeof parsed.c === 'string' && parsed.u && parsed.c) {
      return { address: parsed.u, claim: parsed.c };
    }
  } catch {}
  return undefined;
}
