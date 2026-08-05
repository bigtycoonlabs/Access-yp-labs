'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const desk = require('../src/services/clay/deskCompose');

test('slugify makes a clean, readable, URL-safe address', () => {
  assert.strictEqual(desk.slugify('Why Proof Beats Promises — 3 Moves'), 'why-proof-beats-promises-3-moves');
  assert.strictEqual(desk.slugify('   Spaces &&& symbols!!!   '), 'spaces-symbols');
  assert.strictEqual(desk.slugify(''), 'piece');       // never empty — an address is required
  assert.ok(desk.slugify('x'.repeat(200)).length <= 70); // stays short
});

test('metaDescription prefers Clay\'s own dek and never invents text', () => {
  assert.strictEqual(desk.metaDescription('A warm one-liner.', 'Body text here.'), 'A warm one-liner.');
});

test('metaDescription falls back to the opening of the piece, trimmed to a sane length', () => {
  const long = 'word '.repeat(200);
  const meta = desk.metaDescription('', long);
  assert.ok(meta.length <= 156, 'fits a search result');
  assert.ok(meta.endsWith('…'), 'shows it was cut rather than pretending to be complete');
});

test('metaDescription returns null when there is genuinely nothing to say', () => {
  assert.strictEqual(desk.metaDescription('', ''), null);
});
