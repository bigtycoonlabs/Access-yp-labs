'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/)?\s*/g, ' ').replace(/\s+/g, ' ');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const clay = fs.readFileSync(require.resolve('../src/services/clay/index.js'), 'utf8');

test('Clay never points at buttons that no longer exist', () => {
  // The Create / Enhance toggles were removed days ago — Clay reads which one you mean from what
  // you write. His opening still told a brand-new user to press them, which is worse than saying
  // nothing: they hunt for the buttons, do not find them, and conclude the page is broken.
  assert.ok(!/Pick “Create”|“Enhance” to sharpen|“Create” starts fresh/.test(app),
    'no instruction to press a removed control');
  assert.match(app, /just describe it in your own words — I'll work out which it is/);
  assert.match(flat(app), /Telling somebody to press buttons that no longer exist/i);
});

test('a build failure tells somebody what it means for them', () => {
  // "generation service is not configured" is our vocabulary, not theirs, and it left a new user's
  // very first action as a dead end.
  assert.ok(!/generation service is not configured/.test(clay));
  assert.match(clay, /This is a problem on our side, not anything you did/);
  assert.match(clay, /your idea is saved exactly as you wrote it/);
});

test('no invented support address is promised', () => {
  // I wrote hello@accessyplabs.com into four messages before checking whether it exists. Sending
  // somebody to an unmonitored mailbox at the moment something has already failed them is worse
  // than offering nothing.
  assert.ok(!/hello@accessyplabs\.com/.test(clay), 'no address that was never verified');
});
