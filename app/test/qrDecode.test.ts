// The phone-side QR pairing path, end to end in Node: encode the exact payload
// the desktop pairing screen renders, rasterize it the way a camera frame would
// arrive (RGBA pixels), decode it with the same function the scanner uses, and
// parse it into the address + token the connect step needs.
import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { decodeQrFromImageData, parsePairingQr } from '../src/lib/qrDecode.js';

/** Rasterize a QR symbol into RGBA pixels with a quiet zone, like a frame. */
function rasterize(text: string, scale = 6, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const i = (py * dim + px) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: dim, height: dim };
}

describe('QR pairing decode', () => {
  it('round-trips the desktop pairing payload through pixels', () => {
    const payload = JSON.stringify({ u: 'http://100.101.102.103:4816', t: 'osc_abcdef123456' });
    const text = decodeQrFromImageData(rasterize(payload));
    expect(text).toBe(payload);
    expect(parsePairingQr(text!)).toEqual({
      address: 'http://100.101.102.103:4816',
      token: 'osc_abcdef123456',
    });
  });

  it('returns nothing for a frame with no QR in it', () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };
    expect(decodeQrFromImageData(blank)).toBeUndefined();
  });

  it('ignores a QR that is not a pairing payload, never half-applies it', () => {
    expect(parsePairingQr('https://example.com')).toBeUndefined();
    expect(parsePairingQr(JSON.stringify({ u: 'http://x' }))).toBeUndefined();
    expect(parsePairingQr(JSON.stringify({ u: 1, t: 2 }))).toBeUndefined();
  });
});
