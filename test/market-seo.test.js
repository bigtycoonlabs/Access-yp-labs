'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|<!--)\s*/g, ' ').replace(/\s+/g, ' ');
const market = fs.readFileSync(require.resolve('../src/routes/marketPages.js'), 'utf8');
const desk = fs.readFileSync(require.resolve('../src/routes/deskPages.js'), 'utf8');
// NOTE: this file's homepage assertions described the Access YP Labs marketplace front page, which
// has been replaced by the Penny Desk homepage. The marketplace still exists at its own pages for
// the transition, so those are read here instead of index.html — an assertion pointed at a page that
// no longer exists tests nothing and fails for the wrong reason.
const home = fs.existsSync('public/marketplace.html')
  ? fs.readFileSync('public/marketplace.html', 'utf8') : '';
const listings = fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8');

test('every listing has its own title and its own words in the HTML', () => {
  // Every listing shared one title — "Listing — The Exchange" — carried no h1, and rendered
  // entirely from JavaScript, so a crawler saw thirteen identical empty shells. The Desk, which
  // sells nothing, was fully indexed; the marketplace, which is the business, was invisible.
  assert.match(market, /router\.get\('\/market\/:id'/);
  assert.match(market, /an unbuilt business for sale \| Access YP Labs/);
  assert.match(market, /<h1>\$\{esc\(row\.title\)\}<\/h1>/);
  assert.match(market, /rel="canonical"/);
});

test('a listing is marked up as a product, without invented ratings', () => {
  // Inventing review counts to win a rich snippet is the same lie as inventing a revenue figure.
  assert.match(market, /'@type': 'Product'/);
  // The offer itself moved into src/lib/price.js, because building it here from price_cents alone
  // published a live auction as an Offer of 0.00 — telling search engines somebody's work was free.
  // This follows the currency claim to where it now lives rather than dropping the check.
  const price = fs.readFileSync(require.resolve('../src/lib/price.js'), 'utf8');
  assert.match(price, /priceCurrency: 'USD'/);
  assert.match(market, /offerJsonLd\(row/);
  // Strip comments first: the comment EXPLAINING that there is no aggregateRating contains the
  // word, so a check that cannot tell code from its own explanation fails on the file that is
  // correct. Third time this exact trap has caught me — worth stating rather than re-learning.
  const code = market.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/aggregateRating|reviewCount/.test(code));
  // Substring rather than regex: the sentence wraps across comment lines, and matching it as a
  // pattern kept failing on whitespace that flattening had already normalised.
  assert.ok(flat(market).includes('is the same lie as inventing a revenue figure'));
});

test('a withdrawn listing is gone rather than missing', () => {
  // 410 tells a crawler to drop it instead of retrying forever, and tells a person what happened.
  assert.match(market, /res\.status\(410\)/);
  assert.match(market, /no longer for sale/);
});

test('the sitemap carries the things we sell', () => {
  // It listed every Desk article and not one live listing.
  assert.match(desk, /\$\{site\}\/market\/\$\{x\.id\}/);
  assert.match(flat(desk), /the part of the platform that gives things away was fully indexed/i);
});

test('the homepage shows what is for sale before what it costs', { skip: 'the marketplace homepage it tested has been replaced by the Penny Desk homepage' }, () => {
  // Amazon does not open with Prime. The marketplace homepage replaced its pricing section with
  // three real listings, and pricing became one honest paragraph at the bottom.
  //
  // The lesson carried forward rather than the assertion: the Penny Desk homepage leads with the
  // product working — pick your state, see your real filings — and states prices plainly below it.
  // Enforced in homepage.test.js against the page that now exists.
});

test('the shop window needs no account to see', () => {
  // Requiring a session to find out what is for sale would be exactly backwards.
  const idx = listings.indexOf("router.get('/recent'");
  assert.ok(idx > -1);
  assert.ok(!/authenticate/.test(listings.slice(idx, idx + 120)), 'no auth on the shop window');
  assert.match(listings, /line: line \? line\.slice\(0, 140\) : null/);
});
