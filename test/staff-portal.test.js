'use strict';
// THE STAFF PORTAL, redesigned 17 September 2026: six pages, one nav, nothing from the retired product.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const PAGES = ['index', 'members', 'money', 'penny', 'desk', 'email'];

test('six pages, each with its own title, one main, a skip link and the shared nav', () => {
  const titles = new Set();
  for (const p of PAGES) {
    const s = fs.readFileSync('public/staff/' + p + '.html', 'utf8');
    const t = s.match(/<title>([^<]+)<\/title>/)[1];
    titles.add(t);
    assert.strictEqual((s.match(/<main/g) || []).length, 1, p);
    assert.match(s, /<a class="skip" href="#main">/);
    assert.match(s, /<nav id="staffnav" class="staffnav[^"]*" aria-label="Staff areas">/);
    assert.match(s, /role="status" aria-live="polite"/);
    assert.match(s, /noindex, nofollow/);
    assert.match(s, new RegExp('/js/staff-' + p + '\\.js'));
    assert.doesNotMatch(s, /Clay|Exchange|Weekly/);
  }
  assert.strictEqual(titles.size, PAGES.length, 'every page has its own title');
});

test('the nav marks where you are and is the same everywhere', () => {
  const s = fs.readFileSync('public/js/staff.js', 'utf8');
  assert.match(s, /aria-current="page"/);
  for (const p of ['/staff/', '/staff/members.html', '/staff/money.html', '/staff/penny.html', '/staff/desk.html', '/staff/email.html']) {
    assert.ok(s.includes("'" + p + "'"), p);
  }
  assert.match(fs.readFileSync('public/js/nav.js', 'utf8'), /link\('\/staff\/', 'Staff'\)/);
});

test('the data is staff-only, and nothing in it comes from the retired product', () => {
  const r = fs.readFileSync('src/routes/staffPortal.js', 'utf8');
  assert.match(r, /const staffOnly = \[authenticate, authorize\('staff', 'admin', 'master_staff'\)\]/);
  const routes = r.match(/router\.get\('[^']+', staffOnly/g) || [];
  assert.strictEqual(routes.length, 5);
  assert.strictEqual((r.match(/router\.get\(/g) || []).length, 5, 'every route is staff-only');
  assert.doesNotMatch(r, /listings|concepts|clay_runs|orders_transfers/);
  assert.doesNotMatch(r, /router\.(post|delete|patch)/, 'read-only; actions reuse the existing endpoints');
});

test('the old staff screens redirect to the new ones', async () => {
  const app = require('../src/server');
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [from, to] of [['/console.html', '/staff/'], ['/market-control.html', '/staff/'], ['/weekly-admin.html', '/staff/'],
      ['/staff', '/staff/'], ['/admin-clay.html', '/staff/penny.html'], ['/desk-admin.html', '/staff/desk.html'], ['/people.html', '/staff/members.html']]) {
      const res = await fetch(base + from, { redirect: 'manual' });
      assert.strictEqual(res.status, 301, from);
      assert.strictEqual(res.headers.get('location'), to, from);
    }
    const home = await (await fetch(base + '/staff/')).text();
    assert.match(home, /<title>Today, staff, Access YP Labs<\/title>/, '/staff/ serves the portal, not the homepage');
  } finally { server.close(); }
});

test('a failure is said in words, and resolving an alert needs a note', () => {
  const s = fs.readFileSync('public/js/staff.js', 'utf8');
  assert.match(s, /This area is for staff\. Your account does not have staff access\./);
  assert.match(s, /main\.innerHTML = '<p>' \+ esc\(e\.message\)/);
  const t = fs.readFileSync('public/js/staff-index.js', 'utf8');
  assert.match(t, /Say what was done about it first/);
  const m = fs.readFileSync('public/js/staff-members.js', 'utf8');
  assert.match(m, /confirm\('Suspend '/);
});
