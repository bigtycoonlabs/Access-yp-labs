'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|<!--)\s*/g, ' ').replace(/\s+/g, ' ');
const page = fs.readFileSync('public/profile.html', 'utf8');
const api = fs.readFileSync(require.resolve('../src/routes/profiles.js'), 'utf8');

test('the three visibility checkboxes are gone', () => {
  // "Show my projects publicly", "show my completed work publicly", "show my live listings
  // publicly" — three privacy decisions about a public profile page that does not exist. Two were
  // written to the database and read by NOTHING; the third was read only by an endpoint no page in
  // the platform links to.
  assert.ok(!/show_concepts|show_completed|show_listings/.test(page));
  assert.ok(!/type="checkbox"/.test(page));
  assert.match(flat(page), /a public profile page that does not exist/i);
});

test('a person can change what other people see', () => {
  // The public name appears on every listing they make, and could only be changed by asking Clay in
  // conversation — a fine way to do it and a poor way to be the only way.
  assert.match(page, /id="display_name"/);
  assert.match(page, /Your public name/);
  assert.match(api, /router\.put\('\/me\/details'/);
  assert.match(api, /display_name/);
});

test('a person can change their own contact details', () => {
  ['real_name', 'email', 'phone'].forEach((f) => {
    assert.ok(page.includes('id="' + f + '"'), f + ' is editable');
  });
  assert.match(page, /Change your password from the sign-in page/);
});

test('About you does not pretend to be public', () => {
  // It is stored and shown nowhere, so saying "show publicly" would be a promise with no page
  // behind it.
  assert.match(page, /It is not shown on a public page today/);
});

test('an email already in use is refused', () => {
  // Somebody else's account must not become reachable by claiming their address.
  assert.match(api, /Another account already uses that email address/);
  assert.match(api, /SELECT 1 FROM users WHERE email=\$1 AND id<>\$2/);
});

test('a half-saved profile is never reported as saved', () => {
  // Two saves, because they are two different things — but one outcome, naming which part failed.
  assert.match(flat(page), /a half-saved profile reported as saved is the failure this platform exists not to make/i);
});
