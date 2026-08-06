'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const orig = Module.prototype.require;

function withDb(handlers, fn) {
  const sent = [];
  Module.prototype.require = function (p) {
    if (p.endsWith('config/db')) return { query: async (sql, params) => handlers(sql, params) };
    if (p.endsWith('services/email') || p === '../email') {
      return { sendBatch: async (batch) => { sent.push(...batch); return { sent: batch.length }; } };
    }
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/services/clay/watchActivity')];
    return fn(require('../src/services/clay/watchActivity'), sent);
  } finally {
    Module.prototype.require = orig;
    delete require.cache[require.resolve('../src/services/clay/watchActivity')];
  }
}

test('several things happening to one dream become ONE message, not several', async () => {
  await withDb((sql) => {
    if (/FROM listing_events/i.test(sql)) return { rows: [
      { id: 'e1', listing_id: 'L1', kind: 'bid', detail: 'Someone placed a bid of $50.00.', title: 'Southpaw' },
      { id: 'e2', listing_id: 'L1', kind: 'bid', detail: 'Someone placed a bid of $60.00.', title: 'Southpaw' },
      { id: 'e3', listing_id: 'L1', kind: 'value_added', detail: 'The creator added to it.', title: 'Southpaw' },
    ] };
    if (/FROM watches/i.test(sql)) return { rows: [{ email: 'w@x.com', name: 'Ada', token: 'tok' }] };
    return { rows: [] };
  }, async (mod, sent) => {
    const out = await mod.notifyWatchers();
    assert.strictEqual(out.events, 3);
    assert.strictEqual(sent.length, 1, 'one watcher gets one email, not three');
    assert.match(sent[0].text, /\$50\.00/);
    assert.match(sent[0].text, /\$60\.00/, 'and it contains every update');
    assert.match(sent[0].subject, /3 updates/);
  });
});

test('every notice carries a one-click way to stop', async () => {
  await withDb((sql) => {
    if (/FROM listing_events/i.test(sql)) return { rows: [{ id: 'e1', listing_id: 'L1', kind: 'sold', detail: 'It has been claimed.', title: 'Southpaw' }] };
    if (/FROM watches/i.test(sql)) return { rows: [{ email: 'w@x.com', name: 'Ada', token: 'tok' }] };
    return { rows: [] };
  }, async (mod, sent) => {
    await mod.notifyWatchers();
    assert.match(sent[0].text, /watch\/unsubscribe\/tok/);
    assert.ok(sent[0].headers['List-Unsubscribe'], 'and the mail client can do it too');
  });
});

test('the watcher query excludes the seller and anyone who switched watch mail off', async () => {
  let seen = '';
  await withDb((sql) => {
    if (/FROM listing_events/i.test(sql)) return { rows: [{ id: 'e1', listing_id: 'L1', kind: 'bid', detail: 'x', title: 'T' }] };
    if (/FROM watches/i.test(sql)) { seen = sql; return { rows: [] }; }
    return { rows: [] };
  }, async (mod) => { await mod.notifyWatchers(); });
  assert.match(seen, /watch_activity = true/, 'respects the opt-out');
  assert.match(seen, /w\.user_id <> l\.seller_id/, 'never tells the seller about their own listing');
});

test('events are marked handled even when nobody is watching, so the queue cannot grow forever', async () => {
  let marked = false;
  await withDb((sql) => {
    if (/FROM listing_events/i.test(sql)) return { rows: [{ id: 'e1', listing_id: 'L1', kind: 'bid', detail: 'x', title: 'T' }] };
    if (/FROM watches/i.test(sql)) return { rows: [] };
    if (/UPDATE listing_events SET notified_at/i.test(sql)) { marked = true; return { rows: [] }; }
    return { rows: [] };
  }, async (mod) => { await mod.notifyWatchers(); });
  assert.ok(marked);
});
