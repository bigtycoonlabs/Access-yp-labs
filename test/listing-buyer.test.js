'use strict';
// THE BUYER'S SIDE, WALKED LIVE AND SIGNED IN.
//
// Opened a real live listing as a buyer and clicked "Claim this project". The purchase gate opened
// correctly: three acknowledgement checkboxes, all labelled — transfer agreement, risk, and that the
// purchase is final and non-refundable — plus a Confirm purchase button, and focus landed on the new
// section's heading rather than on BODY. No failed requests. That path is in good shape and is not
// changed here.
//
// One thing was backwards.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const listing = fs.readFileSync('public/listing.html', 'utf8');

test('the demo accessibility report does not interrupt', () => {
  // The report itself is a good feature: it tells a buyer whether the demo they would receive can be
  // operated by a screen reader. It was announced ASSERTIVELY.
  //
  // So at the moment somebody clicked to buy, "Purchase started — complete it below." went into the
  // polite region and an audit of a demo preview went into the assertive one. The less important
  // message was the louder one and could speak over the more important. Assertive is for the outcome
  // of what the person just did, and for errors; a background report on an asset preview is neither.
  assert.match(listing, /announce\(a\.summary\);/);
  assert.ok(!/announce\(a\.summary,true\)/.test(listing));
});

test('the purchase gate still speaks up for itself', () => {
  // Everything about the actual purchase stays as it is.
  assert.match(listing, /Purchase started/);
});

test('an endless auction still refuses bids and purchase', () => {
  // Verified on the same pass: the live auction with no closing time shows "Not open for bids" and
  // offers no bid box and no buy button.
  assert.match(listing, /Not open for bids/);
  assert.match(listing, /const endless=isAuction && !listing\.auction_close_at/);
});
