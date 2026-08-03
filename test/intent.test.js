const { test } = require('node:test');
const assert = require('node:assert');
const intent = require('../src/services/clay/intent');

test('PATHS: exactly the three creator plans, each fully described', () => {
  const ids = intent.PATHS.map((p) => p.id);
  assert.deepStrictEqual(ids, ['build_myself', 'refine_to_sell', 'exploring']);
  assert.deepStrictEqual(intent.PATH_IDS, ids);
  for (const p of intent.PATHS) {
    assert.ok(p.label && typeof p.label === 'string', `${p.id} has a label`);
    assert.ok(p.short && typeof p.short === 'string', `${p.id} has a short line`);
    assert.ok(p.coaching && p.coaching.length > 20, `${p.id} has coaching guidance`);
  }
});

test('EARNING_PATHS: the four ways to earn, each with a plain how', () => {
  const ids = intent.EARNING_PATHS.map((p) => p.id);
  assert.deepStrictEqual(ids, ['sell_your_ideas', 'resell_ideas', 'launch_business', 'consult']);
  for (const p of intent.EARNING_PATHS) {
    assert.ok(p.title && typeof p.title === 'string', `${p.id} has a title`);
    assert.ok(p.how && p.how.length > 20, `${p.id} explains how you earn`);
  }
});

test('pathById resolves known ids and rejects unknown', () => {
  assert.strictEqual(intent.pathById('build_myself').label, 'Build it myself');
  assert.strictEqual(intent.pathById('refine_to_sell').label, 'Refine it to sell');
  assert.strictEqual(intent.pathById('nope'), null);
});

test('setIntent guards: missing ids and invalid path never touch the DB', async () => {
  const noIds = await intent.setIntent(null, null, 'build_myself');
  assert.deepStrictEqual(noIds, { ok: false, reason: 'missing_ids' });

  const badPath = await intent.setIntent('11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222', 'not_a_path');
  assert.deepStrictEqual(badPath, { ok: false, reason: 'invalid_path' });
});
