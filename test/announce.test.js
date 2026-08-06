'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const orig = Module.prototype.require;

function withDb(handlers, fn) {
  const sent = [];
  Module.prototype.require = function (p) {
    if (p.endsWith('config/db')) return { query: async (sql, params) => handlers(sql, params) };
    if (p.endsWith('services/email') || p === '../email') return { sendBatch: async (b) => { sent.push(...b); return { sent: b.length }; } };
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/services/clay/announce')];
    return fn(require('../src/services/clay/announce'), sent);
  } finally {
    Module.prototype.require = orig;
    delete require.cache[require.resolve('../src/services/clay/announce')];
  }
}

test('the pricing notice states the change, and what is NOT changing', async () => {
  await withDb(() => ({ rows: [] }), async (m) => {
    const a = m.preview('pricing-2026-08');
    assert.match(a.text, /first project is now free/i);
    assert.match(a.text, /\$19 a month/);
    assert.match(a.text, /building with me is still free and unlimited/i);
    // The part people most need and companies most often omit.
    assert.match(a.text, /already on an older plan, nothing about it changes/i);
    assert.match(a.text, /not moving anyone onto the new plan/i);
  });
});

test('the marketplace fee is described the way it actually works', async () => {
  await withDb(() => ({ rows: [] }), async (m) => {
    const a = m.preview('pricing-2026-08');
    assert.match(a.text, /whether we sent the buyer or you did/i, 'no "only when we bring the buyer"');
    assert.match(a.text, /we take nothing at all/i, 'own-website sales are free');
  });
});

test('an announcement can never be sent twice', async () => {
  await withDb((sql) => {
    if (/FROM email_log/i.test(sql)) return { rows: [{ n: 1 }] };   // already recorded
    return { rows: [] };
  }, async (m, sent) => {
    const out = await m.send('pricing-2026-08');
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.reason, 'already_sent');
    assert.strictEqual(sent.length, 0, 'and nothing goes out');
  });
});

test('it reaches every account holder, not just magazine subscribers', async () => {
  let recipientSql = '';
  await withDb((sql) => {
    if (/FROM email_log/i.test(sql)) return { rows: [{ n: 0 }] };
    if (/FROM users/i.test(sql)) { recipientSql = sql; return { rows: [
      { id: 'u1', email: 'a@x.com', name: 'Ada' }, { id: 'u2', email: 'b@x.com', name: 'Bo' }] }; }
    return { rows: [] };
  }, async (m, sent) => {
    const out = await m.send('pricing-2026-08');
    assert.strictEqual(out.sent, 2);
    assert.strictEqual(sent.length, 2);
    // A change to what someone pays is an account notice: leaving the magazine must not exclude them.
    assert.ok(!/weekly\s*=\s*true/i.test(recipientSql), 'must not filter on the magazine opt-in');
    assert.match(recipientSql, /status <> 'suspended'/);
    assert.match(sent[0].text, /Hi Ada/);
  });
});
