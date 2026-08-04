const { test } = require('node:test');
const assert = require('node:assert');
const b = require('../src/services/clay/brief');

test('parseBrief keeps only the four known fields, trimmed', () => {
  const out = b.parseBrief({ problem: '  a real pain  ', customer: 'small HR teams', earning: 'a few hundred a month', why_you: 'you know the space', junk: 'ignored', evil: '<script>' });
  assert.deepStrictEqual(out, { problem: 'a real pain', customer: 'small HR teams', earning: 'a few hundred a month', why_you: 'you know the space' });
});

test('parseBrief drops empty/whitespace values and returns null if nothing usable', () => {
  assert.strictEqual(b.parseBrief({ problem: '   ', customer: '' }), null);
  assert.strictEqual(b.parseBrief({}), null);
  assert.strictEqual(b.parseBrief(null), null);
  assert.strictEqual(b.parseBrief('not an object'), null);
});

test('parseBrief allows a partial brief', () => {
  assert.deepStrictEqual(b.parseBrief({ problem: 'x', earning: 'y' }), { problem: 'x', earning: 'y' });
});

test('parseBrief caps overly long values', () => {
  const long = 'z'.repeat(500);
  const out = b.parseBrief({ problem: long });
  assert.ok(out.problem.length <= 240);
});

test('parseBrief ignores non-string values', () => {
  assert.strictEqual(b.parseBrief({ problem: 123, customer: {}, earning: [] }), null);
});
