'use strict';
// TODAY'S TOP LINE SAYS WHAT ITS RANKING MEANS.
//
// Walked 16 Sept 2026: the Businesses screen said the costliest thing was a $60 1099 due in January,
// and Today, a moment later, said "the one that costs most is" a $25 statutory agent. Both lists were
// right; Today's sentence was not, because Today ranks by urgency and cost together.
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../src/lib/ranking');

test('the top row is what to start with, not called the costliest', () => {
  const s = R.summarise([
    { title: 'Keep a statutory agent on file in Ohio', cost_if_missed_cents: 2500 },
    { title: 'File the quarterly return', cost_if_missed_cents: 40000 },
  ]);
  assert.match(s, /^2 things need you\. Start with Keep a statutory agent on file in Ohio, which costs \$25/);
  assert.match(s, /The costliest is File the quarterly return at \$400\./);
  assert.doesNotMatch(s, /costs most/);
});

test('when the top row is also the costliest, it is not named twice', () => {
  const s = R.summarise([
    { title: 'A', cost_if_missed_cents: 9000 },
    { title: 'B', cost_if_missed_cents: 100 },
    { title: 'C', cost_if_missed_cents: null },
  ]);
  assert.doesNotMatch(s, /costliest/);
});

test('an unknown cost is not treated as zero or as the costliest', () => {
  const s = R.summarise([{ title: 'Get a W-9', cost_if_missed_cents: null }]);
  assert.strictEqual(s, 'One thing needs you. Start with Get a W-9.');
});
