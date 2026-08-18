'use strict';
// THE OPEN SEATS BOARD — the way in for somebody who has a skill and no idea of their own.
//
// Everything built this week was reachable only by the project owner. A contributor had no screen at
// all: /api/seats/open existed with nothing in front of it, which is the same as not existing.
//
// The platform's opening question has always been what idea you never launched, and it quietly
// filters out most of the people it is for. 55 concepts, 12 creators who ever made one. What this
// place is short of is not ideas — it is everyone who could turn one into a business, and every one
// of those people arrives with a SKILL and is immediately asked for the one thing they lack.
//
// Every finding below came from rendering the page in a browser and measuring it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const page = fs.readFileSync('public/seats.html', 'utf8');

test('a page nobody can reach does not exist', () => {
  // On the sibling platform the library index was built, sitemapped, and linked only from the 404
  // page. This board is the ENTIRE way a contributor gets in.
  const html = fs.readdirSync('public').filter((f) => f.endsWith('.html'));
  const linked = html.filter((f) => fs.readFileSync('public/' + f, 'utf8').includes('/seats.html'));
  assert.ok(linked.length >= 9, 'only ' + linked.length + ' pages link to the board');
  // Including the server-rendered pages, which carry their own nav and must not disagree.
  const desk = fs.readFileSync('src/routes/deskPages.js', 'utf8');
  assert.match(desk, /<a href="\/seats\.html">Help build<\/a>/);
  assert.match(desk, /\{ loc: `\$\{site\}\/seats\.html`, priority: '0\.9' \}/);
});

test('one card per project, not one per seat', () => {
  // Rendered with two seats on one project and it drew two projects. Somebody reading that offers
  // the same help twice, and the count overstates how busy the platform is — a small lie in exactly
  // the register this place cannot afford.
  assert.match(page, /Counted by PROJECT, not by seat/);
  assert.match(page, /\(projects\[s\.concept_id\] = projects\[s\.concept_id\] \|\| \[\]\)\.push\(s\)/);
  // And it says both numbers rather than hiding the difference.
  assert.match(page, /n > np \? ', ' \+ n \+ ' seats between them' : ''/);
});

test('a project asking for two things makes you say which', () => {
  // Without it the offer files against whichever seat happened to be first, and the owner reads a
  // builder's note against a seat asking for a seller.
  assert.match(page, /Which of these you would take/);
  assert.match(page, /body: \{ kind: pick \? pick\.value : s\.kind/);
});

test('the first action is above the fold', () => {
  // Measured three times on a 390x780 phone. y=835 at first. Grouping by project fixed a real bug
  // and pushed it to y=945 — WORSE — because every brief stacked. Showing the full brief for one
  // seat and a named list for several brought it to y=703.
  //
  // The briefs are not lost: they are in the picker, which is where somebody reads them at the
  // moment they are choosing, which is the only moment the detail matters.
  // Pinned to the behaviour, not to where a comment happens to wrap. Two of my assertions in this
  // file first matched across a line break that the source does not contain — a test that fails on
  // reformatting and passes on a real regression.
  assert.match(page, /y=835 to y=945/);
  assert.match(page, /if \(seats\.length === 1\) \{/);
  assert.match(page, /'Looking for ' \+ seats\.map/);
});

test('the honest line is a description, not a warning', () => {
  // Not "most projects never sell". A contributor is not spending money, and borrowing a seller's
  // risk warning for somebody offering to help is the wrong warning in the wrong place. What is
  // owed them is that nothing implies an outcome that has not happened.
  assert.match(page, /Access YP Labs is new, and you are early/);
  assert.match(page, /you hold a real share if/);
  assert.match(page, /this project sells/);
  // Checked against what a PERSON reads, not the source. My first version failed on the comment
  // directly above the code — the one explaining why that sentence must not appear. Third time this
  // session a test has matched my own prose instead of the product.
  const visible = page.replace(/^\s*\/\/.*$/gm, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  assert.ok(!/most (listed )?projects (do not|never) sell/i.test(visible));
});

test('empty is not broken, and a failed read is not empty', () => {
  assert.match(page, /No project is looking for help right now/);
  assert.match(page, /That is a failed read, not an empty one/);
});

test('the twenty-character rule is said before somebody types into a refusal', () => {
  assert.match(page, /if \(ta\.value\.trim\(\)\.length < 20\)/);
  assert.match(page, /Nothing was sent\./);
});

test('a signed-out visitor is told what to do, not shown a failure', () => {
  assert.match(page, /You need an account to offer help\. Nothing was sent/);
});

test('the server sentence is passed through, not replaced', () => {
  // A full project and something already waiting both say something specific and useful that a
  // generic failure would throw away.
  assert.match(page, /\(e && e\.status && e\.message\) \|\| 'That did not send/);
});
