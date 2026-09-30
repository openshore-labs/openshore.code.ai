#!/usr/bin/env bash
# Run one Supabase CLI command against the LOCAL stack with a throwaway Vault
# secret (CTO 11, 2026-09-29).
#
#   bash supabase/scripts/local-vault.sh supabase db start
#   bash supabase/scripts/local-vault.sh npx --yes supabase@2.118.0 db start
#   bash supabase/scripts/local-vault.sh supabase db reset --local
#
# Why: 0019_account_deletion_and_guardrail_retention.sql reads the guardrail
# HMAC key from Supabase Vault by name and stops (by design) when it is
# missing, so a database built from empty needs a `guardrail_hmac_key` secret
# before that file runs. The CLI creates the secrets named under [db.vault] in
# config.toml before it applies migrations.
#
# Why the entry is never committed: `supabase db push` upserts every resolved
# Vault secret from config.toml before migrations (2.118.0: "Vault secrets from
# config.toml are updated before migrations unless --skip-vault is set"). A
# committed entry with the variable set would silently rotate production's key
# and break the link between old and new fingerprints. So this script adds the
# entry for one command only, with a fresh random key, and puts config.toml
# back on exit, whatever happens. Every push command in the README and the
# runbook carries --skip-vault as well.
#
# What it runs: an allowlist. Only the commands that apply migrations to the
# LOCAL stack pass: `start`, `db start`, `db reset` (local; --linked and
# --db-url are refused) and `db push --local`. Everything else is refused
# before anything runs, whatever it is (`db pull`, `pull`, `migration repair`,
# `migration list`, `db dump`, `inspect`, `link`, `functions`, `secrets` and
# the rest), and so is any flag that names a project or another supabase/
# folder (--linked, --db-url, --project-ref, --project-id, --workdir,
# --profile) in every spelling: the CLI reads `--linked=true`, `--linked=1`
# and the like as --linked, so every argument that starts with one of those
# names is refused. The only spellings that mark the local stack are
# `--local` and `--local=true`; any other `--local=<value>` is refused, since
# the CLI takes the last one it reads and `--local=false` after `--local`
# would push to the linked project. The subcommand is the first word after
# the launcher (`supabase`, `npx [--yes] supabase@<version>`, or a path ending
# in /supabase), past the CLI's global flags and the values of the ones that
# take one (`--agent no`, `--log-level warn`, the runbook's `sb` alias); an
# unknown launcher is refused too. Guard: app/test/localVaultScript.test.ts.
set -euo pipefail

refuse() {
  echo "local-vault.sh: refusing $1. This script runs only start, db start, db reset and db push --local, against the local stack." >&2
  exit 64
}

if [ "$#" -eq 0 ]; then
  echo "usage: bash supabase/scripts/local-vault.sh <supabase command...>" >&2
  exit 64
fi

local_flag=0
for arg in "$@"; do
  case "$arg" in
    --linked* | --db-url* | --project-ref* | --project-id* | --workdir* | --profile*)
      refuse "'$arg'"
      ;;
    --local | --local=true) local_flag=1 ;;
    --local=*) refuse "'$arg' (only --local or --local=true names the local stack)" ;;
  esac
done

# The CLI's own subcommand and the word after it, past the launcher, its
# global flags, and the value of each global flag that takes one as a
# separate word (2.118.0's --help, GLOBAL FLAGS).
launcher=1
value_next=0
top=""
sub=""
for arg in "$@"; do
  if [ "$launcher" -eq 1 ]; then
    case "$arg" in
      npx | --yes | -y | supabase | supabase@* | */supabase) continue ;;
    esac
    launcher=0
  fi
  if [ "$value_next" -eq 1 ]; then
    value_next=0
    continue
  fi
  case "$arg" in
    --agent | --completions | --dns-resolver | --log-level | --network-id | --output | -o | --output-format)
      value_next=1
      continue
      ;;
    -*) continue ;;
  esac
  if [ -z "$top" ]; then
    top="$arg"
  elif [ -z "$sub" ]; then
    sub="$arg"
    break
  fi
done

case "$top $sub" in
  "start "* | "db start" | "db reset") ;;
  "db push")
    if [ "$local_flag" -eq 0 ]; then
      refuse "'db push' without --local (it targets the linked project)"
    fi
    ;;
  *) refuse "'$top${sub:+ $sub}'" ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config="$here/../config.toml"
if [ ! -f "$config" ]; then
  echo "local-vault.sh: no config.toml at $config" >&2
  exit 66
fi
if grep -Eq '^\[db\.vault\]' "$config"; then
  echo "local-vault.sh: $config already has a [db.vault] section. It must never be committed; remove it first." >&2
  exit 65
fi

backup="$(mktemp)"
cp "$config" "$backup"
restore() {
  cp "$backup" "$config"
  rm -f "$backup"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

OSCODE_LOCAL_GUARDRAIL_HMAC_KEY="$(openssl rand -hex 32)"
export OSCODE_LOCAL_GUARDRAIL_HMAC_KEY

cat >>"$config" <<'TOML'

# Added by supabase/scripts/local-vault.sh for one local command. Never commit.
[db.vault]
guardrail_hmac_key = "env(OSCODE_LOCAL_GUARDRAIL_HMAC_KEY)"
TOML

"$@"
