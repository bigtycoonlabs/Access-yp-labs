'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { significantTokens, similarityScore, rankBySimilarity } = require('../src/services/clay/similarity');

test('significantTokens drops stopwords, short words, and generic scaffolding, and dedupes', () => {
  const t = significantTokens('An online platform app for dog walking and dog grooming business');
  assert.ok(t.includes('dog'), 'keeps subject word');
  assert.ok(t.includes('walking'));
  assert.ok(t.includes('grooming'));
  assert.ok(!t.includes('online'), 'drops generic scaffolding');
  assert.ok(!t.includes('platform'));
  assert.ok(!t.includes('app'));
  assert.ok(!t.includes('business'));
  assert.strictEqual(t.filter((x) => x === 'dog').length, 1, 'deduped');
});

test('similarityScore counts distinct idea tokens present in a candidate', () => {
  const idea = significantTokens('dog walking scheduling for busy owners');
  const s = similarityScore(idea, 'a scheduling helper that books dog walking visits');
  assert.ok(s.matched >= 2, 'matched at least dog/walking/scheduling');
  assert.ok(s.score > 0 && s.score <= 1);
});

test('rankBySimilarity flags a strong match and sorts by closeness', () => {
  const idea = significantTokens('handmade ceramic mugs sold to coffee shops');
  const listings = [
    { listing_id: '1', title: 'Ceramic mugs for coffee shops', blob: 'handmade ceramic mugs sold wholesale to coffee shops and cafes' },
    { listing_id: '2', title: 'Dog walking service', blob: 'on demand dog walking and pet care' },
  ];
  const ranked = rankBySimilarity(idea, listings);
  assert.strictEqual(ranked.top.listing_id, '1', 'closest first');
  assert.strictEqual(ranked.strong, true, 'a near-identical idea is strong');
});

test('rankBySimilarity is not strong when nothing meaningful overlaps', () => {
  const idea = significantTokens('handmade ceramic mugs for coffee shops');
  const listings = [{ listing_id: '9', title: 'Tax filing helper', blob: 'automated quarterly tax filing for freelancers' }];
  const ranked = rankBySimilarity(idea, listings);
  assert.strictEqual(ranked.strong, false);
  assert.strictEqual(ranked.matches.length, 0);
});
