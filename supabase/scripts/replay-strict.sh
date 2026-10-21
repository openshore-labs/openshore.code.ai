#!/usr/bin/env bash
# The strict rebuild (CTO security review, 2026-10-21; CI job `sql-strict`).
#
#   bash supabase/scripts/replay-strict.sh
#
# Builds a scratch database from every file in supabase/migrations with NO
# default privileges for the Data API roles, then runs every
# supabase/tests/*.test.sql against it. From 2026-10-30 a Supabase database
# built afresh (a branch, `db reset` on a newer CLI) grants anon,
# authenticated and service_role nothing on a new table, so a migration that
# leaned on the old defaults works on production and fails on the next
# rebuild. Here it fails CI first: each table must get its grants from a
# migration (0032 restated every table's).
#
# It needs a plain PostgreSQL server (15 or later) reached through the usual
# PGHOST, PGPORT, PGUSER and PGPASSWORD, a superuser, with pgTAP installed and
# supabase/replay/strict/pg_cron.control and pg_cron--1.0.sql copied into the
# server's extension folder (a stand-in that runs nothing). The CI job does
# both. It never touches a Supabase project: it refuses a PGHOST that is not
# this machine.
#
# STRICT_DB names the scratch database (default oscode_strict); it is dropped
# and made again on every run.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
db="${STRICT_DB:-oscode_strict}"

case "${PGHOST:-}" in
  "" | localhost | 127.0.0.1 | ::1 | /*) ;;
  *)
    echo "replay-strict.sh: refusing PGHOST=$PGHOST; this runs only against a local scratch server." >&2
    exit 64
    ;;
esac
if ! [[ "$db" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "replay-strict.sh: STRICT_DB must be a plain lowercase name." >&2
  exit 64
fi

psql -X -q -v ON_ERROR_STOP=1 -d postgres \
  -c "drop database if exists $db" -c "create database $db" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$root/replay/strict/stubs.sql" >/dev/null

for f in "$root"/migrations/*.sql; do
  if ! out="$(psql -X -q -v ON_ERROR_STOP=1 --single-transaction -d "$db" -f "$f" 2>&1)"; then
    echo "FAIL: $(basename "$f") did not apply on a database with no default grants:" >&2
    echo "$out" | tail -20 >&2
    exit 1
  fi
done
echo "Applied $(ls "$root"/migrations/*.sql | wc -l) migrations with no default grants."

failed=0
for t in "$root"/tests/*.test.sql; do
  out="$(psql -X -d "$db" -f "$t" 2>&1 || true)"
  passed="$(echo "$out" | grep -cE '^\s*ok [0-9]+' || true)"
  bad="$(echo "$out" | grep -E '^\s*not ok|ERROR:|# Looks like' || true)"
  if [ -n "$bad" ]; then
    failed=1
    echo "FAIL: $(basename "$t") ($passed passed)"
    echo "$bad" | head -30
  else
    echo "ok: $(basename "$t") ($passed passed)"
  fi
done
exit "$failed"
