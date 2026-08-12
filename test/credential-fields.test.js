'use strict';
// EVERY CREDENTIAL FIELD SETS autocapitalize="none".
//
// The house rule, written down on both sibling platforms: "Every credential field needs
// autoCapitalize='none'. Four did not, including both halves of the exchange key form, where iOS
// silently corrupts a key and the client is told it does not authenticate."
//
// Walked the live signup as a new user and found two of nine set it here. iOS inserts a capital on
// the first letter, the field looks correct, and the person is told their email or password is
// wrong. They cannot see the capital, and nothing on screen would tell them — which lands hardest on
// exactly the people this platform is built for.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const PAGES = fs.readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => 'public/' + f);

test('no email or password field can be silently capitalised', () => {
  const misses = [];
  for (const p of PAGES) {
    const s = fs.readFileSync(p, 'utf8');
    for (const tag of s.match(/<input\b[^>]*>/g) || []) {
      const credential = /type="(password|email)"/.test(tag)
        || /id="(email|password|pw|[a-z-]*-email|[a-z-]*-password)"/.test(tag);
      if (!credential) continue;
      if (!/autocapitalize="none"/i.test(tag)) misses.push(p + ': ' + tag.slice(0, 70));
    }
  }
  assert.deepStrictEqual(misses, [], 'credential fields missing autocapitalize');
});

test('and spellcheck is off on them too', () => {
  // A red underline under somebody's email address is noise at best, and on a password field the
  // browser has no business sending the value anywhere for checking.
  for (const p of PAGES) {
    const s = fs.readFileSync(p, 'utf8');
    for (const tag of s.match(/<input\b[^>]*autocapitalize="none"[^>]*>/g) || []) {
      assert.match(tag, /spellcheck="false"/, p + ': ' + tag.slice(0, 60));
    }
  }
});
