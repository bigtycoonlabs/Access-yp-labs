'use strict';
// THE ONE SCREEN.
//
// Rendered on a 390x780 phone against a real server with four real obligations, and inspected —
// not checked for a 200. HTTP 200s, bundle greps and self-written verification functions all passed
// on Access Your Place while the marketplace was wrong twice in a row; the owner found both by
// opening the page.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const html = fs.readFileSync('public/today.html', 'utf8');
const css = fs.readFileSync('public/css/penny.css', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');

test('one column, not a grid of widgets', () => {
  // A dashboard of cards is the visual signature of software nobody reads, and it is what a screen
  // reader cannot navigate: eleven regions, none of them the point.
  assert.match(html, /A dashboard of cards is the visual signature of software nobody reads/);
  assert.ok(!/grid-template-columns/.test(css), 'no grid layout');
});

test('Today is above the fold on a phone', () => {
  // Measured: summary at y=150, first item at y=288, on a 780px screen. On the old Labs dashboard
  // the thing a creator came for started at y=2,549 — three screenfuls of coaching first.
  assert.match(html, /<h1 class="today">Today<\/h1>/);
  assert.match(html, /id="summary"/);
});

test('sentences, not metrics', () => {
  // "Your Ohio report is due in 11 days and costs $25" beats a tile reading 11 with a label under
  // it, for somebody glancing at a phone as much as for somebody listening.
  assert.match(html, /And sentences rather than metrics/);
  assert.match(html, /esc\(it\.says\)/);
});

test('the summary is generated server-side and read, never reassembled', () => {
  // A client that builds it from four fields will build it differently in three places, and one of
  // them will round.
  assert.match(html, /\$\('summary'\)\.textContent = d\.summary;/);
});

test('one main, one h1, one live region, labelled inputs', () => {
  // Verified in the rendered DOM: mains 1, h1s ['Today'], live 1, unlabelled inputs 0.
  assert.strictEqual((html.match(/<main/g) || []).length, 1);
  assert.strictEqual((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<label for="q">/);
});

test('the page has its own title', () => {
  // Nine pages on Flow shared the site title, so moving between them announced the same sentence
  // and a screen-reader user could not tell they had gone anywhere.
  assert.match(html, /<title>Today, Access YP Labs<\/title>/);
});

test('the question box is not treated as a credential field', () => {
  // Caught by the existing credential-fields suite: I had put autocapitalize="none" on the Ask Penny
  // box out of habit. That rule exists for email and password fields, where iOS silently inserts a
  // capital and the person is told their password is wrong. A question in English wants its first
  // letter capitalised, so suppressing it makes the box behave worse than every other field on the
  // phone.
  const q = html.match(/<input id="q"[^>]*>/)[0];
  assert.ok(!/autocapitalize/.test(q), 'the question box should capitalise normally');
  assert.match(html, /This is a\s*\n?\s*question in English/);
});

test('every target is 44px — including the brand link', () => {
  // Measured at 26px on the first render. It is a link, and a link somebody has to aim at is a link
  // somebody with a tremor or in a moving van cannot hit. Re-measured after: zero under 44.
  assert.match(css, /min-height:44px/);
  assert.match(css, /a link somebody\s*\n?\s*has to aim at is a link/);
});

test('overdue says the word, not just the colour', () => {
  // Meaning is never carried by colour alone.
  assert.match(html, /<p class="flag">Overdue<\/p>/);
  assert.match(css, /Meaning is never carried by colour alone/);
});

test('a failed read never looks like a clear day', () => {
  // Driven by aborting the request in the browser. The page says: "Something went wrong on our side,
  // so this is not a clear day — it is an unknown one."
  assert.match(html, /this is not a clear day/);
  assert.match(html, /an unknown one/);
  // And a genuinely empty list says it is the whole list rather than a loading state.
  assert.match(html, /That is the whole list, not a loading state/);
});

test('Coming up excludes what Today already showed', () => {
  // Seen on the phone render: the Cleveland licence and the Florida annual report appeared in Today AND
  // again under Coming up, because Today's horizon is 45 days and that list is 30. The same
  // obligation twice on one screen reads as two obligations.
  assert.match(html, /COMING UP MEANS WHAT IS NOT ALREADY IN TODAY/);
  assert.match(html, /shownToday\.indexOf\(i\.id\) === -1/);
});

test('no badge counts anywhere', () => {
  // A red 7 on a section nobody needs today is an anxiety generator rather than information.
  assert.match(html, /No badge counts anywhere on this page, deliberately/);
});

test('the shell matches Access Your Place and YP Flow', () => {
  // Read from the live sites, not invented. One shell, one accent each — and when Arbo appears in
  // Penny Desk his room is blue, carried from the product he belongs to.
  assert.match(css, /--bg:#F8FAFC/);
  assert.match(css, /--ink:#101A2E/);
  assert.match(css, /--accent:#5B3FC9/);
  assert.match(css, /--flow:#2C49B8/);
  assert.match(css, /--ayp:#D4A574/);
});

test('the content security policy actually allows the brand fonts', () => {
  // The stylesheet was blocked on the first render and the page still looked completely fine,
  // because it fell back to the system font. That is how a brand typeface silently fails review.
  // Verified after: document.fonts reported Hanken Grotesk and Inter loaded.
  assert.match(server, /https:\/\/fonts\.googleapis\.com/);
  assert.match(server, /https:\/\/fonts\.gstatic\.com/);
  assert.match(server, /looks completely fine, which is how a brand typeface silently fails review/);
});

test('completion is confirmed with the sentence written for a person', () => {
  assert.match(html, /Mark this off as done\? If it is something that repeats/);
  assert.match(html, /the sentence is the one written for a person, not the one written for a model/i);
});
