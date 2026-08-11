'use strict';
// NOBODY COULD LIST A PROJECT. THE SELL PAGE HAS NEVER WORKED.
//
// Found by signing in on the LIVE site and opening /sell.html. The page returns HTTP 200, logs no
// page error, and prints this to the person, twice, where an explanation should be:
//
//   "projects is not defined"
//
// The loader fetched `{concepts}` and then filtered `projects`, which is not a variable that exists
// there. Every visit threw a ReferenceError on that line, the catch two lines below rendered the
// raw JavaScript message as prose, and the dropdown was left holding nothing but "create a new one".
//
// So the single step the platform describes as "the step that makes earning possible" — listing a
// project — could not be completed by anyone, from this page, ever. Zero marketplace sales is
// recorded in the Bible as a thing that has never been tried. Part of it is a thing that could not
// be done.
//
// It is invisible to every automated check: the page loads, the request succeeds, nothing throws
// past the catch. Only opening it and reading it finds it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const sell = fs.readFileSync('public/sell.html', 'utf8');

test('the loader filters the list it actually fetched', () => {
  assert.match(sell, /const \{concepts\}=await Kiln\.api\('\/concepts'\)/);
  assert.match(sell, /const listable=\(concepts\|\|\[\]\)\.filter\(c=>!c\.is_operating\)/);
  assert.ok(!/^\s*projects\.filter/m.test(sell), 'no reference to a variable that does not exist');
});

test('a running business is still never offered for listing', () => {
  // The rule the broken line was written to enforce, now that the line runs.
  assert.match(sell, /!c\.is_operating/);
});

test('an empty list says which kind of empty it is', () => {
  // "Nothing here" and "we could not read it" look identical to somebody who cannot see the page,
  // and they call for opposite responses. Empty and broken are not the same thing.
  assert.match(sell, /None of your projects can be listed yet/);
  assert.match(sell, /You do not have a project to list yet/);
});

test('a failure never hands the person a JavaScript message', () => {
  // "projects is not defined" tells somebody nothing they can act on, and reads to a screen reader
  // as gibberish arriving in the middle of a form they are trying to complete.
  assert.ok(!/catch\(e\)\{show\(e\.message\);\}/.test(sell.replace(/\s+/g, '')),
    'the catch must not print the raw error');
  assert.match(sell, /this is a fault \+?\s*'?\s*\+?\s*'?on our side/);
  assert.match(sell, /Nothing has been listed/);
});

test('the risk and ownership checkboxes are labelled', () => {
  // Checked in a real browser after my own probe wrongly flagged these: it looked only for
  // label[for=...] and these are wrapped in <label>, which is equally valid and is announced.
  // Verified live — the accessible names read back as the visible text. Recorded so the next sweep
  // does not re-chase it.
  for (const id of ['risk', 'ownership', 'showworking']) {
    assert.ok(sell.includes('<label class="check"><input type="checkbox" id="' + id + '"'),
      id + ' must stay wrapped in its label');
  }
});
