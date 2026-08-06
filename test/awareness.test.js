'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const orig = Module.prototype.require;

function withRow(row, fn) {
  Module.prototype.require = function (p) {
    if (p.endsWith('config/db')) return { query: async (sql) => ({ rows: /FROM partner_requests pr/.test(sql) ? [] : [row] }) };
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/services/clay/awareness')];
    return fn(require('../src/services/clay/awareness'));
  } finally {
    Module.prototype.require = orig;
    delete require.cache[require.resolve('../src/services/clay/awareness')];
  }
}
const base = { projects:0, moving:0, live_listings:0, payouts_ready:0, is_mover:0,
  sales_cents:0, pending_cents:0, mover_cents:0, my_asks:0, hands_waiting:0, watching:0,
  dreamer_tag:null, open_to_partnering:false };

test('a zero is stated as a zero, and Clay is told not to soften it', async () => {
  const out = await withRow(base, (m) => m.renderAwareness('u1'));
  assert.match(out, /nothing yet/i);
  assert.match(out, /Do not soften this/i);
});

test('money in escrow is never presented as earnings', async () => {
  const out = await withRow({ ...base, projects:1, live_listings:1, pending_cents: 7500 }, (m) => m.renderAwareness('u1'));
  assert.match(out, /\$75\.00 is in escrow/);
  assert.match(out, /NOT theirs yet, never call it earnings/i);
  assert.ok(!/Earned so far: \$75/.test(out), 'escrow must not appear as earnings');
});

test('live listings with no payout account is flagged as the blocker it is', async () => {
  const out = await withRow({ ...base, projects:2, live_listings:3, payouts_ready:0 }, (m) => m.renderAwareness('u1'));
  assert.match(out, /BLOCKER/);
  assert.match(out, /could not reach them/i);
});

test('Clay is told this is background, not something to recite', async () => {
  const out = await withRow(base, (m) => m.renderAwareness('u1'));
  assert.match(out, /do not\s+recite it back/i);
  assert.match(out, /if it is not relevant .* say nothing/i);
});

test('awareness failing never breaks the conversation', async () => {
  Module.prototype.require = function (p) {
    if (p.endsWith('config/db')) return { query: async () => { throw new Error('db down'); } };
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/services/clay/awareness')];
    const m = require('../src/services/clay/awareness');
    assert.strictEqual(await m.renderAwareness('u1'), null, 'returns nothing rather than throwing');
  } finally {
    Module.prototype.require = orig;
    delete require.cache[require.resolve('../src/services/clay/awareness')];
  }
});
