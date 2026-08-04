const { test } = require('node:test');
const assert = require('node:assert');
const sp = require('../src/services/clay/sitePages');

test('slugify makes url-safe slugs and never empty', () => {
  assert.strictEqual(sp.slugify('Getting Started as a Blind Parent'), 'getting-started-as-a-blind-parent');
  assert.strictEqual(sp.slugify('  Résumé & Tips!!  '), 'resume-tips');
  assert.strictEqual(sp.slugify(''), 'page');
  assert.strictEqual(sp.slugify('***'), 'page');
});

test('cleanTitle trims and caps at 120', () => {
  assert.strictEqual(sp.cleanTitle('  Hello  '), 'Hello');
  assert.strictEqual(sp.cleanTitle('x'.repeat(200)).length, 120);
});

test('cleanBody caps at 20000 and coerces null to empty', () => {
  assert.strictEqual(sp.cleanBody(null), '');
  assert.strictEqual(sp.cleanBody('a'.repeat(25000)).length, 20000);
});

test('normKind only allows page or post', () => {
  assert.strictEqual(sp.normKind('post'), 'post');
  assert.strictEqual(sp.normKind('page'), 'page');
  assert.strictEqual(sp.normKind('nonsense'), 'page');
  assert.strictEqual(sp.normKind(undefined), 'page');
});
