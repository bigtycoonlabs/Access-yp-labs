const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeSlug, isValidSlug, commissionDisplay } = require('../src/lib/movers');

test('normalizeSlug cleans free text into a handle', () => {
  assert.strictEqual(normalizeSlug('  Dream Team!! '), 'dream-team');
  assert.strictEqual(normalizeSlug('War_Chief'), 'war-chief');
  assert.strictEqual(normalizeSlug('--hi--'), 'hi');
  assert.strictEqual(normalizeSlug('a b   c'), 'a-b-c');
});

test('isValidSlug enforces length, charset, and reserved names', () => {
  assert.strictEqual(isValidSlug('warchief'), true);
  assert.strictEqual(isValidSlug('war-chief-7'), true);
  assert.strictEqual(isValidSlug('ab'), false);          // too short
  assert.strictEqual(isValidSlug('-nope'), false);       // leading hyphen
  assert.strictEqual(isValidSlug('nope-'), false);       // trailing hyphen
  assert.strictEqual(isValidSlug('has space'), false);   // space
  assert.strictEqual(isValidSlug('admin'), false);       // reserved
  assert.strictEqual(isValidSlug('movers'), false);      // reserved
});

test('commissionDisplay shows the dollars a mover earns, not a bare percentage', () => {
  const d = commissionDisplay(32500);   // $325 Dream
  assert.strictEqual(d.cents, 1625);
  assert.strictEqual(d.dollars, 16.25);
  assert.strictEqual(d.label, '$16.25');

  const floor = commissionDisplay(1000); // $10 Dream
  assert.strictEqual(floor.label, '$0.50');
});
