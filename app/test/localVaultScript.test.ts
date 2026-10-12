// supabase/scripts/local-vault.sh (CTO 11; the closure memo, item 6): the
// throwaway [db.vault] entry it appends to config.toml is safe only while the
// allowlist in front of it lets through nothing but commands that touch the
// LOCAL stack. The CLI reads `--linked=true`, `--linked=1` and the rest as
// --linked (2.118.0: "Expected true|yes|on|1|y|false|no|off|0|n"), and once
// only the bare spelling was refused (review 2026-09-30). On 2.118.0 a target
// flag counts once given, whatever its value, so `--linked=false` targets the
// linked project too. The second review (2026-09-30) closed the rest: the
// wizard, a bare `--`, and any flag before the subcommand that is not one of
// the CLI's global flags. Here the script runs for real, in a scratch copy of
// supabase/ with its own config.toml, against stand-in `supabase` and `npx`
// commands that print what they were given, so nothing here reaches a CLI, a
// network, or the repo's config.toml. The last block runs every use the
// README and CI document, read from those files.
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
    'supabase db reset --linked=false',
    'supabase db push --local --linked=false',
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
    // The wizard, in every spelling, anywhere: it asks its own questions.
    'supabase --wizard db start',
    'supabase db start --wizard',
    'supabase db reset --local --wizard=true',
    'supabase db push --local --wizard=1',
    'npx --yes supabase@2.118.0 --agent no --wizard db start',
    // --no-<flag> anywhere: 2.118.0 reads --no-linked as --linked and
    // --no-wizard as --wizard.
    'supabase db reset --no-linked',
    'supabase --yes db reset --no-linked',
    'npx --yes supabase@2.118.0 --agent no db reset --no-linked',
    'supabase db push --local --no-linked',
    'supabase db start --no-wizard',
    'supabase start --no-wizard',
    'supabase db reset --local --no-wizard',
    'supabase db reset --no-local',
    // A bare -- anywhere.
    'supabase -- db start',
    'supabase db start --',
    'supabase db push --local -- --linked',
    'npx --yes supabase@2.118.0 -- db reset',
    // Before the subcommand, only the CLI's global flags: an unknown flag
    // could take the next word as its value and hide the real subcommand.
    'supabase --unknown db start',
    'supabase --x db push --local',
    'supabase -y db start',
    'supabase --yes=true db start',
    'supabase --help db start',
    'supabase --version db start',
    'supabase -v db start',
    'supabase db --unknown start',
    'supabase db --dry-run push --local',
    'npx --yes supabase@2.118.0 --agent no --unknown db start',
    // A value-taking global flag with nothing after it.
    'supabase --log-level',
    // Launchers that are not the CLI.
    'npx node db start',
    'npx --yes',
    'supabase@2.118.0 db start',
    'pnpm exec supabase db start',
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
    // The CLI's global flags that take a value, as the maintainer gate 1
    // runbook's `sb` alias writes them, no longer read as the subcommand.
    'npx --yes supabase@2.118.0 --agent no db start',
    'npx --yes supabase@2.118.0 --log-level warn db push --local',
    'supabase --output-format json db reset --local',
    // Every 2.118.0 global flag, before the subcommand and between db and
    // its own, both spellings for the ones that take a value.
    'npx -y supabase db start',
    'supabase --agent=no --log-level=warn db start',
    'supabase --completions bash --dns-resolver https --network-id net1 db start',
    'supabase --output json -o env --output-format=text db reset --local',
    'supabase -o=json --output=pretty db push --local',
    'supabase --debug --experimental --yes --create-ticket db start',
    'supabase db --debug --log-level warn reset',
    // After the subcommand, the command's own flags are its own.
    'supabase db push --local --dry-run --skip-vault --yes',
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

/** Every `bash supabase/scripts/local-vault.sh ...` the repo documents, as it
 *  is written: the README (a use may wrap across lines inside one backtick
 *  span) and CI. */
function documentedUses(): string[] {
  const repo = join(process.cwd(), '..');
  const uses = new Set<string>();
  for (const file of [join('supabase', 'README.md'), join('.github', 'workflows', 'ci.yml')]) {
    const text = readFileSync(join(repo, file), 'utf8')
      // An inline code span wrapped across two lines reads as one line.
      .replace(/`([^`\n]+)\n\s*([^`\n]+)`/g, '`$1 $2`');
    for (const m of text.matchAll(/bash supabase\/scripts\/local-vault\.sh ([^`\n]+)/g)) {
      uses.add(m[1].trim());
    }
  }
  return [...uses];
}

describe('local-vault.sh runs every documented use', () => {
  const uses = documentedUses();

  it('finds the uses the README and CI document', () => {
    expect(uses).toEqual(
      expect.arrayContaining([
        'supabase db start',
        'supabase db reset --local',
        'npx --yes supabase@2.118.0 db start',
        'npx --yes supabase@2.118.0 db reset --local',
      ]),
    );
  });

  for (const line of uses) {
    it(`runs: ${line}`, () => {
      const { code, out } = run(argv(line));
      expect(code).toBe(0);
      expect(out).toContain(`RAN: ${line}`);
      expect(out).toContain('VAULT: present');
      expect(readFileSync(config, 'utf8')).toBe(CONFIG);
    });
  }
});
