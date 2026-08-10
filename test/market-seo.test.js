'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|<!--)\s*/g, ' ').replace(/\s+/g, ' ');
const market = fs.readFileSync(require.resolve('../src/routes/marketPages.js'), 'utf8');
const desk = fs.readFileSync(require.resolve('../src/routes/deskPages.js'), 'utf8');
const home = fs.readFileSync('public/index.html', 'utf8');
const listings = fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8');

test('every listing has its own title and its own words in the HTML', () => {
  // Every listing shared one title — "Listing — The Dream Market" — carried no h1, and rendered
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
  assert.match(market, /priceCurrency: 'USD'/);
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

test('the homepage shows what is for sale before what it costs', () => {
  // Amazon does not open with Prime. The products here are the projects people are selling.
  assert.match(home, /On the Dream Market right now/);
  assert.match(home, /id="recent-listings"/);
  assert.ok(home.indexOf('market-h') < home.indexOf('price-h'), 'the market comes before pricing');
  assert.match(flat(home), /Amazon does not open with Prime/i);
});

test('the shop window needs no account to see', () => {
  // Requiring a session to find out what is for sale would be exactly backwards.
  const idx = listings.indexOf("router.get('/recent'");
  assert.ok(idx > -1);
  assert.ok(!/authenticate/.test(listings.slice(idx, idx + 120)), 'no auth on the shop window');
  assert.match(listings, /line: line \? line\.slice\(0, 140\) : null/);
});
