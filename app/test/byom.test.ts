import { describe, expect, it } from 'vitest';
import { byomRef, byomSecretKey, normalizeBaseUrl, type ByomConnection } from '../src/lib/byom.js';
import { refKey, refName } from '../src/lib/stack.js';

const conn: ByomConnection = {
  id: 'abc',
  label: 'House model',
  baseUrl: 'https://host/v1',
  model: 'llama-3.1-70b',
};

describe('byom helpers', () => {
  it('scopes the secret key to the connection id', () => {
    expect(byomSecretKey('abc')).toBe('oscode.secret.byom.abc');
  });

  it('builds a stack ref that keys and names distinctly', () => {
    const ref = byomRef(conn);
    expect(ref.kind).toBe('byom');
    expect(refKey(ref)).toBe('byom:abc');
    expect(refName(ref)).toBe('House model');
  });

  it('normalizes a pasted base URL', () => {
    expect(normalizeBaseUrl('  https://host/v1/  ')).toBe('https://host/v1');
    expect(normalizeBaseUrl('https://host/v1/chat/completions')).toBe('https://host/v1');
    expect(normalizeBaseUrl('http://127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000/v1');
  });
});
