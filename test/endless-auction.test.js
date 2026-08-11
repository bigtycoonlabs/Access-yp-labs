'use strict';
// AN AUCTION THAT CANNOT CLOSE CANNOT TAKE MONEY.
//
// Both money-path guards were written as `close_at && <comparison>`, which skips the whole check
// when there is no close date. A live auction with no closing time therefore read as CLOSED to the
// purchase path: its top bidder could buy it the instant they bid, at whatever they had just bid,
// while every other bidder was still being shown an open auction. The bid path failed open the same
// way, taking bids into a listing that could never resolve them.
//
// The platform already knew these listings existed and said the opposite thing about them. The
// endless-auction sweep emails staff that they "can never settle and no bidder can ever win them" —
// true of the automatic settlement, false of the route a person actually clicks. Two parts of the
// system stating opposite things about the same listing, with money attached, is the exact failure
// this codebase is built to refuse. Where they disagree, the money path fails closed.
//
// No deadline is invented on the seller's behalf anywhere in this fix. Changing the terms of
// somebody's live listing is not ours to do; declining to collect against terms that cannot resolve
// is.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const orders = fs.readFileSync('src/routes/orders.js', 'utf8');
const bids = fs.readFileSync('src/routes/bids.js', 'utf8');
const listingPage = fs.readFileSync('public/listing.html', 'utf8');

test('a purchase on an auction with no closing time is refused', () => {
  assert.match(orders, /if \(!listing\.auction_close_at\) \{/);
  assert.match(orders, /has no closing time/);
  // The refusal must state that no money moved. A person told only "cannot buy" has no way to know
  // whether their card was touched.
  assert.match(orders, /Nothing has been charged/);
});

test('the close check no longer fails open on a null', () => {
  // The precise shape that caused it: a guard whose condition is the existence of the value it is
  // guarding. If this pattern comes back, the endless auction is buyable again.
  assert.ok(!/listing\.auction_close_at && new Date\(listing\.auction_close_at\) > new Date\(\)/.test(orders),
    'the still-open check must not be conditional on the close date existing');
  assert.ok(!/listing\.auction_close_at && new Date\(listing\.auction_close_at\) < new Date\(\)/.test(bids),
    'the closed check must not be conditional on the close date existing');
});

test('a bid into an auction that can never resolve is refused', () => {
  assert.match(bids, /if \(!listing\.auction_close_at\) \{/);
  assert.match(bids, /could never win/);
  assert.match(bids, /Nothing was placed/);
});

test('an order is never created for an amount we are not sure of', () => {
  // `amount = listing.price_cents` carried a null straight through: platformFeeCents(null) is 0,
  // the insert breaks a NOT NULL column, and Stripe would have been handed unit_amount: null. The
  // same absent value that rendered as "$0.00" on the public page arrives here, where it costs
  // money rather than a search snippet.
  assert.match(orders, /isAboveFloor\(amount\)/);
  assert.match(orders, /nothing was charged/i);
  // isAboveFloor rejects null, non-integers and anything under the floor in one check.
  const { isAboveFloor } = require('../src/lib/money');
  assert.strictEqual(isAboveFloor(null), false);
  assert.strictEqual(isAboveFloor(undefined), false);
  assert.strictEqual(isAboveFloor(0), false);
  assert.strictEqual(isAboveFloor(999), false);
  assert.strictEqual(isAboveFloor(1000), true);
});

test('the listing page says so before the form rather than after it', () => {
  // Offering a bid box the server will refuse is the same as a button that does nothing. A refusal
  // that only arrives after somebody has typed a figure is a worse version of the same fault.
  assert.match(listingPage, /const endless=isAuction && !listing\.auction_close_at/);
  assert.match(listingPage, /Not open for bids/);
  assert.match(listingPage, /if\(endless\)\{/);
  // And it is spoken, not only drawn. A component that is never announced does not exist for the
  // people who own this platform.
  assert.match(listingPage, /announce\('This auction has no closing time/);
});

test('the endless-auction sweep still reports rather than repairs', () => {
  // The other half of the agreement: we refuse the money, we do not set a deadline for the seller.
  const sweep = fs.readFileSync('src/services/clay/auctions.js', 'utf8');
  assert.match(sweep, /reportEndlessAuctions/);
  assert.match(sweep, /Nothing has been changed automatically/);
});
