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
