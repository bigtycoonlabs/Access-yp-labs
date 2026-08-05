'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ent = require('../src/services/clay/enterprise');

// ---- validatePlan --------------------------------------------------------------------------

test('validatePlan rejects junk and missing pieces', () => {
  assert.equal(ent.validatePlan(null).ok, false);
  assert.equal(ent.validatePlan('nope').ok, false);
  assert.equal(ent.validatePlan({}).ok, false);
  assert.equal(ent.validatePlan({ title: '', children: [{ title: 'A', brief: 'b' }] }).ok, false);
  assert.equal(ent.validatePlan({ title: 'X', children: [] }).reason, 'no_children');
  assert.equal(ent.validatePlan({ title: 'X', children: [{ title: '', brief: '' }] }).reason, 'no_children');
});

test('validatePlan accepts a good plan and keeps a valid category', () => {
  const r = ent.validatePlan({
    title: 'Acme Holdings',
    thesis: 'A house of small e-commerce brands.',
    children: [{ title: 'Store One', brief: 'Sells hats.', category: 'ecommerce_pod' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.plan.title, 'Acme Holdings');
  assert.equal(r.plan.children.length, 1);
  assert.equal(r.plan.children[0].category, 'ecommerce_pod');
});

test('validatePlan nulls an unrecognized category rather than guessing', () => {
  const r = ent.validatePlan({
    title: 'X', children: [{ title: 'A', brief: 'b', category: 'not_a_real_lane' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.plan.children[0].category, null);
});

test('validatePlan dedupes children by title and caps at MAX_CHILDREN', () => {
  const many = [];
  for (let i = 0; i < ent.MAX_CHILDREN + 5; i++) many.push({ title: 'V' + i, brief: 'b' });
  many.push({ title: 'V0', brief: 'dupe' }); // duplicate of first
  const r = ent.validatePlan({ title: 'Big', children: many });
  assert.equal(r.ok, true);
  assert.equal(r.plan.children.length, ent.MAX_CHILDREN);
  const titles = r.plan.children.map((c) => c.title);
  assert.equal(new Set(titles).size, titles.length, 'no duplicates survive');
});

// ---- parseLooseJson ------------------------------------------------------------------------

test('parseLooseJson handles clean, fenced, and prose-wrapped JSON', () => {
  assert.deepEqual(ent.parseLooseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(ent.parseLooseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(ent.parseLooseJson('Here you go: {"a":1} — enjoy'), { a: 1 });
  assert.equal(ent.parseLooseJson('not json at all'), null);
  assert.equal(ent.parseLooseJson(''), null);
});

// ---- prompt builders -----------------------------------------------------------------------

test('childBuildPrompt names the venture and its enterprise', () => {
  const p = ent.childBuildPrompt({ title: 'Store One', brief: 'Sells hats.' }, 'Acme Holdings', 'thesis here');
  assert.match(p, /Store One/);
  assert.match(p, /Acme Holdings/);
  assert.match(p, /Sells hats\./);
});

test('assemblePrompt lists the built ventures under the parent', () => {
  const p = ent.assemblePrompt('Acme Holdings', 'thesis', [
    { title: 'Store One', brief: 'hats' },
    { title: 'Store Two', brief: 'socks' },
  ]);
  assert.match(p, /Acme Holdings/);
  assert.match(p, /Store One/);
  assert.match(p, /Store Two/);
  assert.match(p, /2 ventures/);
});

test('buildPlanUser folds in attached sources but stays bounded', () => {
  const big = 'x'.repeat(50000);
  const u = ent.buildPlanUser('make an empire', [{ filename: 'doc.txt', text: big }]);
  assert.match(u, /make an empire/);
  assert.match(u, /doc\.txt/);
  assert.ok(u.length < 20000, 'source context is capped');
});

// ---- planEnterprise (provider injected — no network) ----------------------------------------

function fakeProvider(resp) {
  return { available: () => true, complete: async () => resp };
}

test('planEnterprise is honest when the builder is not connected', async () => {
  const r = await ent.planEnterprise({ prompt: 'x', provider: { available: () => false } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unavailable');
});

test('planEnterprise returns a validated plan from good model JSON', async () => {
  const json = JSON.stringify({
    title: 'Cooper Commerce Group',
    thesis: 'A holding company over several e-commerce brands.',
    children: [
      { title: 'Brand A', brief: 'Sells A.', category: 'ecommerce_pod' },
      { title: 'Brand B', brief: 'Sells B.', category: 'ecommerce_pod' },
    ],
  });
  const r = await ent.planEnterprise({ prompt: '12 stores + a holding co', provider: fakeProvider({ ok: true, text: json }) });
  assert.equal(r.ok, true);
  assert.equal(r.plan.children.length, 2);
  assert.equal(r.plan.title, 'Cooper Commerce Group');
});

test('planEnterprise reports unparseable output rather than inventing a plan', async () => {
  const r = await ent.planEnterprise({ prompt: 'x', provider: fakeProvider({ ok: true, text: 'the model rambled with no json' }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unparseable');
});

test('planEnterprise surfaces a provider failure honestly', async () => {
  const r = await ent.planEnterprise({ prompt: 'x', provider: fakeProvider({ ok: false, reason: 'timeout' }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timeout');
});
