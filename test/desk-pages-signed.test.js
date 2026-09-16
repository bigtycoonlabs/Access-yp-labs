'use strict';
// A SIGNED-IN PERSON CAN REACH EVERY PENNY DESK SCREEN.
//
// Walked 16 Sept 2026: Today, Businesses, People and Penny called the API without the session, so
// every call answered 401 and every page sent a signed-in person back to sign in, forever. Any page
// that calls authenticated /api/ routes with a bare fetch must load api.js and desk-auth.js first.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const pages = fs.readdirSync('public').filter((f) => f.endsWith('.html'));

test('every page that bounces on 401 carries the session wrapper, in order', () => {
  const missing = [];
  for (const f of pages) {
    const s = fs.readFileSync('public/' + f, 'utf8');
    if (!/status === 401\)\s*\{\s*location\.href\s*=\s*'\/login\.html/.test(s)) continue;
    const a = s.indexOf('/js/api.js'); const d = s.indexOf('/js/desk-auth.js');
    const firstInline = s.search(/<script>/);
    if (a < 0 || d < 0 || !(a < d && d < firstInline)) missing.push(f);
  }
  assert.deepStrictEqual(missing, []);
});

test('the wrapper leaves other origins and the auth routes alone', () => {
  const src = fs.readFileSync('public/js/desk-auth.js', 'utf8');
  assert.match(src, /u\.origin === location\.origin/);
  assert.match(src, /indexOf\('\/api\/auth\/'\) !== 0/);
  assert.match(src, /Never a loop/);
});
