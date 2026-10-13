#!/usr/bin/env bash
# Run one Supabase CLI command against the LOCAL stack with a throwaway Vault
# secret (tech review 11, 2026-09-29).
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
# --profile) in every spelling. On 2.118.0 a target flag counts once it is
# given, whatever its value (checked offline, in a folder linked to nothing:
# `db push --linked=false --dry-run` looks for the linked project, and
# `db push --local=false --dry-run` connects to the local database), so
# `--linked=false` targets the linked project just as `--linked` does, and
# every argument that starts with one of those names is refused. The only
# spellings that mark the local stack are `--local` and `--local=true`; any
# other `--local=<value>` is refused too, so what a command says and what it
# does never differ. Refused anywhere as well: `--wizard` in any spelling
# (it asks its own questions after this check), a bare `--` (the words
# after it are not read as flags here, whatever the CLI makes of them), and
# every `--no-<flag>`: 2.118.0 reads `--no-linked` as `--linked` and
# `--no-wizard` as `--wizard` (checked offline, in a folder linked to
# nothing), and no local use needs one.
#
# The subcommand is the first word after the launcher (`supabase`,
# `npx [--yes|-y] supabase` or `npx [--yes|-y] supabase@<version>`, or a path
# ending in /supabase; any other launcher is refused). Before it, and between
# `db` and its own subcommand, only 2.118.0's global flags may stand (its
# --help, GLOBAL FLAGS): --agent, --completions, --dns-resolver, --log-level,
# --network-id, --output or -o, and --output-format, each with its value as
# the next word or after `=` (the runbook's `sb` alias writes `--agent no`);
# and --debug, --experimental, --yes and --create-ticket, bare. Any other flag
# there is refused, so a flag the CLI would read as taking the next word can
# never hide the real subcommand from this check. Guard:
# app/test/localVaultScript.test.ts.
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
    --)
      refuse "a bare '--' (what follows it is not checked as flags here)"
      ;;
    --no-*)
      refuse "'$arg' (2.118.0 reads --no-<flag> as the flag being given)"
      ;;
    --wizard*)
      refuse "'$arg' (wizard mode asks its own questions after this check)"
      ;;
    --linked* | --db-url* | --project-ref* | --project-id* | --workdir* | --profile*)
      refuse "'$arg'"
      ;;
    --local | --local=true) local_flag=1 ;;
    --local=*) refuse "'$arg' (only --local or --local=true names the local stack)" ;;
  esac
done

# The launcher: supabase, npx [--yes|-y] supabase[@<version>], or a path
# ending in /supabase.
args=("$@")
n=${#args[@]}
i=0
case "${args[0]}" in
  npx)
    i=1
    while [ "$i" -lt "$n" ] && { [ "${args[$i]}" = --yes ] || [ "${args[$i]}" = -y ]; }; do
      i=$((i + 1))
    done
    case "${args[$i]:-}" in
      supabase | supabase@*) i=$((i + 1)) ;;
      *) refuse "'${args[*]:0:$((i + 1))}' (the launcher is supabase, npx [--yes] supabase@<version>, or a path ending in /supabase)" ;;
    esac
    ;;
  supabase | */supabase) i=1 ;;
  *) refuse "'${args[0]}' (the launcher is supabase, npx [--yes] supabase@<version>, or a path ending in /supabase)" ;;
esac

# The CLI's own subcommand and, after `db`, the word after it. Only 2.118.0's
# global flags may stand before them, with the value of each one that takes
# a value (the next word, or after `=`).
top=""
sub=""
while [ "$i" -lt "$n" ]; do
  arg="${args[$i]}"
  i=$((i + 1))
  case "$arg" in
    --agent | --completions | --dns-resolver | --log-level | --network-id | --output | -o | --output-format)
      if [ "$i" -ge "$n" ]; then
        refuse "'$arg' with no value"
      fi
      i=$((i + 1))
      continue
      ;;
    --agent=* | --completions=* | --dns-resolver=* | --log-level=* | --network-id=* | --output=* | -o=* | --output-format=*)
      continue
      ;;
    --debug | --experimental | --yes | --create-ticket)
      continue
      ;;
    -*)
      refuse "'$arg' before the subcommand (only the CLI's global flags go there)"
      ;;
  esac
  if [ -z "$top" ]; then
    top="$arg"
    if [ "$top" != db ]; then
      break
    fi
  else
    sub="$arg"
    break
  fi
done

case "$top $sub" in
  "start " | "db start" | "db reset") ;;
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
