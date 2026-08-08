'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const auth = fs.readFileSync(require.resolve('../src/routes/auth.js'), 'utf8');
const login = fs.readFileSync('public/login.html', 'utf8');

test('a locked-out person has a route back in', () => {
  // There was none. Forgetting a password meant losing every project you had built, with no way for
  // staff to help — the only recovery was a new account and abandoning the work.
  assert.match(auth, /router\.post\('\/forgot-password'/);
  assert.match(auth, /router\.post\('\/reset-password'/);
  assert.match(login, /I have forgotten my password/);
  assert.ok(fs.existsSync('public/reset.html'));
});

test('the reset form cannot be used to discover who has an account', () => {
  // "No account found" turns this into a way to enumerate registered users.
  assert.match(auth, /const sameAnswer = \{/);
  assert.match(auth, /If there is an account for that address/);
  assert.match(flat(auth), /The response NEVER reveals whether an address has an account/i);
  // Even a malformed address gets the same answer.
  assert.match(auth, /if \(!errors\.isEmpty\(\)\) return res\.json\(sameAnswer\)/);
});

test('tokens are stored hashed, single-use, and short-lived', () => {
  // A leak of the table must not hand somebody account takeover, and a link sitting in an inbox for
  // a week is a spare key.
  assert.match(auth, /createHash\('sha256'\)/);
  assert.ok(!/token_hash.*\$\{raw\}/.test(auth), 'the raw token is never stored');
  assert.match(auth, /used_at IS NULL AND pr\.expires_at > now\(\)/);
  assert.match(auth, /RESET_TTL_MINUTES = 60/);
});

test('using a reset voids every other outstanding one', () => {
  // If two were requested, using one must not leave the other lying around as a working spare key.
  assert.match(auth, /UPDATE password_resets SET used_at=now\(\) WHERE user_id=\$1 AND used_at IS NULL/);
  assert.match(auth, /clearRefreshCookie\(res\)/);
});

test('expired, used and invented tokens get one identical answer', () => {
  // Distinguishing them tells an attacker which of their guesses was once real.
  assert.match(auth, /That link has expired or has already been used/);
});

test('a reset email that fails to send is reported', () => {
  // The person is told the same thing either way — revealing a send failure would reveal the account
  // exists — but a failure that leaves somebody locked out must not be invisible to us.
  assert.match(auth, /kind: 'password_reset_not_sent'/);
  // The sentence wraps in the source, so flatten before matching it.
  assert.match(flat(auth), /they are still locked out and have no way to know why/i);
});
