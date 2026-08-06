'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const orig = Module.prototype.require;

// Drive the settlement service against a scripted database so the real branches run.
function withDb(handlers, fn) {
  const sent = [];
  Module.prototype.require = function (p) {
    if (p.endsWith('config/db')) return { query: async (sql, params) => handlers(sql, params) };
    if (p.endsWith('services/email') || p === '../email') return { sendEmail: async (m) => { sent.push(m); return { sent: true }; } };
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/services/clay/auctions')];
    return fn(require('../src/services/clay/auctions'), sent);
  } finally {
    Module.prototype.require = orig;
    delete require.cache[require.resolve('../src/services/clay/auctions')];
  }
}

test('a closed auction with bids records the winner and tells BOTH sides', async () => {
  const out = await withDb((sql) => {
    if (/FROM bids/i.test(sql)) return { rows: [{ id: 'b1', bidder_id: 'u2', amount_cents: 5000, email: 'w@x.com', name: 'Win' }] };
    if (/UPDATE listings/i.test(sql)) return { rows: [{ id: 'l1', concept_id: 'c1', seller_id: 'u1' }] };
    if (/JOIN concepts/i.test(sql)) return { rows: [{ title: 'Southpaw', seller_email: 's@x.com', seller_name: 'Sel' }] };
    return { rows: [] };
  }, async (mod, sent) => {
    const r = await mod.settleOne('l1');
    assert.strictEqual(r.winner, 'u2');
    assert.strictEqual(r.amount_cents, 5000);
    assert.strictEqual(sent.length, 2, 'winner AND seller are both told');
    const all = sent.map((m) => m.text).join(' ');
    assert.match(all, /\$50\.00/);
    assert.match(all, /Nothing has been charged yet/i, 'the winner is told no money moved');
    return r;
  });
  assert.ok(out);
});

test('a closed auction with NO bids still tells the seller, honestly', async () => {
  await withDb((sql) => {
    if (/FROM bids/i.test(sql)) return { rows: [] };
    if (/UPDATE listings/i.test(sql)) return { rows: [{ id: 'l1', concept_id: 'c1', seller_id: 'u1' }] };
    if (/JOIN concepts/i.test(sql)) return { rows: [{ title: 'Southpaw', seller_email: 's@x.com', seller_name: 'Sel' }] };
    return { rows: [] };
  }, async (mod, sent) => {
    const r = await mod.settleOne('l1');
    assert.strictEqual(r.winner, null);
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0].text, /without any bids/i);
    assert.match(sent[0].text, /nothing was charged/i);
  });
});

test('an auction already settled by another worker is not settled or emailed twice', async () => {
  await withDb((sql) => {
    if (/FROM bids/i.test(sql)) return { rows: [{ id: 'b1', bidder_id: 'u2', amount_cents: 5000, email: 'w@x.com', name: 'Win' }] };
    if (/UPDATE listings/i.test(sql)) return { rows: [] };   // the claim matched nothing: someone won the race
    return { rows: [] };
  }, async (mod, sent) => {
    const r = await mod.settleOne('l1');
    assert.strictEqual(r, null, 'settling twice returns nothing');
    assert.strictEqual(sent.length, 0, 'and sends no duplicate email');
  });
});

test('one broken auction does not stop the others from settling', async () => {
  await withDb((sql, params) => {
    if (/FROM listings/i.test(sql) && /auction_close_at <= now/i.test(sql)) return { rows: [{ id: 'bad' }, { id: 'good' }] };
    if (/FROM bids/i.test(sql)) {
      if (params && params[0] === 'bad') throw new Error('database hiccup');
      return { rows: [] };
    }
    if (/UPDATE listings/i.test(sql)) return { rows: [{ id: 'good', concept_id: 'c1', seller_id: 'u1' }] };
    if (/JOIN concepts/i.test(sql)) return { rows: [{ title: 'T', seller_email: 's@x.com', seller_name: 'S' }] };
    return { rows: [] };
  }, async (mod) => {
    const r = await mod.settleDue();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.settled, 1, 'the healthy auction still settled');
  });
});
