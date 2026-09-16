'use strict';
// WHERE A BUILD LIVES: Penny suggests the smallest home that works, and says why.
//
// Walked 16 Sept 2026: a lawn-care landing page with a quote form was recommended as a Labs site,
// built without a mock-up, put online at /s/<address>, received a visitor's message (the visitor was
// thanked, the owner saw it waiting and it was on Today), was edited with the live heading changing
// at once, and went offline with a 404 on the next open. Choosing the portal started nothing.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const S = require('../src/services/clay/scope');
const B = require('../src/services/clay/builder');

test('small asks get the small home', () => {
  assert.strictEqual(S.classify('a wedding site with our date, venue and an RSVP form').recommended, 'labs_site');
  assert.strictEqual(S.classify("a landing page for my food truck with this week's menu").recommended, 'labs_site');
  assert.strictEqual(S.classify('a page where people ask for a quote').recommended, 'labs_site');
});

test('a backend need is named, and the smaller option is still offered', () => {
  const c = S.classify('an online store where customers pay by card and I track inventory');
  assert.strictEqual(c.recommended, 'custom_app');
  assert.match(c.says, /You mentioned taking payments and keeping and managing your own records/);
  assert.match(c.says, /If a smaller start would do/);
});

test('customers signing in points to the portal, which is set up on its own page', () => {
  const c = S.classify('a client portal where customers log in to see their invoices');
  assert.strictEqual(c.recommended, 'labs_portal');
  assert.match(c.says, /I set the portal up from its own page/);
  assert.strictEqual(S.AVAILABLE.labs_portal.ready, false);
  assert.match(S.AVAILABLE.labs_portal.says, /Open Customer portal from Today/);
});

test('a custom app says plainly it is not live until launched on their accounts', () => {
  assert.match(S.AVAILABLE.custom_app.partial, /stays a preview until then/);
  assert.match(fs.readFileSync('src/services/clay/penny.js', 'utf8'), /until it is hosted there it is not live/);
});

test('nothing starts without a home, and a portal is sent to its own page', async () => {
  const P = require('../src/lib/permissions');
  const can = P.can;
  P.can = async () => ({ ok: true, perms: { business: { name: 'T' } } });
  try {
    const r = await B.start({ id: 'u' }, { business_id: 'b', asked_for: 'a landing page for my salon', mock_first: 'no' });
    assert.strictEqual(r.needs, 'tier_choice');
    assert.strictEqual(r.recommended, 'labs_site');
    assert.match(r.says, /Where should this live/);
    const p = await B.start({ id: 'u' }, { business_id: 'b', asked_for: 'a portal for my clients', tier: 'labs_portal', mock_first: 'no' });
    assert.strictEqual(p.ok, false);
    assert.match(p.says, /set up on its own page/);
  } finally { P.can = can; }
});

test('the database only lets a finished Labs site go online', () => {
  const sql = fs.readFileSync('docs/migrations/064_where_a_build_lives.sql', 'utf8').replace(/\s+/g, ' ');
  assert.match(sql, /published_slug IS NULL OR \(stage = 'real' AND tier = 'labs_site' AND published_at IS NOT NULL\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS builds_published_slug_idx/);
  assert.match(sql, /'penny','site'\)/);
});

test('a live site gets a way to send, a footer and a report link, and is never cached', () => {
  const L = require('../src/routes/labsSites');
  const a = L.addOns('rivera', 'Rivera <Landscaping>', 'https://x.test/s/rivera/send');
  assert.match(a.script, /window\.labsSend=/);
  assert.match(a.footer, /Rivera &lt;Landscaping&gt;, made with Access YP Labs/);
  assert.match(a.footer, /Report this page/);
  const src = fs.readFileSync('src/routes/labsSites.js', 'utf8');
  assert.match(src, /'Cache-Control': 'no-cache, no-store'/);
  assert.match(src, /'connect-src ' \+ here/);
  assert.match(src, /FLOOD_PER_HOUR = 5/);
});

test('an edit moves the address before it is announced, in a transaction', () => {
  const src = fs.readFileSync('src/services/clay/buildGen.js', 'utf8');
  assert.ok(src.indexOf('await moveAddress(from, build.id)') < src.indexOf('await B.ready(build.id'));
  assert.match(src, /FOR UPDATE/);
  assert.doesNotMatch(src, /SELECT published_slug FROM old/);
});

test('generated forms send only through labsSend', () => {
  const src = fs.readFileSync('src/services/clay/buildGen.js', 'utf8');
  assert.match(src, /If window\.labsSend exists/);
  assert.match(src, /Never send form data anywhere else/);
});

test('the Build screen asks where it lives, with nothing picked', () => {
  const html = fs.readFileSync('public/builds.html', 'utf8');
  assert.match(html, /<legend>Where should this live\?<\/legend>/);
  assert.strictEqual((html.match(/name="tier"[^>]*checked/g) || []).length, 0);
  assert.strictEqual((html.match(/>Put it online<\/button>/g) || []).length, 1, 'no two buttons share a name');
});

test('hosted pages opt out of Cloudflare email rewriting, inside body', () => {
  const src = fs.readFileSync('src/routes/labsSites.js', 'utf8');
  assert.match(src, /'<body\$1><!--email_off-->'/);
  assert.match(src, /'<!--\/email_off--><\/body>'/);
});
