'use strict';
// CLAY IS RETIRED, AND EVERYBODY STARTS CLEAN (owner, 16 September 2026).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const read = (f) => fs.readFileSync(f, 'utf8');

test('old marketplace and Clay addresses redirect to where that job lives now', async () => {
  const app = require('../src/server');
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
  for (const [from, to] of [['/dreamhold.html', '/'], ['/app.html', '/today.html'], ['/clay-chat.html', '/penny.html'],
    ['/marketplace.html', '/'], ['/concept.html', '/businesses.html'], ['/weekly', '/'], ['/weekly/some-issue', '/'],
    ['/market/35a239ff-cfdf-4e68-b2ee-b56dbdef9ae9', '/']]) {
    const r = await fetch(base + from, { redirect: 'manual' });
    assert.strictEqual(r.status, 301, from);
    assert.strictEqual(r.headers.get('location'), to, from);
  }
  } finally { server.close(); }
});

test('no scheduled job emails anybody about projects, listings or the magazine', () => {
  const server = read('src/server.js');
  for (const gone of ['runNudges', 'runExpirySweep', 'seedScheduler', 'settleDue', 'notifyWatchers', "clay/weekly')", 'proofPrompt']) {
    assert.ok(!server.includes(gone), gone + ' is still scheduled');
  }
});

test('every email comes from Penny', () => {
  assert.match(read('src/services/email.js'), /const DEFAULT_FROM = 'Penny at Access YP Labs <penny@accessyplabs\.com>'/);
  const { welcomeEmail } = require('../src/services/welcomeEmail');
  const w = welcomeEmail('Dana Brooks');
  assert.match(w.text, /Hi Dana, I’m Penny\./);
  assert.doesNotMatch(w.text + w.html, /Clay|Exchange/);
  assert.match(read('src/services/clay/staffNotify.js'), /subject: 'Penny: ' \+ subject/);
});

test('the pages people use no longer mention Clay or the Exchange', () => {
  for (const f of ['index.html', 'login.html', 'register.html', 'desk.html', 'terms.html', 'privacy.html', 'risk.html',
    'values.html', 'plans.html', 'today.html', 'penny.html', 'reset.html']) {
    const s = read('public/' + f).replace(/\/api\/clay\//g, '');
    assert.doesNotMatch(s, /\bClay\b/, f + ' still mentions Clay');
    assert.doesNotMatch(s, /dreamhold\.html|The Exchange<|Enter the Exchange/, f + ' still sends people to the Exchange');
  }
  const pages = read('src/routes/deskPages.js');
  assert.doesNotMatch(pages, /Clay's Desk|Clay Weekly|name: 'Clay'/);
});

test('the clean-slate migration moves people’s projects and retires the rest, once', () => {
  const sql = read('docs/migrations/075_clean_slate.sql');
  assert.match(sql, /WHERE retired_at IS NULL AND owner_id IS DISTINCT FROM clay/);
  assert.match(sql, /INSERT INTO yp_labs\.businesses \(owner_id, name, stage\)[\s\S]*'idea'/);
  assert.match(sql, /AND is_current AND/);
  assert.match(sql, /UPDATE yp_labs\.listings SET status = 'withdrawn'/);
  assert.match(sql, /UPDATE yp_labs\.users SET status = 'suspended' WHERE id = clay/);
  assert.match(sql, /encode\(sha256\(bytes_\), 'hex'\)/, 'core sha256, so a rebuild without pgcrypto still works');
});

test('the update email starts with Clay, then Penny, and tells each person what happened to their work', () => {
  const E = require('../src/services/pennyEmails');
  const withWork = E.updateEmail({ name: 'Hannah Weigand', standing: 'free', moved: ['Candle box'] });
  assert.strictEqual(withWork.subject, 'Clay is retiring. Access YP Labs has been reborn.');
  assert.ok(withWork.text.indexOf('it’s Clay, one last time') < withWork.text.indexOf('I’m Penny'));
  assert.match(withWork.text, /Your project is now a business in your account/);
  assert.match(withWork.text, /- Candle box/);
  assert.match(withWork.text, /Desk is \$55 a month and Office is \$99/);
  const staff = E.updateEmail({ name: 'Rel', standing: 'staff', moved: [] });
  assert.match(staff.text, /no monthly limits/);
  assert.match(staff.text, /nothing of yours was lost/);
  assert.match(staff.html, /<h1[^>]*>Clay is retiring\. Access YP Labs has been reborn\.<\/h1>/);
  assert.match(staff.html, /<h2[^>]*>What I do for your business<\/h2>/);
});

test('the rebirth update never sends unconfirmed, never twice, and counts only accepted mail', async () => {
  const src = fs.readFileSync('src/services/rebirthUpdate.js', 'utf8');
  assert.match(src, /if \(confirm !== 'send the rebirth update'\) return \{ ok: false/);
  assert.match(src, /if \(r\.already\) \{ results\.push/);
  assert.match(src, /sent: !!\(out && out\.sent\)/);
  assert.match(src, /NOT \(u\.status = ANY\(\$3\)\)/);
  assert.match(src, /\['suspended'\]\]\);/);
  assert.match(src, /NOT ILIKE '%@example\.test'/);
  const R = require('../src/services/rebirthUpdate');
  const r = await R.sendAll({});
  assert.strictEqual(r.ok, false);
});
