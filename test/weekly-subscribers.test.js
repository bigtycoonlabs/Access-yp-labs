'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:--|\/\/)\s*/g, ' ').replace(/\s+/g, ' ');
const subs = fs.readFileSync(require.resolve('../src/services/clay/weeklySubscribers.js'), 'utf8');
const weekly = fs.readFileSync(require.resolve('../src/services/clay/weekly.js'), 'utf8');
const pages = fs.readFileSync(require.resolve('../src/routes/weeklyPages.js'), 'utf8');
const home = fs.readFileSync('public/index.html', 'utf8');

test('a stranger can subscribe without an account', () => {
  // The magazine is the only thing here that reaches people who have not arrived yet, and it was
  // locked behind registration.
  assert.match(pages, /router\.post\('\/weekly\/subscribe'/);
  assert.match(pages, /router\.get\('\/weekly\/subscribe'/);
  assert.match(home, /id="weekly-form"/);
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
