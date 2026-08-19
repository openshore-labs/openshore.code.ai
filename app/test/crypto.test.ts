// The at-rest sealing contract: a round-trip returns the original, plaintext
// passes through untouched (so pre-encryption data still reads), and a tampered
// or wrong-key blob returns null rather than throwing or leaking.
import { describe, expect, it } from 'vitest';
import { generateRawDek, importDek, isSealed, open, seal } from '../src/lib/crypto.js';

async function freshKey() {
  return importDek(generateRawDek());
}

describe('crypto (at-rest sealing)', () => {
  it('round-trips a string through seal and open', async () => {
    const key = await freshKey();
    const plain = 'the quick brown fox {"json":true, "n":42}';
    const sealed = await seal(key, plain);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain(plain);
    expect(await open(key, sealed)).toBe(plain);
  });

  it('uses a fresh IV so the same plaintext seals differently', async () => {
    const key = await freshKey();
    const a = await seal(key, 'same');
    const b = await seal(key, 'same');
    expect(a).not.toBe(b);
    expect(await open(key, a)).toBe('same');
    expect(await open(key, b)).toBe('same');
  });

  it('passes plaintext through unchanged (migration path)', async () => {
    const key = await freshKey();
    expect(await open(key, 'not-sealed-legacy-value')).toBe('not-sealed-legacy-value');
    expect(isSealed('not-sealed-legacy-value')).toBe(false);
  });

  it('returns null for a wrong key without throwing', async () => {
    const sealed = await seal(await freshKey(), 'secret');
    expect(await open(await freshKey(), sealed)).toBeNull();
  });

  it('returns null for a tampered ciphertext', async () => {
    const key = await freshKey();
    const sealed = await seal(key, 'secret');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
    expect(await open(key, tampered)).toBeNull();
  });

  it('returns null for a malformed sealed blob', async () => {
    const key = await freshKey();
    expect(await open(key, 'enc:v1:only-one-part')).toBeNull();
  });
});
