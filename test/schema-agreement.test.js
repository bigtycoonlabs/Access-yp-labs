'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const glob = require('path');

// CODE AND DATABASE MUST AGREE ABOUT WHAT A COLUMN CAN HOLD.
//
// This guard exists because of a real and expensive bug: the subscriptions table carried a CHECK
// constraint permitting only 'maker' and 'sculptor' — both retired — while 'builder' was the only
// plan being sold. Nothing failed in testing, nothing failed at boot, and every test passed. The
// first REAL subscriber would have been charged by Stripe and then the webhook insert would have
// thrown, leaving someone paying monthly with no record of it on our side.
//
// It was invisible because the two halves live in different places: the value is a string literal in
// JavaScript, and the rule is a constraint in Postgres. Nothing compared them. This does.
//
// The permitted sets below are copied from the live constraints. If a migration changes a
// constraint, this file must change with it — which is the point: it forces the two to be edited
// together rather than drifting apart quietly.

const ALLOWED = {
  'subscriptions.plan': ['builder', 'maker', 'sculptor', 'site_addon'],
  'subscriptions.status': ['active', 'canceled', 'past_due'],
  'concepts.movement_state': ['needs_customer_clarity', 'needs_proof', 'ready_to_package'],
  'concepts.origin': ['created', 'purchased', 'clay_seed'],
  'desk_articles.status': ['draft', 'published', 'archived'],
  'desk_articles.kind': ['help', 'story'],
  'weekly_issues.status': ['draft', 'approved', 'published', 'archived'],
  'weekly_sponsorships.status': ['offered', 'accepted', 'declined', 'expired'],
  'partner_interest.status': ['pending', 'accepted', 'declined'],
  'partner_requests.status': ['open', 'closed'],
  'reports.status': ['open', 'reviewed', 'dismissed'],
  'mover_earnings.status': ['pending', 'paid'],
  'assets.scan_status': ['not_required', 'pending', 'clean', 'flagged'],
  'listing_events.kind': ['bid', 'value_added', 'price_changed', 'sold', 'auction_ended', 'relisted'],
};

function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = glob.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

test('every value the code writes is a value the database will accept', () => {
  const files = sourceFiles('src');
  const offences = [];

  // Only look inside SQL, and only at the table that statement actually touches — checking every
  // "status = 'x'" against every table's rules produces hundreds of meaningless hits.
  const sqlRe = /`([^`]*(?:INSERT INTO|UPDATE|DELETE FROM|SELECT)[^`]*)`/gis;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = sqlRe.exec(src)) !== null) {
      const stmt = m[1];
      const t = /(?:INSERT INTO|UPDATE|DELETE FROM|FROM|JOIN)\s+([a-z_]+)/i.exec(stmt);
      if (!t) continue;
      const table = t[1].toLowerCase();
      const line = src.slice(0, m.index).split('\n').length;

      for (const [key, values] of Object.entries(ALLOWED)) {
        const [tbl, col] = key.split('.');
        if (tbl !== table) continue;

        const eq = new RegExp(`${col}\\s*(?:=|<>|!=)\\s*'([a-z_]+)'`, 'g');
        let lit;
        while ((lit = eq.exec(stmt)) !== null) {
          if (!values.includes(lit[1])) offences.push(`${file}:${line} ${key} = '${lit[1]}'`);
        }
        const inList = new RegExp(`${col}\\s+IN\\s*\\(([^)]*)\\)`, 'gi');
        let grp;
        while ((grp = inList.exec(stmt)) !== null) {
          for (const v of grp[1].match(/'([a-z_]+)'/g) || []) {
            const bare = v.replace(/'/g, '');
            if (!values.includes(bare)) offences.push(`${file}:${line} ${key} IN '${bare}'`);
          }
        }
      }
    }
  }

  assert.deepStrictEqual(offences, [],
    'these write values the database constraint would reject:\n  ' + offences.join('\n  '));
});

test('the plan we actually sell is one the database accepts', () => {
  // The specific failure that motivated all of this.
  const money = require('../src/lib/money');
  const sellable = ['builder'];
  sellable.forEach((p) => {
    assert.ok(ALLOWED['subscriptions.plan'].includes(p), `${p} must be storable`);
    assert.ok(money.planCents(p) > 0, `${p} must have a price`);
  });
  // And retired plans stay storable (existing subscribers) but unsellable.
  ['maker', 'sculptor'].forEach((p) => {
    assert.ok(ALLOWED['subscriptions.plan'].includes(p), `${p} must remain storable for existing subscribers`);
    assert.strictEqual(money.planCents(p), null, `${p} must not be sellable`);
  });
});

