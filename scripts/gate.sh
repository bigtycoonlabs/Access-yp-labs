#!/usr/bin/env bash
# THE GATE. Run this before pushing — and read what it says.
#
# It exists because "I ran the tests" and "the tests passed" are different sentences, and I have
# conflated them. A suite reporting 400 of 401 scrolls past looking like success. This exits
# non-zero on any failure, so it cannot be misread as a pass.
set -uo pipefail
fail=0

echo "== syntax =="
for f in $(find src -name '*.js') $(find public/js -name '*.js' 2>/dev/null); do
  node --check "$f" >/dev/null 2>&1 || { echo "  SYNTAX FAIL: $f"; fail=1; }
done
for f in public/*.html; do
  node -e "
    const fs=require('fs');const h=fs.readFileSync('$f','utf8');
    const ms=[...h.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*ld\+json)[^>]*>([\s\S]*?)<\/script>/g)];
    if(!ms.length) process.exit(0);
    new (require('vm').Script)(ms.map(m=>m[1]).join('\n;\n'));
  " 2>/dev/null || { echo "  INLINE SCRIPT FAIL: $f"; fail=1; }
done
[ $fail -eq 0 ] && echo "  ok"

echo "== boot =="
DATABASE_URL="postgres://u:p@localhost:5432/x" \
JWT_SECRET="$(head -c 48 /dev/urandom|base64|tr -dc a-zA-Z0-9|head -c 64)" \
REFRESH_TOKEN_SECRET="$(head -c 48 /dev/urandom|base64|tr -dc a-zA-Z0-9|head -c 64)" \
CLIENT_URL="https://accessyplabs.com" \
  node -e "require('./src/server.js')" >/dev/null 2>&1 \
  && echo "  ok" || { echo "  BOOT FAILED"; fail=1; }

echo "== tests =="
out=$(timeout 300 node --test test/*.test.js 2>&1)
pass=$(echo "$out" | grep -E '^# pass' | awk '{print $3}')
bad=$(echo "$out"  | grep -E '^# fail' | awk '{print $3}')
echo "  pass: ${pass:-?}   fail: ${bad:-?}"
if [ "${bad:-1}" != "0" ]; then
  echo "$out" | grep -A3 '^not ok' | head -20
  fail=1
fi

echo
if [ $fail -ne 0 ]; then echo "GATE FAILED — do not push."; exit 1; fi
echo "GATE PASSED."
