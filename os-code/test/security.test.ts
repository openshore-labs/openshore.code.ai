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
import {
  PermissionEngine,
  DEFAULT_PERMISSIONS,
  commandMatchesPrefix,
} from '../src/core/permissions/index.js';
import { minimatch } from '../src/core/util/minimatch.js';

describe('the jail', () => {
  it('resolves inside and refuses traversal out', () => {
    // realpath the root so the expectation matches the jail's own canonical
    // resolution. On macOS tmpdir() is under /var, a symlink to /private/var,
    // so the raw mkdtemp path and the jail's resolved path would differ.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'jail-')));
    const jail = new Jail(root);
    expect(jail.resolve('src/index.ts')).toBe(join(root, 'src/index.ts'));
    expect(() => jail.resolve('../outside.txt')).toThrow(JailViolation);
    expect(() => jail.resolve('/etc/passwd')).toThrow(JailViolation);
  });

  it('refuses symlink escapes', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'jail-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'outside-')));
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

  it('scrubs a JSON-quoted key the same as an assignment (ENG-9)', () => {
    const quoted = '"GITHUB_TOKEN": "abcdefghijklmnop1234"';
    expect(redactSecrets(quoted)).not.toContain('abcdefghijklmnop1234');
    expect(redactSecrets(quoted)).toContain('[redacted:assignment]');
    // And a whole JSON document with such a key still parses afterwards.
    const doc = JSON.stringify({ env: { GITHUB_TOKEN: 'abcdefghijklmnop1234', PORT: '3000' } });
    const clean = redactSecrets(doc);
    expect(clean).not.toContain('abcdefghijklmnop1234');
    const parsed = JSON.parse(clean) as { env: { GITHUB_TOKEN: string; PORT: string } };
    expect(parsed.env.PORT).toBe('3000');
    expect(parsed.env.GITHUB_TOKEN).toContain('[redacted:assignment]');
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

  it('drops credential headers and demotes a POST across a cross-origin redirect (ENG-16)', async () => {
    // Two listeners on 127.0.0.1 with different ports are different origins.
    // The first answers 303 to the second; the second records what arrived.
    let landed: { method?: string; headers: Record<string, string | string[] | undefined> } = {
      headers: {},
    };
    const target = createServer((req, res) => {
      landed = { method: req.method, headers: req.headers };
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const targetPort = (target.address() as AddressInfo).port;
    let firstAuth: string | undefined;
    const origin = createServer((req, res) => {
      firstAuth = req.headers.authorization;
      res.writeHead(303, { location: `http://127.0.0.1:${targetPort}/landing` });
      res.end();
    });
    await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
    try {
      const port = (origin.address() as AddressInfo).port;
      const policy = new EgressPolicy({ webEnabled: true, allowlist: [], blocklist: [] });
      const res = await policy.fetch(`http://127.0.0.1:${port}/start`, 'web-fetch', {
        method: 'POST',
        body: 'payload',
        headers: {
          authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
          'x-api-token': 'tok-1234567890abcdef',
          accept: 'text/plain',
        },
      });
      expect(res.status).toBe(200);
      expect(firstAuth).toBe('Bearer abcdefghijklmnopqrstuvwxyz');
      expect(landed.headers.authorization).toBeUndefined();
      expect(landed.headers['x-api-token']).toBeUndefined();
      expect(landed.headers.accept).toBe('text/plain');
      expect(landed.method).toBe('GET');
    } finally {
      await new Promise<void>((resolve) => origin.close(() => resolve()));
      await new Promise<void>((resolve) => target.close(() => resolve()));
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

  it('a config allow for shell never auto-runs on a restrictive profile (ENG-4)', () => {
    const rules = [{ tool: 'runShell', decision: 'allow' as const }];
    const phone = new PermissionEngine(
      { ...DEFAULT_PERMISSIONS, rules },
      PROFILES['remote-attached'],
    );
    expect(phone.decide({ toolName: 'runShell', risk: 'shell', command: 'ls' }).decision).toBe(
      'ask',
    );
    const desk = new PermissionEngine(
      { ...DEFAULT_PERMISSIONS, rules },
      PROFILES['local-interactive'],
    );
    expect(desk.decide({ toolName: 'runShell', risk: 'shell', command: 'ls' }).decision).toBe(
      'allow',
    );
    // A deny rule still applies everywhere.
    const denyRules = [{ tool: 'runShell', decision: 'deny' as const }];
    const phoneDeny = new PermissionEngine(
      { ...DEFAULT_PERMISSIONS, rules: denyRules },
      PROFILES['remote-attached'],
    );
    expect(phoneDeny.decide({ toolName: 'runShell', risk: 'shell', command: 'ls' }).decision).toBe(
      'deny',
    );
  });

  it('a commandPrefix rule matches every segment by its first word (ENG-4)', () => {
    const engine = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      rules: [{ tool: 'runShell', decision: 'allow', commandPrefix: 'npm' }],
    });
    const decide = (command: string) =>
      engine.decide({ toolName: 'runShell', risk: 'shell', command }).decision;
    expect(decide('npm test')).toBe('allow');
    expect(decide('npm run build && npm test')).toBe('allow');
    expect(decide('npm test; rm -rf /')).toBe('ask');
    expect(decide('npm test | sh')).toBe('ask');
    expect(decide('npm test $(cat secret)')).toBe('ask');
    expect(decide('npm test `cat secret`')).toBe('ask');
    expect(decide('NPM test')).toBe('ask');
    expect(decide('sudo npm test')).toBe('ask');
    expect(decide('env npm test')).toBe('ask');
    expect(decide('npmx test')).toBe('ask');
    // No command at all never matches a prefix rule.
    expect(engine.decide({ toolName: 'runShell', risk: 'shell' }).decision).toBe('ask');
    expect(commandMatchesPrefix('bash -c "npm test"', 'bash')).toBe(false);
    expect(commandMatchesPrefix('npm test\nnpm run lint', 'npm')).toBe(true);
  });

  it('a dotted spelling of a path cannot dodge a deny rule (ENG-3)', () => {
    const engine = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      rules: [{ tool: 'writeFile', decision: 'deny', pathGlob: 'secrets/**' }],
    });
    for (const path of ['secrets/k', './secrets/k', 'src/../secrets/k']) {
      expect(engine.decide({ toolName: 'writeFile', risk: 'write', path }).decision).toBe('deny');
    }
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
