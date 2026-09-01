// Security layer: the jail, redaction, egress, daemon auth, permissions, and
// profiles. These are the promises the product makes; they get tests.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Jail, JailViolation } from '../src/core/security/jail.js';
import { containsSecret, redactSecrets } from '../src/core/security/redaction.js';
import { EgressBlocked, EgressPolicy, isLocalHost } from '../src/core/security/egress.js';
import {
  assertSafeBind,
  bearerFrom,
  generateToken,
  tokenMatches,
} from '../src/core/security/daemonAuth.js';
import { PROFILES } from '../src/core/security/profiles.js';
import { PermissionEngine, DEFAULT_PERMISSIONS } from '../src/core/permissions/index.js';
import { minimatch } from '../src/core/util/minimatch.js';

describe('the jail', () => {
  it('resolves inside and refuses traversal out', () => {
    const root = mkdtempSync(join(tmpdir(), 'jail-'));
    const jail = new Jail(root);
    // Jail resolves its root through realpath (symlink-escape safety), so the
    // expectation must too: os.tmpdir() is itself a symlink on macOS
    // (/var -> /private/var), which the raw mkdtempSync() value is not.
    expect(jail.resolve('src/index.ts')).toBe(join(realpathSync(root), 'src/index.ts'));
    expect(() => jail.resolve('../outside.txt')).toThrow(JailViolation);
    expect(() => jail.resolve('/etc/passwd')).toThrow(JailViolation);
  });

  it('refuses symlink escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'jail-'));
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, join(root, 'sneaky'));
    const jail = new Jail(root);
    expect(() => jail.resolve('sneaky/secret.txt')).toThrow(JailViolation);
  });
});

