'use strict';
// THE CUSTOMER PORTAL.
//
// Walked 16 Sept 2026, both sides. Owner: renamed a section, moved Messages up, added a date field,
// had an http link refused by name, opened the portal, added a customer (and was told plainly the
// email could not be sent), shared a file, added something the customer owes. Customer: an unknown
// email got the same neutral answer, a bad and a reused link were refused, sections appeared in the
// owner's order and names, a message and a request were sent, the shared file opened, an unshared
// one was 404. Owner saw one customer waiting; replying closed the reply on Today.
// The walk also found that no-referrer made the browser send Origin: null and every form was refused.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const C = require('../src/services/clay/portalConfig');

const base = C.defaults('Rivera Landscaping');

test('the defaults are a working portal', () => {
  assert.strictEqual(base.title, 'Rivera Landscaping customer portal');
  assert.deepStrictEqual(base.sections.map((s) => s.type), C.ORDER);
  assert.ok(base.request.fields.length >= 1);
});

test('anything outside the limits is refused by name, and the rest still applies', () => {
  const r = C.normalise({
    title: 'Client corner', accent: 'neon', favicon: 'x.png',
    sections: [{ type: 'messages', on: true }, { type: 'calendar', on: true }, { type: 'welcome', title: 'Hello' }],
    links: [{ label: 'Site', url: 'http://insecure.example' }, { label: 'Book', url: 'https://example.com/book' }],
    request: { fields: [{ label: 'Budget', kind: 'money' }, { label: 'When', kind: 'date', required: true }] },
  }, base);
  assert.strictEqual(r.config.title, 'Client corner');
  assert.strictEqual(r.config.accent, 'violet');
  assert.deepStrictEqual(r.config.sections.slice(0, 2).map((s) => s.type), ['messages', 'welcome']);
  assert.strictEqual(r.config.sections[1].title, 'Hello');
  assert.strictEqual(r.config.sections.length, 6, 'unmentioned sections keep their place after');
  assert.deepStrictEqual(r.config.links, [{ label: 'Book', url: 'https://example.com/book' }]);
  assert.deepStrictEqual(r.config.request.fields, [{ label: 'When', kind: 'date', required: true }]);
  const said = r.ignored.join(' | ');
  assert.match(said, /"favicon" is not something the portal has/);
  assert.match(said, /the colour "neon"/);
  assert.match(said, /a section called "calendar"/);
  assert.match(said, /only https addresses are allowed/);
  assert.match(said, /a "money" field for "Budget"/);
});

test('limits hold: at most 8 fields and 10 links, and an empty form keeps its fields', () => {
  const many = C.normalise({ request: { fields: Array.from({ length: 10 }, (_, i) => ({ label: 'F' + i, kind: 'text' })) } }, base);
  assert.strictEqual(many.config.request.fields.length, 8);
  const none = C.normalise({ request: { fields: [] } }, base);
  assert.deepStrictEqual(none.config.request.fields, base.request.fields);
  assert.match(none.ignored.join(' '), /needs at least one field/);
});

test('a request that needs a backend is named as a custom web application', () => {
  const b = C.beyond('let customers pay their invoices by card in the portal');
  assert.strictEqual(b.beyond, true);
  assert.match(b.says, /taking payments/);
  assert.match(b.says, /custom web application\. I can build that for you too/);
  assert.strictEqual(C.beyond('add a link to our booking page').beyond, false);
});

test('a customer only ever reads rows keyed on their own id', () => {
  const src = fs.readFileSync('src/services/clay/portal.js', 'utf8');
  const view = src.slice(src.indexOf('async function customerView'), src.indexOf('async function customerFile'));
  assert.strictEqual((view.match(/\$1/g) || []).length, 3);
  assert.strictEqual((view.match(/customer\.id/g) || []).length, 3);
  const file = src.slice(src.indexOf('async function customerFile'), src.indexOf('// A message or a request'));
  assert.match(file, /WHERE pf\.customer_id=\$1 AND f\.id=\$2/);
});

test('sign-in links are short, single use, hashed, and the answer never reveals a customer', () => {
  const sql = fs.readFileSync('docs/migrations/065_customer_portal.sql', 'utf8').replace(/\s+/g, ' ');
  assert.match(sql, /kind <> 'link' OR expires_at <= created_at \+ interval '31 minutes'/);
  assert.match(sql, /token_hash text PRIMARY KEY/);
  const src = fs.readFileSync('src/services/clay/portal.js', 'utf8');
  assert.match(src, /pt\.used_at IS NULL AND pt\.expires_at > now\(\)/);
  assert.match(src, /Always the same answer, whether or not the address belongs to a customer/);
});

test('portal pages: path-scoped Lax cookie, same-site posts, fixed status lines', () => {
  const r = fs.readFileSync('src/routes/portal.js', 'utf8');
  assert.match(r, /Path=\/p\/' \+ slug \+ '; HttpOnly; SameSite=Lax/);
  assert.match(r, /'Referrer-Policy': 'same-origin'/);
  assert.doesNotMatch(r, /req\.query\.note/);
  assert.match(r, /NOTES\[String\(req\.query\.n \|\| ''\)\]/);
});

test('money stays with Arbo: the portal shows what and when, never how much', () => {
  const src = fs.readFileSync('src/services/clay/portal.js', 'utf8');
  assert.doesNotMatch(src.slice(src.indexOf('async function addItem'), src.indexOf('async function thread')), /cost_if_missed_cents|amount/);
});

test('reachable: Today links the portal, hosted sites link it when open, Penny can set it up', () => {
  assert.match(fs.readFileSync('public/today.html', 'utf8'), /href="\/portal\.html"/);
  const L = require('../src/routes/labsSites');
  assert.match(L.addOns('s', 'Biz', 'https://x/send', 'https://x/p/biz').footer, /Customer sign in/);
  assert.doesNotMatch(L.addOns('s', 'Biz', 'https://x/send', null).footer, /Customer sign in/);
  const W = require('../src/services/clay/workspace');
  assert.ok(W.EXECUTORS.portal_status && W.EXECUTORS.customize_portal);
});

test('Penny reports what she could not do, and an unreadable change saves nothing', async () => {
  const W = require('../src/services/clay/workspace');
  const r = await W.EXECUTORS.customize_portal({ id: 'u' }, { business_id: 'b', config_json: '{not json' });
  assert.strictEqual(r.status, 'needs_answer');
  assert.match(r.says, /nothing was saved/);
});
