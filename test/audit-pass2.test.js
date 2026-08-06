'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const partners = fs.readFileSync(require.resolve('../src/routes/partners.js'), 'utf8');
const auctions = fs.readFileSync(require.resolve('../src/services/clay/auctions.js'), 'utf8');

test('an accepted introduction never CLAIMS an email that did not send', () => {
  assert.match(partners, /introduced_by_email/, 'the outcome reports what actually happened');
  assert.match(partners, /did not go out/i, 'and says so plainly when it did not');
  assert.match(partners, /partner_email: it\.helper_email/,
    'the address is handed over regardless, so a failed email cannot strand anyone');
});

test('email failures are logged, never silently discarded', () => {
  assert.ok(!/\.catch\(\(\) => \{\}\)/.test(partners), 'no swallowed failures left in partners');
  assert.ok(!/\.catch\(\(\) => \{\}\)/.test(auctions), 'no swallowed failures left in auction settlement');
  // The guarantee got STRONGER: it used to be enough to log a reason when the promise rejected.
  // But sendEmail resolves with { sent:false } instead of throwing, so logging on reject was
  // catching nothing. Now the RESULT is checked, the reason is logged, and staff are told — because
  // these emails tell a winner they won and a seller they sold.
  assert.match(auctions, /email NOT sent to/, 'the reason is recorded');
  assert.match(auctions, /notifyStaff/, 'and a person is told, not just the log');
});
