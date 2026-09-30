// supabase/scripts/local-vault.sh (CTO 11; the closure memo, item 6): the
// throwaway [db.vault] entry it appends to config.toml is safe only while the
// allowlist in front of it lets through nothing but commands that touch the
// LOCAL stack. The CLI reads `--linked=true`, `--linked=1` and the rest as
// --linked (2.118.0: "Expected true|yes|on|1|y|false|no|off|0|n"), and once
// only the bare spelling was refused (review 2026-09-30). Here the script runs
// for real, in a scratch copy of supabase/ with its own config.toml, against
// stand-in `supabase` and `npx` commands that print what they were given, so
// nothing here reaches a CLI, a network, or the repo's config.toml.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), '..', 'supabase', 'scripts', 'local-vault.sh');
const CONFIG = 'project_id = "scratch"\n';

let root: string;
let bin: string;
let config: string;

const STUB = `#!/usr/bin/env bash
echo "RAN: $(basename "$0") $*"
if grep -q '^\\[db\\.vault\\]' "$STUB_CONFIG"; then echo "VAULT: present"; fi
if [ -n "\${OSCODE_LOCAL_GUARDRAIL_HMAC_KEY:-}" ]; then echo "KEY: set"; fi
exit "\${STUB_EXIT:-0}"
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'local-vault-'));
  mkdirSync(join(root, 'supabase', 'scripts'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'supabase', 'scripts', 'local-vault.sh'));
  config = join(root, 'supabase', 'config.toml');
  writeFileSync(config, CONFIG);
  bin = join(root, 'bin');
  mkdirSync(bin);
  for (const name of ['supabase', 'npx']) {
    writeFileSync(join(bin, name), STUB);
    chmodSync(join(bin, name), 0o755);
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync('bash', [join(root, 'supabase', 'scripts', 'local-vault.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, STUB_CONFIG: config, ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

const argv = (line: string) => line.split(' ');

describe('local-vault.sh refuses anything that could reach a project', () => {
  for (const line of [
    // --linked in every spelling the CLI reads as --linked.
    'supabase db reset --linked',
    'supabase db reset --linked=true',
    'supabase db reset --linked=1',
    'supabase db reset --linked=yes',
    'supabase db reset --linked=on',
    'supabase db reset --linked=y',
    'supabase --linked=true db reset',
    'supabase db push --local --linked=true',
    // A push that is not marked local, or is unmarked again after.
    'supabase db push',
    'supabase db push --local --local=false',
    'supabase db push --local=1',
    'supabase db reset --local=no',
    // The other flags that name a project or another folder.
    'supabase db reset --db-url=postgres://example',
    'supabase db reset --db-url postgres://example',
    'supabase db start --project-ref=abc',
    'supabase db start --workdir=/elsewhere',
    'supabase db start --profile=other',
    // Commands outside the allowlist.
    'supabase migration repair 0019 --status reverted',
    'supabase migration list --local',
    'supabase functions deploy delete-account',
    'supabase db dump',
    'supabase link --project-ref abc',
    'npx --yes supabase@2.118.0 db pull',
    'npx --yes supabase@2.118.0 --agent no db push',
    'node something db start',
  ]) {
    it(`refuses: ${line}`, () => {
      const { code, out, err } = run(argv(line));
      expect(code).toBe(64);
      expect(out).not.toContain('RAN:');
      expect(err).toMatch(/refusing/);
      expect(readFileSync(config, 'utf8')).toBe(CONFIG);
    });
  }
});

describe('local-vault.sh runs the local commands with a throwaway key, then puts config.toml back', () => {
  for (const line of [
    'supabase db start',
    'supabase start -x studio,imgproxy',
    'supabase db reset',
    'supabase db reset --local',
    'supabase db push --local',
    'supabase db push --local=true --skip-vault',
    // The CLI's global flags that take a value, as the runbook's `sb` alias
    // writes them, no longer read as the subcommand.
    'npx --yes supabase@2.118.0 --agent no db start',
    'npx --yes supabase@2.118.0 --log-level warn db push --local',
    'supabase --output-format json db reset --local',
  ]) {
    it(`runs: ${line}`, () => {
      const { code, out } = run(argv(line));
      expect(code).toBe(0);
      expect(out).toContain(`RAN: ${line}`);
      expect(out).toContain('VAULT: present');
      expect(out).toContain('KEY: set');
      expect(readFileSync(config, 'utf8')).toBe(CONFIG);
    });
  }

  it("passes the command's exit code through, and still puts config.toml back", () => {
    const { code, out } = run(argv('supabase db start'), { STUB_EXIT: '3' });
    expect(code).toBe(3);
    expect(out).toContain('VAULT: present');
    expect(readFileSync(config, 'utf8')).toBe(CONFIG);
  });
});
