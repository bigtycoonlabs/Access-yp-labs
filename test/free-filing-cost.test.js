'use strict';
// A FREE FILING IS NOT FREE TO MISS.
//
// Walked on production 16 Sept 2026: a Texas LLC was told its franchise tax report "costs $0" if
// missed, in the same sentence that said missing it forfeits the company. The filing fee had been
// used as the cost of missing it. Texas charges $50 per late report (Comptroller, checked
// 2026-09-16); Minnesota has no late fee and dissolves the company instead.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../src/services/clay/states');

const flat = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);

test('no state rule ever says missing something costs $0', () => {
  const zero = [];
  for (const code of S.ALL_STATES) {
    for (const r of flat(S.stateRule(code, { formed_on: '2020-03-10' }))) {
      if (r && r.cost_if_missed_cents === 0) zero.push(code + ': ' + r.title);
    }
  }
  assert.deepStrictEqual(zero, []);
});

test('Texas is $50 per late report, and says it is an estimate', () => {
  const r = flat(S.stateRule('TX', {}))[0];
  assert.strictEqual(r.cost_if_missed_cents, 5000);
  assert.strictEqual(r.cost_basis, 'estimated');
  assert.match(r.cost_note, /charged \$50 even with no tax due/);
});

test('Minnesota has no late fee, so the cost is unknown rather than zero', () => {
  const r = flat(S.stateRule('MN', {}))[0];
  assert.strictEqual(r.cost_if_missed_cents, null);
  assert.strictEqual(r.cost_basis, 'unknown');
  assert.match(r.consequence, /dissolution/);
});

test('a state with a real fee still ranks on it', () => {
  const r = flat(S.stateRule('MA', { formed_on: '2020-03-10' }))[0];
  assert.strictEqual(r.cost_if_missed_cents, 50000);
  assert.strictEqual(r.cost_basis, 'known');
});
