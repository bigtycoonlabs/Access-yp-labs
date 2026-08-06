'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const email = fs.readFileSync(require.resolve('../src/services/email.js'), 'utf8');
const auctions = fs.readFileSync(require.resolve('../src/services/clay/auctions.js'), 'utf8');
const partners = fs.readFileSync(require.resolve('../src/routes/partners.js'), 'utf8');

test('sendEmail signals failure by RESOLVING, not throwing — which is the trap', () => {
  // This is why a bare .catch() on sendEmail catches nothing and a failed send looks successful.
  assert.match(email, /return \{ sent: false, reason: 'email_not_configured' \}/);
  assert.match(email, /return \{ sent: false, reason: `resend_/);
});

test('a failed auction email is noticed, not swallowed', () => {
  // These tell a winner they won and a seller they sold. Silence leaves both waiting for news that
  // already happened.
  assert.match(auctions, /async function mailOrShout/);
  assert.match(flat(auctions), /a \.catch\(\) on it catches nothing/i);
  assert.match(auctions, /auction_email_failed/);
  assert.ok(!/\.catch\(\(e\) => console\.error\('auction settlement email failed/.test(auctions),
    'the ineffective catch is gone');
});

test('the platform never claims someone was told when the email failed', () => {
  assert.match(partners, /told_creator: toldThem/);
  assert.match(partners, /they may not know yet/i);
  assert.match(partners, /helper_told: told/);
  assert.match(partners, /they may still be waiting to hear/i);
});
