'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const clay = fs.readFileSync(require.resolve('../src/services/clay/index.js'), 'utf8');

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
