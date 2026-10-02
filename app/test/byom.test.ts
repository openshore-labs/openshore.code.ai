import { describe, expect, it } from 'vitest';
import {
  BYOM_DEFAULT_CONTEXT_TOKENS,
  byomHost,
  byomRef,
  byomSecretKey,
  normalizeBaseUrl,
  type ByomConnection,
} from '../src/lib/byom.js';
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

  it('reads the host a base URL points at, or none', () => {
    expect(byomHost('https://gpu.tail1234.ts.net/v1')).toBe('gpu.tail1234.ts.net');
    expect(byomHost('localhost:11434/v1')).toBe('localhost');
    expect(byomHost('http://[::1]:8080/v1')).toBe('[::1]');
    expect(byomHost('')).toBeUndefined();
    expect(byomHost('http://')).toBeUndefined();
  });

  it('assumes an 8k window when the connection names none (CTO J4)', () => {
    expect(BYOM_DEFAULT_CONTEXT_TOKENS).toBe(8192);
  });
});

describe('plain http only to your own hosts (CTO review 2026-10-01)', () => {
  it('refuses plain http to a public server and allows it at home', async () => {
    const { byomPlainHttpToCloud } = await import('../src/lib/byom.js');
    expect(byomPlainHttpToCloud('http://api.example.com/v1')).toBe(true);
    expect(byomPlainHttpToCloud('https://api.example.com/v1')).toBe(false);
    expect(byomPlainHttpToCloud('http://192.168.1.20:11434/v1')).toBe(false);
    expect(byomPlainHttpToCloud('http://localhost:11434/v1')).toBe(false);
  });
});
