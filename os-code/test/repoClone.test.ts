// Cloning with a connected platform's token, and listing what is on this
// computer. The token must reach git for the one clone, scoped to the
// platform's host, and nowhere else: not the process arguments, not the
// clone's .git/config, not an error a person reads. A stub `git` on PATH
// records what it was handed, so this runs without a network or a real host.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clone, cloneAuthHeader, redactToken } from '../src/git/index.js';
import {
  cloneFolderName,
  cloneIntoManaged,
  listWorkspaces,
  normalizeRemote,
  originUrl,
  stripCredentials,
} from '../src/git/workspaces.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('the one-shot auth header', () => {
  it('names the user each platform expects with a token, scoped to its host', () => {
    expect(cloneAuthHeader('https://github.com/o/r.git', 'ghu_tok')).toEqual({
      key: 'http.https://github.com/.extraheader',
      value: `Authorization: Basic ${b64('x-access-token:ghu_tok')}`,
    });
    expect(cloneAuthHeader('https://gitlab.com/g/sub/r.git', 'glpat')?.value).toBe(
      `Authorization: Basic ${b64('oauth2:glpat')}`,
    );
    expect(cloneAuthHeader('https://bitbucket.org/w/r.git', 'oauth_tok')?.value).toBe(
      `Authorization: Basic ${b64('x-token-auth:oauth_tok')}`,
    );
    // An Atlassian API token arrives as email:token; git takes the token alone
    // under Bitbucket's static API-token user.
    expect(cloneAuthHeader('https://bitbucket.org/w/r.git', 'me@x.com:ATATT')?.value).toBe(
      `Authorization: Basic ${b64('x-bitbucket-api-token-auth:ATATT')}`,
    );
  });

  it('never builds a header for another host, plain http, embedded credentials, or a port', () => {
    for (const url of [
      'https://example.com/o/r.git',
      'https://github.com.evil.example/o/r.git',
      'http://github.com/o/r.git',
      'https://me@github.com/o/r.git',
      'https://github.com:8443/o/r.git',
      'git@github.com:o/r.git',
    ]) {
      expect(cloneAuthHeader(url, 'tok'), url).toBeUndefined();
    }
    expect(cloneAuthHeader('https://github.com/o/r.git', 'a\nb')).toBeUndefined();
    expect(cloneAuthHeader('https://github.com/o/r.git', '  ')).toBeUndefined();
  });

  it('redacts the token and its header form from text a person reads', () => {
    const text = `fatal: ghu_tok and ${b64('x-access-token:ghu_tok')} leaked`;
    expect(redactToken(text, 'ghu_tok')).toBe('fatal: [token] and [token] leaked');
    expect(redactToken('nothing here', undefined)).toBe('nothing here');
  });
});

