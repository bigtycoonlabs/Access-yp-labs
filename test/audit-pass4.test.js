'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const auctions = fs.readFileSync(require.resolve('../src/services/clay/auctions.js'), 'utf8');

test('an auction that can never settle is surfaced, not silently invented a deadline', () => {
  assert.match(auctions, /reportEndlessAuctions/);
  assert.match(auctions, /auction_close_at IS NULL/);
  // The safety net must NOT quietly set a deadline on someone's live listing.
  const fn = auctions.slice(auctions.indexOf('async function reportEndlessAuctions'),
    auctions.indexOf('// Settle every auction'));
  assert.ok(!/UPDATE listings/i.test(fn), 'it reports, it does not rewrite a live listing');
  assert.match(fn, /Nothing has been changed automatically/i);
});
