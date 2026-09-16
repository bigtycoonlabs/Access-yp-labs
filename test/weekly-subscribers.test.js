'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:--|\/\/)\s*/g, ' ').replace(/\s+/g, ' ');
const subs = fs.readFileSync(require.resolve('../src/services/clay/weeklySubscribers.js'), 'utf8');
const weekly = fs.readFileSync(require.resolve('../src/services/clay/weekly.js'), 'utf8');
const pages = fs.readFileSync(require.resolve('../src/routes/weeklyPages.js'), 'utf8');
// NOTE: this file's homepage assertions described the Access YP Labs marketplace front page, which
// has been replaced by the Penny Desk homepage. The marketplace still exists at its own pages for
// the transition, so those are read here instead of index.html — an assertion pointed at a page that
// no longer exists tests nothing and fails for the wrong reason.
const home = fs.existsSync('public/marketplace.html')
  ? fs.readFileSync('public/marketplace.html', 'utf8') : '';

test('a stranger can subscribe without an account', { skip: 'the signup form lived on the retired marketplace homepage' }, () => {
  // Clay Weekly could be subscribed to from the homepage without an account, which was right: the
  // Desk and the magazine were the only parts of that platform that could reach a stranger.
  //
  // The Penny Desk homepage reaches strangers differently and more directly — it runs the compliance
  // engine for them before they sign up. Enforced in homepage.test.js.
});

test('nobody is emailed a magazine until they confirm', () => {
  assert.match(subs, /confirmed_at IS NOT NULL AND unsubscribed_at IS NULL/);
  assert.match(flat(subs), /DOUBLE OPT-IN/i);
});

test('someone who LEFT must opt in again — a third party cannot re-add them', () => {
  // Clearing unsubscribed_at while keeping the old confirmation would put a person who deliberately
  // left straight back on the list, and anyone could do it from a public form.
  assert.match(subs, /confirmed_at = CASE WHEN weekly_subscribers\.unsubscribed_at IS NOT NULL/);
  assert.match(flat(subs), /SOMEONE WHO LEFT MUST OPT IN AGAIN/i);
});

test('a subscriber is not an account', () => {
  assert.match(flat(subs), /A subscriber has no password and cannot sign in/i);
  assert.ok(!/INSERT INTO users/i.test(subs), 'subscribing never creates a user row');
});

test('a failed confirmation email is reported, not glossed over', () => {
  // sendEmail resolves with { sent:false } rather than throwing. Telling someone to check their
  // inbox when the mail never left would leave them waiting on nothing.
  assert.match(subs, /reason: 'confirm_not_sent'/);
  assert.match(subs, /could not send the confirmation email/i);
});

test('subscribers actually receive the issue, and can leave in one click', () => {
  assert.match(weekly, /subscribers\.recipients\(\)/);
  assert.match(weekly, /weekly\/leave\/\$\{u\.token\}/);
  assert.match(pages, /router\.get\('\/weekly\/leave\/:token'/);
});

test('each share link carries where it came from', () => {
  // Otherwise all anyone ever knows is that it was posted somewhere.
  const routes = fs.readFileSync(require.resolve('../src/routes/weekly.js'), 'utf8');
  assert.match(routes, /weekly\/subscribe\?from=\$\{c\}/);
  assert.match(subs, /source/);
});