describe('workspace helpers', () => {
  it('strips credentials from an origin and compares https and ssh as one repository', () => {
    expect(stripCredentials('https://x-access-token:ghu_tok@github.com/o/r.git')).toBe(
      'https://github.com/o/r.git',
    );
    expect(stripCredentials('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
    expect(normalizeRemote('https://github.com/O/R.git')).toBe('github.com/o/r');
    expect(normalizeRemote('git@github.com:o/r.git')).toBe('github.com/o/r');
    expect(normalizeRemote('ssh://git@github.com/o/r')).toBe('github.com/o/r');
  });

  it('names the clone folder from the address, refusing . and .. (DAE-16)', () => {
    expect(cloneFolderName('https://github.com/o/openshore-hq.git')).toBe('openshore-hq');
    expect(cloneFolderName('https://github.com/o/site/')).toBe('site');
    expect(cloneFolderName('https://github.com/o/..')).toBeUndefined();
    expect(cloneFolderName('https://github.com/o/.git')).toBeUndefined();
  });
});

// Linux and macOS: a shell script stands in for git.
const posix = process.platform !== 'win32';

describe.skipIf(!posix)('clone and the managed folder, against a stub git', () => {
  let home: string;
  let out: string;
  const realHome = process.env.HOME;
  const realPath = process.env.PATH;
  // The ambient git config env (a CI box or this sandbox may set some) is set
  // aside so each test sees only what clone() adds; one test puts some back.
  const ambient = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)),
  );

  beforeEach(() => {
    for (const k of Object.keys(ambient)) delete process.env[k];
    home = mkdtempSync(join(tmpdir(), 'osc-clone-home-'));
    out = mkdtempSync(join(tmpdir(), 'osc-clone-out-'));
    const bin = join(out, 'bin');
    mkdirSync(bin);
    // Records its arguments and GIT_* environment, counts runs, then writes a
    // clone with the address as origin (args: clone -- <url> <dir>). With
    // STUB_FAIL set it fails the way git does, echoing that text.
    writeFileSync(
      join(bin, 'git'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@" > "$STUB_OUT/args"',
        'env | grep "^GIT_" > "$STUB_OUT/env"',
        'n=$(cat "$STUB_OUT/count" 2>/dev/null || echo 0); echo $((n+1)) > "$STUB_OUT/count"',
        'if [ -n "$STUB_FAIL" ]; then echo "Cloning into x..." >&2; echo "fatal: $STUB_FAIL" >&2; exit 128; fi',
        'sleep 0.2',
        'mkdir -p "$4/.git"',
        'printf "[core]\\n\\tbare = false\\n[remote \\"origin\\"]\\n\\turl = %s\\n" "$3" > "$4/.git/config"',
      ].join('\n'),
    );
    chmodSync(join(bin, 'git'), 0o755);
    process.env.HOME = home;
    process.env.PATH = `${bin}:${realPath}`;
    process.env.STUB_OUT = out;
    delete process.env.STUB_FAIL;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)) delete process.env[k];
    }
    Object.assign(process.env, ambient);
    process.env.HOME = realHome;
    process.env.PATH = realPath;
    delete process.env.STUB_OUT;
    delete process.env.STUB_FAIL;
    rmSync(home, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('hands git the token through its environment, never its arguments or the clone config', async () => {
    const dir = join(home, 'r');
    await clone('https://github.com/o/r.git', dir, { token: 'ghu_secret' });
    const args = readFileSync(join(out, 'args'), 'utf8');
    const env = readFileSync(join(out, 'env'), 'utf8');
    expect(args).toBe(`clone\n--\nhttps://github.com/o/r.git\n${dir}\n`);
    expect(args).not.toContain('ghu_secret');
    expect(env).toContain('GIT_TERMINAL_PROMPT=0');
    expect(env).toContain('GIT_CONFIG_COUNT=1');
    expect(env).toContain('GIT_CONFIG_KEY_0=http.https://github.com/.extraheader');
    expect(env).toContain(
      `GIT_CONFIG_VALUE_0=Authorization: Basic ${b64('x-access-token:ghu_secret')}`,
    );
    const config = readFileSync(join(dir, '.git', 'config'), 'utf8');
    expect(config).not.toContain('ghu_secret');
    expect(config).not.toContain(b64('x-access-token:ghu_secret'));
  });

  it('appends to git config the environment already carries, never replacing it', async () => {
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'credential.interactive';
    process.env.GIT_CONFIG_VALUE_0 = 'false';
    await clone('https://github.com/o/r.git', join(home, 'r'), { token: 'ghu_secret' });
    const env = readFileSync(join(out, 'env'), 'utf8');
    expect(env).toContain('GIT_CONFIG_COUNT=2');
    expect(env).toContain('GIT_CONFIG_KEY_0=credential.interactive');
    expect(env).toContain('GIT_CONFIG_KEY_1=http.https://github.com/.extraheader');
  });

  it('sends no token for an address off the platform host, and still never prompts', async () => {
    await clone('https://example.com/o/r.git', join(home, 'r'), { token: 'ghu_secret' });
    const env = readFileSync(join(out, 'env'), 'utf8');
    expect(env).not.toContain('GIT_CONFIG_KEY_0');
    expect(env).toContain('GIT_TERMINAL_PROMPT=0');
  });

  it('keeps the token out of a failure a person reads', async () => {
    process.env.STUB_FAIL = 'Authentication failed for ghu_secret';
    await expect(
      clone('https://github.com/o/r.git', join(home, 'r'), { token: 'ghu_secret' }),
    ).rejects.toThrow('fatal: Authentication failed for [token]');
  });

  it('clones into ~/OSCode once, even when asked twice at the same time', async () => {
    const url = 'https://github.com/o/openshore-hq.git';
    const [a, b] = await Promise.all([
      cloneIntoManaged(url, 'openshore-hq', { token: 't' }),
      cloneIntoManaged(url, 'openshore-hq', { token: 't' }),
    ]);
    expect(a).toBe(join(home, 'OSCode', 'openshore-hq'));
    expect(b).toBe(a);
    expect(readFileSync(join(out, 'count'), 'utf8').trim()).toBe('1');
    // Asked again later, the clone already there is the answer (ssh or https).
    expect(await cloneIntoManaged('git@github.com:o/openshore-hq.git', 'openshore-hq')).toBe(a);
    expect(readFileSync(join(out, 'count'), 'utf8').trim()).toBe('1');
  });

  it('refuses a folder of that name that holds a different repository', async () => {
    const dir = join(home, 'OSCode', 'site', '.git');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'config'),
      '[remote "origin"]\n\turl = https://github.com/someone-else/site.git\n',
    );
    await expect(cloneIntoManaged('https://github.com/o/site.git', 'site')).rejects.toThrow(
      /A different repository already uses the folder OSCode\/site/,
    );
    expect(existsSync(join(out, 'count'))).toBe(false);
  });

  it('lists recent folders first, then every clone under ~/OSCode, each with its origin', () => {
    const recent = join(home, 'work', 'app');
    mkdirSync(recent, { recursive: true });
    const managed = join(home, 'OSCode', 'hq', '.git');
    mkdirSync(managed, { recursive: true });
    writeFileSync(
      join(managed, 'config'),
      '[remote "upstream"]\n\turl = https://github.com/up/hq.git\n[remote "origin"]\n\turl = https://x-access-token:ghu_leak@github.com/o/hq.git\n',
    );
    mkdirSync(join(home, 'OSCode', '.hidden', '.git'), { recursive: true });
    // The Vault and the desktop's scratch folder share ~/OSCode; not repositories.
    mkdirSync(join(home, 'OSCode', 'Vault'), { recursive: true });
    mkdirSync(join(home, 'OSCode', 'scratch'), { recursive: true });
    const rows = listWorkspaces([
      { cwd: recent, updatedAt: '2026-09-25T00:00:00Z' },
      { cwd: join(home, 'gone') },
    ]);
    expect(rows).toEqual([
      { cwd: recent, name: 'app', lastUsed: '2026-09-25T00:00:00Z' },
      { cwd: join(home, 'OSCode', 'hq'), name: 'hq', remote: 'https://github.com/o/hq.git' },
    ]);
    expect(originUrl(recent)).toBeUndefined();
  });
});
