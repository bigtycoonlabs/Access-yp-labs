#!/usr/bin/env bash
# Rebuild the schema from version control, in an order that actually works.
#
# Usage: DATABASE_URL=postgres://... bash scripts/migrate.sh
#
# Stops at the first real failure rather than continuing and leaving a half-built schema that looks
# fine until something reads a missing table.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ORDER="$DIR/docs/migrations/ORDER.txt"
: "${DATABASE_URL:?set DATABASE_URL}"

echo "extensions first — uuid_generate_v4() is used by the earliest tables and is not built in"
psql "$DATABASE_URL" -q -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pgcrypto;' || exit 1
psql "$DATABASE_URL" -q -c 'CREATE SCHEMA IF NOT EXISTS yp_labs;' || exit 1

fails=0
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  f="$DIR/docs/migrations/$line"
  [ -f "$f" ] || { echo "MISSING: $line"; fails=$((fails+1)); continue; }
  out=$(PGOPTIONS="--search_path=yp_labs,public" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1)
  if [ $? -ne 0 ]; then
    echo "FAILED: $line"
    echo "$out" | grep -i error | head -2
    fails=$((fails+1))
  fi
done < "$ORDER"

if [ "$fails" -ne 0 ]; then
  echo ""
  echo "$fails migration(s) failed. The schema is incomplete — do not treat this as a restore."
  exit 1
fi
n=$(psql "$DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='yp_labs'")
echo "schema rebuilt: $n tables."
