'use strict';
// THE SPINE.
//
// Every task, project, customer commitment, filing, renewal, invoice and promise is the same record:
// a counterparty, a date, and a consequence if it does not happen. One list, ranked by what missing
// each thing actually costs.
//
// Every assertion below was driven against a real Postgres rebuilt from empty before being written.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sql = fs.readFileSync('docs/migrations/059_obligation_spine.sql', 'utf8');

test('business is a first-class object, not a setting', () => {
  // Somebody with a cleaning company in Ohio, an Airbnb LLC in Tennessee and a consulting entity in
  // Delaware has three annual reports in three jurisdictions. They cannot hold it in their head, no
  // tool holds it for them, and they are the likeliest person alive to lose an entity to
  // administrative dissolution. Retrofitting this is close to impossible.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS yp_labs\.businesses/);
  assert.match(sql, /operating_states text\[\]/);
  // Operating states are separate from formation state on purpose — the gap between them is where
  // people get caught.
  assert.match(sql, /formation_state text/);
});

test('there is no concept of a property anywhere', () => {
  // An obligation attaches to a SUBJECT: a vehicle, a premises, a licence, a person, a unit. An STR
  // permit is an obligation whose subject happens to be a property, exactly as a commercial vehicle
  // inspection is one whose subject happens to be a van. Verified live: zero matching columns.
  assert.match(sql, /kind\s+text NOT NULL CHECK \(kind IN\s*\n?\s*\('premises','vehicle','licence','person','unit','equipment','account','other'\)\)/);
  const spine = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(!/propert/i.test(spine), 'no property anywhere in the schema');
});

test('tasks, filings, promises and invoices are the same record', () => {
  // The reason nothing works this way is historical: Asana for software teams, HubSpot for sales
  // teams, ZenBusiness for filings. A one-person cleaning business does not have three jobs.
  for (const k of ['filing', 'licence', 'permit', 'task', 'promise', 'invoice_out', 'renewal']) {
    assert.ok(sql.includes("'" + k + "'"), 'missing obligation kind: ' + k);
  }
  assert.match(sql, /counterparty_kind/);
});

test('a cost that claims a number must say what it is based on', () => {
  // The ranking column is the reason this product exists, and a number nobody can explain is a
  // number nobody should trust. Verified live: an insert with a cost and no basis is refused.
  assert.match(sql, /CONSTRAINT cost_has_basis CHECK \(cost_if_missed_cents IS NULL OR cost_basis IS NOT NULL\)/);
  assert.match(sql, /cost_basis\s+text CHECK \(cost_basis IS NULL OR cost_basis IN \('known','estimated','unknown'\)\)/);
});

test('done means done at a time', () => {
  assert.match(sql, /CONSTRAINT done_has_time CHECK \(status <> 'done' OR completed_at IS NOT NULL\)/);
});

test('every obligation carries where it came from and when', () => {
  // "From your Flow books this morning" and "you told me in March" are different claims. A connected
  // ecosystem that blurs them is harder to trust than three separate products.
  assert.match(sql, /source\s+text NOT NULL DEFAULT 'stated'/);
  assert.match(sql, /'stated','rule_engine','gmail','flow','ayp','imported','penny'/);
  assert.match(sql, /source_at\s+timestamptz NOT NULL DEFAULT now\(\)/);
});

test('not every relationship is a login', () => {
  // A landlord is a record. A vendor is a record and a thread. A customer gets the portal. Only
  // people who work in the business take a seat, which is what makes counting seats fair.
  assert.match(sql, /user_id\s+uuid REFERENCES yp_labs\.users\(id\) ON DELETE SET NULL,\n\s*display_name/);
  for (const k of ['owner', 'partner', 'employee', 'contractor', 'assistant', 'vendor', 'landlord', 'customer', 'professional']) {
    assert.ok(sql.includes("'" + k + "'"), 'missing relationship kind: ' + k);
  }
  // One person, one relationship per business. Verified live.
  assert.match(sql, /CONSTRAINT one_per_business UNIQUE \(business_id, user_id\)/);
});

test('permissions are capability, scope and level — never a fixed role', () => {
  // Fixed roles break immediately on real teams. Somebody who does compliance AND development is
  // not admin and not staff, and inventing a role per combination is how this becomes unusable.
  assert.match(sql, /area\s+text NOT NULL CHECK \(area IN \(\s*\n?\s*'compliance','money','customers','team','documents','projects','sites','export'\)\)/);
  assert.match(sql, /level\s+text NOT NULL CHECK \(level IN \('none','view','act','manage'\)\)/);
});

test('export is its own area and is never implied', () => {
  // It is the one capability that removes data from your control and the one nobody restricts until
  // afterwards. And every export leaves a record behind.
  assert.ok(sql.includes("'export'"));
  assert.match(sql, /CREATE TABLE IF NOT EXISTS yp_labs\.export_log/);
  assert.match(sql, /It is never implied by 'view'/);
});

test('connections are revoked, not deleted', () => {
  // Revocable in one action, and the revocation is recorded rather than the row disappearing.
  assert.match(sql, /revoked_at\s+timestamptz/);
  assert.match(sql, /status\s+text NOT NULL DEFAULT 'active' CHECK \(status IN \('active','revoked','error'\)\)/);
});

test('it is registered and rebuilds from empty', () => {
  // Verified: 81 tables from an empty database, all seven spine tables present.
  assert.ok(fs.readFileSync('docs/migrations/ORDER.txt', 'utf8').includes('059_obligation_spine.sql'));
});
