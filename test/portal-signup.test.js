'use strict';
// CUSTOMERS CREATE THEIR OWN PORTAL ACCOUNT.
//
// Walked 16 Sept 2026. Approve mode: a stranger signed up, was invisible to the owner until they
// confirmed their email, then saw only a waiting page and could not post; the owner saw them first
// with their note, the decision was on Today, approving let them in and cleared Today. Declining shut
// them out without an email. An address already in the portal and a bot filling the hidden field got
// the same answer, and the bot created nothing. Open mode let a confirmed person straight in. Off
// mode showed no form and refused a direct post.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const C = require('../src/services/clay/portalConfig');

test('sign-up is a portal setting, open by default, and anything else is refused by name', () => {
  const d = C.defaults('Rivera');
  assert.strictEqual(d.signup, 'open');
  assert.deepStrictEqual(Object.keys(C.SIGNUP), ['open', 'approve', 'off']);
  const r = C.normalise({ signup: 'everyone' }, d);
  assert.strictEqual(r.config.signup, 'open');
  assert.match(r.ignored.join(' '), /the sign-up setting "everyone"/);
  assert.match(C.describe(C.normalise({ signup: 'approve' }, d).config), /you approve each one before they get in/);
});

test('the database will not let a self-made account in without a confirmed email', () => {
  const sql = fs.readFileSync('docs/migrations/066_portal_signup.sql', 'utf8').replace(/\s+/g, ' ');
  assert.match(sql, /source = 'owner' OR status <> 'active' OR verified_at IS NOT NULL/);
  assert.match(sql, /CHECK \(source = 'self' OR status = 'active'\)/);
  const order = fs.readFileSync('docs/migrations/ORDER.txt', 'utf8');
  assert.ok(order.indexOf('066_portal_signup.sql') > order.indexOf('065_customer_portal.sql'));
});

test('a sign-up always gets the same answer, and a new account starts pending', () => {
  const src = fs.readFileSync('src/services/clay/portal.js', 'utf8');
  const fn = src.slice(src.indexOf('async function signup'), src.indexOf('async function confirmSelf'));
  assert.strictEqual((fn.match(/return \{ ok: true, code: 'joined', says: same \}/g) || []).length, 3);
  assert.match(fn, /VALUES \(\$1,\$2,\$3,'self','pending',\$4\)/);
  assert.match(fn, /FLOOD_SIGNUPS_PER_HOUR/);
});

test('confirming activates in an open portal and asks the owner in one that approves', () => {
  const src = fs.readFileSync('src/services/clay/portal.js', 'utf8');
  const fn = src.slice(src.indexOf('async function confirmSelf'), src.indexOf('async function openPortal'));
  assert.match(fn, /CASE WHEN \$2 = 'open' THEN 'active' ELSE status END/);
  assert.match(fn, /'Approve or decline ' \+ c\.name/);
});

test('unconfirmed sign-ups are invisible, declined people cannot get in, waiting people cannot act', () => {
  const src = fs.readFileSync('src/services/clay/portal.js', 'utf8');
  assert.match(src, /NOT \(c\.source = 'self' AND c\.verified_at IS NULL\)/);
  assert.ok((src.match(/status <> 'declined'/g) || []).length >= 3);
  const r = fs.readFileSync('src/routes/portal.js', 'utf8');
  assert.match(r, /if \(who\.customer\.status !== 'active'\) \{ go\(res, req\.params\.slug, 'waiting'\); return null; \}/);
  assert.match(r, /if \(who\.customer\.status !== 'active'\) return go\(res, req\.params\.slug, 'waiting'\);/);
});

test('the approval task is never shown to the customer as something owed', () => {
  const src = fs.readFileSync('src/services/clay/portal.js', 'utf8');
  const view = src.slice(src.indexOf('async function customerView'), src.indexOf('async function customerFile'));
  assert.match(view, /kind <> 'task'/);
});

test('the form is honest about each mode and hides a trap only a bot fills', () => {
  const r = fs.readFileSync('src/routes/portal.js', 'utf8');
  assert.match(r, /mode === 'off' \? ''/);
  assert.match(r, /approves your account before you can see anything/);
  assert.match(r, /<div style="display:none"><label for="jsite">/);
  assert.match(r, /if \(b\.website\) return go\(res, req\.params\.slug, 'joined'\);/);
  const owner = fs.readFileSync('public/portal.html', 'utf8');
  assert.match(owner, /<label class="field" for="signup">Who can create an account<\/label>/);
  assert.match(owner, /data-approve=/);
});
