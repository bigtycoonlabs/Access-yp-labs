'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// The path is only worth having if it is honest, so these tests guard the honesty, not the layout.
const Module = require('module');
const orig = Module.prototype.require;
function withRow(row, fn) {
  Module.prototype.require = function (p) {
    if (p.endsWith('config/db')) return { query: async () => ({ rows: [row] }) };
    if (p.endsWith('middleware/auth')) return { authenticate: (req, _r, n) => { req.user = { id: 'u1' }; n(); }, authorize: () => (_q, _s, n) => n() };
    return orig.apply(this, arguments);
  };
  try { delete require.cache[require.resolve('../src/routes/progress')]; return fn(require('../src/routes/progress')); }
  finally { Module.prototype.require = orig; delete require.cache[require.resolve('../src/routes/progress')]; }
}
async function call(router) {
  const express = require('express');
  const app = express(); app.use('/p', router);
  const srv = app.listen(0);
  try {
    const port = srv.address().port;
    return await (await fetch('http://127.0.0.1:' + port + '/p')).json();
  } finally { srv.close(); }
}

test('a brand-new person is told plainly that they have earned nothing', async () => {
  const out = await withRow({ projects: 0, moving: 0, live_listings: 0, payouts_ready: 0, is_mover: 0, sales_cents: 0, pending_cents: 0, mover_cents: 0 }, call);
  assert.strictEqual(out.completed, 0);
  assert.strictEqual(out.earned_cents, 0);
  assert.match(out.earned_spoken, /not earned anything yet/i);
  assert.strictEqual(out.next.key, 'shape');
});

test('money sitting in escrow is NEVER counted as earned', async () => {
  const out = await withRow({ projects: 1, moving: 0, live_listings: 1, payouts_ready: 0, is_mover: 0, sales_cents: 0, pending_cents: 5000, mover_cents: 0 }, call);
  assert.strictEqual(out.earned_cents, 0, 'escrow is not earnings');
  assert.strictEqual(out.pending_cents, 5000);
  assert.match(out.earned_spoken, /not yours yet|escrow/i);
});

test('released sales and mover commissions both count as real earnings', async () => {
  const out = await withRow({ projects: 2, moving: 1, live_listings: 1, payouts_ready: 1, is_mover: 1, sales_cents: 9000, pending_cents: 0, mover_cents: 1000 }, call);
  assert.strictEqual(out.earned_cents, 10000);
  assert.match(out.earned_spoken, /\$100\.00/);
  assert.strictEqual(out.next, null, 'every step done leaves no next step');
});

test('every step carries spoken text and a title, so the path works read aloud', async () => {
  const out = await withRow({ projects: 0, moving: 0, live_listings: 0, payouts_ready: 0, is_mover: 0, sales_cents: 0, pending_cents: 0, mover_cents: 0 }, call);
  assert.ok(out.steps.length >= 5);
  out.steps.forEach((s) => { assert.ok(s.title && s.spoken, 'step needs a title and spoken line'); });
});
