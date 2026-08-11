'use strict';
// A MISSING PRICE IS NOT A PRICE OF ZERO.
//
// A live auction listing — "Go Butler", starting bid $35.00, no price_cents — was published on its
// public page as "listed by War chief · $0.00", and its Product markup told search engines
// `"price":"0.00"`. Nobody wrote that number. `(null / 100).toFixed(2)` is "0.00", and every surface
// built after the interactive marketplace read price_cents on its own.
//
// This is the platform's signature defect in a new place: an absent value printed as a confident
// one. It is worse than most instances because the number is what somebody expects to be paid, it
// was published to a search index as an offer of a free product, and neither owner can catch a
// wrong price by glancing at a page.
//
// These tests pin the rule rather than the wording, so a rephrase does not fail them but a
// reintroduced zero does.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { priceLabel, askingCents, offerJsonLd } = require('../src/lib/price');

const read = (p) => fs.readFileSync(p, 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

test('an auction reads as a starting bid, never as a price of nothing', () => {
  const auction = { format: 'auction', price_cents: null, starting_bid_cents: 3500 };
  const label = priceLabel(auction);
  assert.match(label, /35\.00/);
  assert.ok(!/\$0\.00|\$0\b/.test(label), 'an auction must never render as zero');
  assert.strictEqual(askingCents(auction), 3500);
});

test('a listing with no figure at all says so rather than inventing one', () => {
  const broken = { format: 'flat', price_cents: null };
  assert.strictEqual(priceLabel(broken), 'Price not set');
  assert.strictEqual(askingCents(broken), null);
  // Nothing at all is preferable to a wrong figure here.
  assert.strictEqual(offerJsonLd(broken, 'https://example.test/x'), null);
});

test('a real price still reads as a real price', () => {
  assert.strictEqual(priceLabel({ format: 'flat', price_cents: 14900 }), '$149.00');
  assert.strictEqual(askingCents({ format: 'flat', price_cents: 14900 }), 14900);
});

test('a genuinely free listing is not confused with a missing one', () => {
  // Zero is a legitimate value. The rule is about null, not about the number 0 — flattening the two
  // in the other direction would be the same mistake wearing the opposite hat.
  assert.strictEqual(priceLabel({ format: 'flat', price_cents: 0 }), '$0.00');
  assert.strictEqual(askingCents({ format: 'flat', price_cents: 0 }), 0);
});

test('search engines are never told an auction has a fixed price', () => {
  const offer = offerJsonLd({ format: 'auction', price_cents: null, starting_bid_cents: 3500 }, 'https://example.test/x');
  // AggregateOffer with lowPrice is precisely true: bidding starts there, and where it ends is not
  // something we know. Claiming the starting bid as `price` is a smaller version of the same lie.
  assert.strictEqual(offer['@type'], 'AggregateOffer');
  assert.strictEqual(offer.lowPrice, '35.00');
  assert.ok(!('price' in offer));
  assert.ok(!('highPrice' in offer));
});

test('the public listing page asks for the price rather than computing one', () => {
  const market = stripComments(read('src/routes/marketPages.js'));
  assert.ok(!/price_cents\s*\/\s*100/.test(market), 'no price arithmetic in the page');
  assert.match(market, /priceLabel\(row\)/);
  assert.match(market, /offerJsonLd\(row/);
  // The offer is omitted when there is no honest figure, rather than emitted carrying zero.
  assert.match(market, /offer \? \{ offers: offer \} : \{\}/);
  // And the page must actually read the columns an auction lives in.
  assert.match(market, /l\.starting_bid_cents/);
  assert.match(market, /l\.format/);
});

test('every surface that shows a price gets format and the starting bid to show it with', () => {
  // The bug was not one query. The interactive pages branched on format and were right; everything
  // built after them selected price_cents alone. A page cannot tell an auction from a free listing
  // without these two columns, so the fix is only real where they travel.
  for (const file of ['src/routes/listings.js', 'src/routes/movers.js',
    'src/routes/seedListings.js', 'src/routes/marketAdmin.js']) {
    const s = read(file);
    assert.ok(/starting_bid_cents/.test(s), `${file} must carry the starting bid`);
    assert.ok(/l\.format|\.format/.test(s), `${file} must carry the format`);
  }
});

test('the browser pages share one definition instead of each rolling its own zero', () => {
  const api = read('public/js/api.js');
  assert.match(api, /priceLabel/);
  assert.match(api, /askingCents/);
  assert.match(api, /window\.Kiln = \{[^}]*priceLabel/);

  for (const page of ['public/index.html', 'public/console.html', 'public/market-control.html',
    'public/marketplace.html', 'public/dreamhold.html', 'public/mover.html']) {
    const s = read(page);
    assert.ok(/Kiln\.priceLabel/.test(s), `${page} must use the shared price label`);
    assert.ok(!/\(\s*l\.price_cents\s*\|\|\s*0\s*\)/.test(s), `${page} must not coerce a missing price to zero`);
  }
});

test('a mover is told the rate, not that they earn nothing', () => {
  const { commissionDisplay } = require('../src/lib/movers');
  const unknown = commissionDisplay(null);
  assert.strictEqual(unknown.cents, null);
  assert.ok(!/\$0\.00/.test(unknown.label), 'never quote a commission of zero on an unpriced listing');
  assert.match(unknown.label, /5%/);
  // A real price still produces a real dollar figure — that is what movers are shown normally.
  assert.strictEqual(commissionDisplay(20000).label, '$10.00');
});

test('the staff editor does not demand a price an auction does not have', () => {
  const ctl = read('public/market-control.html');
  // The price box used to prefill 0 from a null, and the "$10 minimum" guard then refused every
  // save — so nobody could fix the title or risk note on an auction listing, and the reason given
  // blamed a price they had never typed.
  assert.match(ctl, /l\.format === 'auction'/);
  assert.match(ctl, /if\(pi\)\{/);
  assert.ok(!/String\(Math\.round\(\(l\.price_cents\|\|0\)\/100\)\)/.test(ctl));
});
