'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const orders = fs.readFileSync(require.resolve('../src/routes/orders.js'), 'utf8');
const auctions = fs.readFileSync(require.resolve('../src/services/clay/auctions.js'), 'utf8');

test('partner_active is set explicitly, never left null', () => {
  assert.match(orders, /partner_active\)/, 'the column is written at creation');
  assert.match(orders, /!!listing\.partner_offered/, 'true only when a partner was actually offered');
  // A null would read as "active" in some places and fail `= true` filters in others.
  assert.match(orders, /a null is not true/i, 'and the reason is recorded for whoever reads this next');
});

test('an auction that can never settle is surfaced, not silently invented a deadline', () => {
  assert.match(auctions, /reportEndlessAuctions/);
  assert.match(auctions, /auction_close_at IS NULL/);
  // The safety net must NOT quietly set a deadline on someone's live listing.
  const fn = auctions.slice(auctions.indexOf('async function reportEndlessAuctions'),
    auctions.indexOf('// Settle every auction'));
  assert.ok(!/UPDATE listings/i.test(fn), 'it reports, it does not rewrite a live listing');
  assert.match(fn, /Nothing has been changed automatically/i);
});