// NUMERIC FLOORS DRIFT THE SAME WAY VALUE LISTS DO.
//
// Everything above compares enum-style value lists and never looked at a CHECK carrying a number.
// So this guard was in place and clean while `bids.amount_cents` enforced >= 5000 in the database
// and the bid route validated against the $10 listing floor. A $20 bid passed every application
// check and Postgres threw: HTTP 500, `violates check constraint "bids_amount_cents_check"`, shown
// to the bidder. On the live auction, whose starting bid is $35, the page said "Bid must exceed
// $35.00" and then 500'd on $36 — software instructing somebody into an error.
//
// Same failure as the retired-plans constraint, in a shape the guard did not look at. Copied from
// the live constraints; if a migration changes one, this must change with it.
const NUMERIC_FLOORS = {
  'bids.amount_cents': 5000,
  'listings.price_cents': 1000,   // nullable — an auction has a starting bid instead
  'mover_earnings.amount_cents': 0,
  'store_products.price_cents': 0,
  'store_orders.amount_cents': 0,
  'concept_image_credits.balance': 0,
};

test('the numeric floors in the code are the ones the database enforces', () => {
  const money = require('../src/lib/money');
  // The bid floor is NOT the listing floor. Conflating them is exactly what happened.
  assert.strictEqual(money.MIN_BID_CENTS, NUMERIC_FLOORS['bids.amount_cents'],
    'the minimum bid in code must equal the bids CHECK constraint');
  assert.strictEqual(money.PRICE_FLOOR_CENTS, NUMERIC_FLOORS['listings.price_cents'],
    'the listing floor in code must equal the listings CHECK constraint');
  assert.notStrictEqual(money.MIN_BID_CENTS, money.PRICE_FLOOR_CENTS,
    'these are different numbers on purpose — if they converge, move the constraint too');
});

test('every migration that declares a numeric floor declares the one we recorded', () => {
  // Read the floors out of the SQL rather than trusting the map alone, so a migration cannot lower
  // a constraint quietly while this file still asserts the old number.
  const fsx = require('fs');
  const sql = fsx.readdirSync('docs/migrations').filter((f) => f.endsWith('.sql'))
    .map((f) => fsx.readFileSync('docs/migrations/' + f, 'utf8')).join('\n');
  const declared = /amount_cents\s+integer\s+NOT NULL\s+CHECK\s*\(amount_cents\s*>=\s*(\d+)\)/g;
  const found = [...sql.matchAll(declared)].map((m) => Number(m[1]));
  assert.ok(found.includes(5000), 'the bids floor must still be declared in a migration');
  assert.ok(found.includes(0), 'the earnings floor must still be declared in a migration');
});

test('the bid route validates against the bid floor, not the listing floor', () => {
  const fsx = require('fs');
  const route = fsx.readFileSync('src/routes/bids.js', 'utf8');
  assert.match(route, /MIN_BID_CENTS/);
  assert.ok(!/PRICE_FLOOR_CENTS/.test(route),
    'the listing floor must not be what a bid is checked against');
  const { isValidBid } = require('../src/lib/money');
  assert.strictEqual(isValidBid(2000), false, '$20 must be refused, not sent to Postgres to reject');
  assert.strictEqual(isValidBid(4999), false);
  assert.strictEqual(isValidBid(5000), true);
  assert.strictEqual(isValidBid(null), false);
  assert.strictEqual(isValidBid(5000.5), false);
});

test('the page never invites a bid the database will refuse', () => {
  const fsx = require('fs');
  const page = fsx.readFileSync('public/listing.html', 'utf8');
  assert.match(page, /const MIN_BID=50;/);
  // The pre-filled figure and the input's own minimum both have to respect it. Pre-filling one
  // dollar above a $35 starting bid is how the error was reached in the first place.
  assert.match(page, /Math\.max\(MIN_BID,/);
  assert.match(page, /bi\.min=String\(MIN_BID\)/);
  assert.ok(!/Bid must be at least \$10/.test(page));
});
