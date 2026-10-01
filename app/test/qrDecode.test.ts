// The phone-side QR pairing path, end to end in Node: encode the exact payload
// the desktop pairing screen renders, rasterize it the way a camera frame would
// arrive (RGBA pixels), decode it with the same function the scanner uses, and
// parse it into the address + token the connect step needs.
import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import {
  decodeQrFromImageData,
  pairableAddress,
  pairingLink,
  parsePairingQr,
} from '../src/lib/qrDecode.js';

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
    const payload = JSON.stringify({ u: 'http://100.101.102.103:4816', c: 'pc_abcdef123456' });
    const text = decodeQrFromImageData(rasterize(payload));
    expect(text).toBe(payload);
    expect(parsePairingQr(text!)).toEqual({
      address: 'http://100.101.102.103:4816',
      claim: 'pc_abcdef123456',
    });
  });

  it('returns nothing for a frame with no QR in it', () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };
    expect(decodeQrFromImageData(blank)).toBeUndefined();
  });

  it('ignores a QR that is not a pairing payload, never half-applies it', () => {
    expect(parsePairingQr('https://example.com')).toBeUndefined();
    expect(parsePairingQr(JSON.stringify({ u: 'http://x' }))).toBeUndefined();
    expect(parsePairingQr(JSON.stringify({ u: 1, c: 2 }))).toBeUndefined();
    // The old scheme carried a live token on the QR; it must no longer parse.
    expect(parsePairingQr(JSON.stringify({ u: 'http://x', t: 'osc_x' }))).toBeUndefined();
  });

  // Pairing review (CX, 2026-10-01): the QR is a link the iPhone Camera app
  // opens, and only an address on the person's own network is ever paired.
  it('round-trips the pairing link through pixels, so the Camera app can open it too', () => {
    const link = pairingLink('http://100.101.102.103:4816', 'pc_abcdef123456');
    expect(link).toBe('oscode://pair?u=http%3A%2F%2F100.101.102.103%3A4816&c=pc_abcdef123456');
    const text = decodeQrFromImageData(rasterize(link));
    expect(parsePairingQr(text!)).toEqual({
      address: 'http://100.101.102.103:4816',
      claim: 'pc_abcdef123456',
    });
  });

  it("refuses a planted QR that points off the person's own network", () => {
    expect(parsePairingQr(pairingLink('http://203.0.113.9:4816', 'pc_x'))).toBeUndefined();
    expect(parsePairingQr(pairingLink('https://evil.example.com', 'pc_x'))).toBeUndefined();
    expect(
      parsePairingQr(pairingLink('http://stranger.tail9.ts.net:4816', 'pc_x')),
    ).toBeUndefined();
    expect(parsePairingQr(JSON.stringify({ u: 'http://8.8.8.8:4816', c: 'pc_x' }))).toBeUndefined();
    expect(
      parsePairingQr('oscode://checkout-success?u=http%3A%2F%2F100.64.0.1&c=pc_x'),
    ).toBeUndefined();
    expect(pairableAddress('http://100.64.0.1:4816')).toBe(true);
    expect(pairableAddress('http://192.168.1.20:4816')).toBe(true);
    expect(pairableAddress('http://127.0.0.1:4816')).toBe(true);
    expect(pairableAddress('ftp://100.64.0.1')).toBe(false);
  });
});
