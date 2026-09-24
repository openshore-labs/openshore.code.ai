import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAIN_ERROR_FALLBACK, PlainError, plainError } from '../src/lib/plainError.js';

describe('plainError', () => {
  it('reads the network failures as the fallback line', () => {
    expect(PLAIN_ERROR_FALLBACK).toBe(
      'That did not go through. Check your connection and try again.',
    );
    expect(plainError(new TypeError('Failed to fetch'))).toBe(PLAIN_ERROR_FALLBACK);
    expect(plainError(new TypeError('Load failed'))).toBe(PLAIN_ERROR_FALLBACK);
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    expect(plainError(abort)).toBe(PLAIN_ERROR_FALLBACK);
  });

  it('maps known sign-in errors to plain lines', () => {
    expect(plainError(new Error('Invalid login credentials'))).toMatch(/do not match/);
    expect(plainError(new Error('Email not confirmed'))).toMatch(/Confirm your email/);
    expect(plainError(new Error('User already registered'))).toMatch(/already has an account/);
    expect(plainError(new Error('Email rate limit exceeded'))).toMatch(/Too many tries/);
  });

  it('maps a missing repository', () => {
    expect(plainError(new Error('remote: Repository not found.\nfatal: ...'))).toMatch(
      /repository was not found/,
    );
  });

  it('never shows an unknown raw message', () => {
    expect(plainError(new Error('Request failed (500).'))).toBe(PLAIN_ERROR_FALLBACK);
    expect(plainError(new Error('ECONNRESET at Socket.onEnd (node:net:123)'))).toBe(
      PLAIN_ERROR_FALLBACK,
    );
    expect(plainError(undefined)).toBe(PLAIN_ERROR_FALLBACK);
    expect(plainError({ weird: true })).toBe(PLAIN_ERROR_FALLBACK);
  });

  it('passes our own plain copy through', () => {
    expect(plainError(new PlainError('Connect your desktop first; repos live there.'))).toBe(
      'Connect your desktop first; repos live there.',
    );
  });

  it('the swept screens toast through it, never a raw err.message', () => {
    for (const f of [
      '../src/components/SignInCard.tsx',
      '../src/screens/ReposScreen.tsx',
      '../src/screens/ChatsScreen.tsx',
    ]) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/showToast\(err instanceof Error \? err\.message/);
      expect(src, f).toMatch(/plainError\(err\)/);
    }
  });
});
