const { test } = require('node:test');
const assert = require('node:assert');
const lp = require('../src/services/clay/launchPage');

test('slugify makes a URL-safe slug and is never empty', () => {
  assert.strictEqual(lp.slugify('PlainPage Policy Guides!'), 'plainpage-policy-guides');
  assert.strictEqual(lp.slugify('  Multiple   spaces  '), 'multiple-spaces');
  assert.strictEqual(lp.slugify('—$$$—'), 'idea');
  assert.strictEqual(lp.slugify(''), 'idea');
  assert.ok(!/[^a-z0-9-]/.test(lp.slugify('Café & Co. #1')));
});

test('slugify caps length and trims trailing dashes', () => {
  const s = lp.slugify('a'.repeat(80));
  assert.ok(s.length <= 40);
  assert.ok(!s.endsWith('-'));
});

test('parseConfig trims, caps, and always returns the four fields', () => {
  const c = lp.parseConfig({ headline: '  Prove it  ', subhead: 'x', blurb: 'y', cta_label: 'Join' });
  assert.deepStrictEqual(c, { headline: 'Prove it', subhead: 'x', blurb: 'y', cta_label: 'Join' });
});

test('parseConfig defaults the CTA when missing', () => {
  assert.strictEqual(lp.parseConfig({ headline: 'x' }).cta_label, lp.DEFAULT_CTA);
  assert.strictEqual(lp.parseConfig({}).cta_label, lp.DEFAULT_CTA);
  assert.strictEqual(lp.parseConfig(null).cta_label, lp.DEFAULT_CTA);
});

test('parseConfig caps an overly long blurb', () => {
  assert.ok(lp.parseConfig({ blurb: 'z'.repeat(2000) }).blurb.length <= lp.CAPS.blurb);
});
