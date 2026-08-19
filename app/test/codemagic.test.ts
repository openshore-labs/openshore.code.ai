// The two stages that protect the user before a build log reaches a model:
// redaction must remove secrets, extraction must surface the failure without
// dumping the whole log. These are safety-critical, so pin them.
import { describe, expect, it } from 'vitest';
import { extractErrors, isTerminal, logArtifacts, redactLog } from '../src/lib/codemagic.js';

describe('codemagic redaction', () => {
  it('strips PEM key blocks', () => {
    const log = 'before\n-----BEGIN PRIVATE KEY-----\nMIIEv...secret...\n-----END PRIVATE KEY-----\nafter';
    const out = redactLog(log);
    expect(out).not.toContain('secret');
    expect(out).toContain('[redacted key block]');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('strips JWTs and bearer tokens', () => {
    const log = 'auth Bearer abc.def.ghi\nJWT eyJhbGciOi.eyJzdWIiOi.s3cr3tSignature';
    const out = redactLog(log);
    expect(out).not.toContain('s3cr3tSignature');
    expect(out.toLowerCase()).toContain('[redacted');
  });

  it('strips named secrets like CERTIFICATE_PRIVATE_KEY', () => {
    const out = redactLog('CERTIFICATE_PRIVATE_KEY=MIIsupersecretvalue\nAPP_STORE_TOKEN: xyz123');
    expect(out).not.toContain('supersecretvalue');
    expect(out).not.toContain('xyz123');
  });

  it('strips provisioning UUIDs', () => {
    const out = redactLog('profile 12345678-90ab-cdef-1234-567890abcdef installed');
    expect(out).toContain('[redacted uuid]');
    expect(out).not.toContain('567890abcdef');
  });

  it('strips a plain opaque bearer token in an auth header', () => {
    const out = redactLog('curl -H "Authorization: Bearer abc123opaquetoken456xyz"');
    expect(out).not.toContain('abc123opaquetoken456xyz');
  });

  it('strips a standalone bearer token', () => {
    const out = redactLog('using Bearer sk-opaque-value-not-a-jwt here');
    expect(out).not.toContain('sk-opaque-value-not-a-jwt');
    expect(out).toContain('Bearer [redacted]');
  });
});

describe('codemagic extraction', () => {
  it('surfaces error regions and drops noise', () => {
    const lines = [];
    for (let i = 0; i < 200; i++) lines.push(`noise line ${i}`);
    lines[120] = 'error: Code Sign failed for target App';
    const excerpt = extractErrors(lines.join('\n'));
    expect(excerpt).toContain('Code Sign failed');
    expect(excerpt.length).toBeLessThan(lines.join('\n').length);
  });

  it('caps the excerpt length', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `error: line ${i}`).join('\n');
    const excerpt = extractErrors(big, { maxChars: 2000 });
    expect(excerpt.length).toBeLessThanOrEqual(2010);
  });

  it('falls back to the tail when there is no error signal', () => {
    const excerpt = extractErrors('all\nquiet\nhere\nnothing\nwrong');
    expect(excerpt).toContain('wrong');
  });
});

describe('codemagic helpers', () => {
  it('knows terminal statuses', () => {
    expect(isTerminal('finished')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('building')).toBe(false);
  });

  it('picks log artifacts', () => {
    const arts = [
      { name: 'app.ipa' },
      { name: 'xcodebuild_build.log' },
      { name: 'flutter_drive.log' },
    ];
    expect(logArtifacts(arts).map((a) => a.name)).toEqual([
      'xcodebuild_build.log',
      'flutter_drive.log',
    ]);
  });
});