describe('redaction', () => {
  it('scrubs the token shapes that matter', () => {
    const dirty = [
      'anthropic sk-ant-api03-abcdefghijklmnop',
      'github ghp_ABCDEFGHIJKLMNOPQRSTuvwx1234',
      'aws AKIAIOSFODNN7EXAMPLE',
      'header Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
      'API_KEY=super-secret-value-9000',
    ].join('\n');
    const clean = redactSecrets(dirty);
    expect(clean).not.toContain('sk-ant-api03');
    expect(clean).not.toContain('ghp_');
    expect(clean).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(clean).not.toContain('super-secret-value-9000');
    expect(clean).toContain('[redacted:');
    expect(containsSecret(dirty)).toBe(true);
    expect(containsSecret('nothing to see')).toBe(false);
  });

  it('never corrupts serialized JSON, even when a value ends in a secret (P0-5)', () => {
    const entries = [
      { seq: 1, event: { type: 'tool-result', text: 'run with API_TOKEN=abcd1234efgh' } },
      { seq: 2, event: { type: 'assistant-text', text: 'db PASSWORD=hunter2000000 and more' } },
      {
        seq: 3,
        event: { type: 'task-start', input: 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIexampleKEY' },
      },
    ];
    for (const entry of entries) {
      const line = redactSecrets(JSON.stringify(entry));
      // The redacted line is still valid JSON and re-parses to the same shape.
      const parsed = JSON.parse(line) as { seq: number };
      expect(parsed.seq).toBe(entry.seq);
    }
    // A quoted config value still has its secret scrubbed.
    expect(redactSecrets('API_KEY="super-secret-value"')).toContain('[redacted:assignment]');
    expect(redactSecrets('API_KEY="super-secret-value"')).not.toContain('super-secret-value');
  });
});

describe('egress policy', () => {
  it('always allows local endpoints, even with web off', () => {
    const off = new EgressPolicy({ webEnabled: false, allowlist: [], blocklist: [] });
    expect(off.check('http://localhost:11434/api/chat', 'web-fetch').allowed).toBe(true);
    expect(off.check('http://100.101.1.2:4816/health', 'web-fetch').allowed).toBe(true);
    expect(off.check('https://example.com', 'web-fetch').allowed).toBe(false);
  });

  it('allowlist narrows, blocklist wins', () => {
    const policy = new EgressPolicy({
      webEnabled: true,
      allowlist: ['example.com'],
      blocklist: ['bad.example.com'],
    });
    expect(policy.check('https://example.com/x', 'web-fetch').allowed).toBe(true);
    expect(policy.check('https://sub.example.com/x', 'web-fetch').allowed).toBe(true);
    expect(policy.check('https://bad.example.com/x', 'web-fetch').allowed).toBe(false);
    expect(policy.check('https://other.org/x', 'web-fetch').allowed).toBe(false);
  });

  it('recognizes bracketed and zone-scoped IPv6 loopback/link-local as local (P2-8)', () => {
    // WHATWG URL parsing keeps IPv6 literals bracketed and may carry a zone id;
    // both must be stripped or the loopback address reads as a remote host.
    expect(isLocalHost('[::1]')).toBe(true);
    expect(isLocalHost('[fe80::1%eth0]')).toBe(true);
    const off = new EgressPolicy({ webEnabled: false, allowlist: [], blocklist: [] });
    expect(off.check('http://[::1]:8080/x', 'web-fetch').allowed).toBe(true);
    expect(off.check('http://[fd00::1]/x', 'web-fetch').allowed).toBe(true);
  });

  it('re-checks every redirect hop and blocks a 3xx into a blocklisted host (D2)', async () => {
    // A bare fetch would follow the 302 to the blocklisted host itself. The
    // egress wrapper must re-run the policy on the redirect target and refuse.
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: 'http://blocked.invalid/secret' });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const policy = new EgressPolicy({
        webEnabled: true,
        allowlist: [],
        blocklist: ['blocked.invalid'],
      });
      await expect(
        policy.fetch(`http://127.0.0.1:${port}/start`, 'web-fetch'),
      ).rejects.toBeInstanceOf(EgressBlocked);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('daemon auth', () => {
  it('never binds every interface, no override', () => {
    expect(() => assertSafeBind('0.0.0.0')).toThrow(/Refusing/);
    expect(() => assertSafeBind('::')).toThrow();
    expect(() => assertSafeBind('127.0.0.1')).not.toThrow();
    expect(() => assertSafeBind('100.101.1.2')).not.toThrow();
  });

  it('tokens compare in constant time and parse from headers', () => {
    const token = generateToken();
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(`${token}x`, token)).toBe(false);
    expect(tokenMatches(undefined, token)).toBe(false);
    expect(bearerFrom(`Bearer ${token}`)).toBe(token);
    expect(bearerFrom('Basic abc')).toBeUndefined();
  });
});

describe('profiles and permissions', () => {
  it('remote profiles are stricter than sitting at the desk, never looser', () => {
    const desk = PROFILES['local-interactive'];
    const phone = PROFILES['remote-attached'];
    const headless = PROFILES.headless;
    expect(phone.allowShellAutoApprove).toBe(false);
    expect(phone.allowCloudAutoApprove).toBe(false);
    expect(phone.maxStepsCeiling).toBeLessThanOrEqual(desk.maxStepsCeiling);
    expect(headless.allowSessionAutoApprove).toBe(false);
  });

  it('session auto-approve for shell does not stick on the phone profile', () => {
    const engine = new PermissionEngine(DEFAULT_PERMISSIONS, PROFILES['remote-attached']);
    engine.allowForSession('runShell');
    const decision = engine.decide({ toolName: 'runShell', risk: 'shell' });
    expect(decision.decision).toBe('ask');
  });

  it('glob-scoped rules match writes precisely', () => {
    const engine = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      rules: [
        { tool: 'writeFile', decision: 'allow', pathGlob: 'src/**/*.ts' },
        { tool: 'writeFile', decision: 'deny', pathGlob: '**/*.env' },
      ],
    });
    expect(
      engine.decide({ toolName: 'writeFile', risk: 'write', path: 'src/a/b.ts' }).decision,
    ).toBe('allow');
    expect(
      engine.decide({ toolName: 'writeFile', risk: 'write', path: 'config/prod.env' }).decision,
    ).toBe('deny');
    expect(
      engine.decide({ toolName: 'writeFile', risk: 'write', path: 'README.md' }).decision,
    ).toBe('ask');
  });

  it('minimatch covers the subset the permission engine needs', () => {
    expect(minimatch('src/a/b.ts', 'src/**/*.ts')).toBe(true);
    expect(minimatch('src/b.ts', 'src/**/*.ts')).toBe(true);
    expect(minimatch('lib/b.ts', 'src/**/*.ts')).toBe(false);
    expect(minimatch('deep/path/x.env', '**/*.env')).toBe(true);
    expect(minimatch('a.json', '*.{json,yaml}')).toBe(true);
    expect(minimatch('name.test.ts', '*.test.ts')).toBe(true);
  });
});
