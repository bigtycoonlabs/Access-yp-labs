'use strict';
// THE PLANS, locked by the owner on 16 September 2026: Free, Desk $55, Office $99.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const money = require('../src/lib/money');

test('the prices are the decided ones, and only Desk and Office can be sold', () => {
  assert.strictEqual(money.planCents('desk'), 5500);
  assert.strictEqual(money.planCents('office'), 9900);
  assert.strictEqual(money.yearlyCents('desk'), 55000);
  assert.strictEqual(money.yearlyCents('office'), 99000);
  for (const old of ['builder', 'maker', 'sculptor']) assert.strictEqual(money.planCents(old), null);
  assert.deepStrictEqual(Object.keys(money.PLANS).sort(), ['desk', 'office']);
});

test('the allowances are the decided ones', () => {
  assert.deepStrictEqual(money.FREE_ALLOWANCE, { penny_messages: 100, builds: 3, images: 5, compliance_reviews: 0, compliance_questions: 1, labs_sites: 1 });
  assert.strictEqual(money.PLANS.desk.allowance.penny_messages, 400);
  assert.strictEqual(money.PLANS.desk.allowance.compliance_reviews, 1);
  assert.strictEqual(money.PLANS.office.allowance.penny_messages, 1000);
  assert.strictEqual(money.PLANS.office.allowance.compliance_reviews, 3);
  assert.strictEqual(money.PLANS.office.allowance.team_seats, 5);
});

test('every paid check uses the one list, so a new plan is never forgotten in one of them', () => {
  assert.deepStrictEqual(money.PAID_PLANS, ['desk', 'office', 'builder', 'sculptor']);
  for (const f of ['src/lib/entitlement.js', 'src/services/clay/siteAccess.js', 'src/services/clay/imageBudget.js', 'src/lib/deleteProject.js']) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /IN \('builder'/, f);
  }
});

test('checkout sells only Desk or Office, refuses a second plan, and records yearly', () => {
  const subs = fs.readFileSync('src/routes/subscriptions.js', 'utf8');
  assert.match(subs, /isIn\(\['desk', 'office'\]\)/);
  assert.match(subs, /Changing plans is not self-serve yet, so nothing was charged/);
  assert.match(fs.readFileSync('src/services/stripe.js', 'utf8'), /interval: billing === 'yearly' \? 'year' : 'month'/);
  assert.match(fs.readFileSync('src/routes/webhooks.js', 'utf8'), /INSERT INTO subscriptions \(user_id, plan, concept_id, status, price_cents, stripe_subscription_id, billing, bundle, flow_tier\)/);
  const sql = fs.readFileSync('docs/migrations/072_desk_office_plans.sql', 'utf8');
  assert.match(sql, /plan IN \('desk', 'office', 'builder', 'maker', 'sculptor', 'site_addon'\)/);
});

test('no screen or assistant still quotes a price that is not on sale', () => {
  const places = ['public/index.html', 'public/js/app.js', 'public/js/concept.js', 'public/js/dashboard.js',
    'src/services/clay/agent.js', 'src/services/clay/siteAccess.js'];
  for (const f of places) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /\$19(?!\.99)(?![\d])(?! plan is no longer)/, f + ' still quotes $19');
    assert.doesNotMatch(s, /\$49\b|\$129\b/, f + ' quotes a price that was never decided');
  }
  assert.match(fs.readFileSync('public/index.html', 'utf8'), /\$55 a month[\s\S]*\$99 a month/);
});

test('the plans page reads its numbers from the server and says allowances plainly', () => {
  const page = fs.readFileSync('public/plans.html', 'utf8');
  assert.match(page, /fetch\('\/api\/subscriptions\/plans'\)/);
  assert.doesNotMatch(page, /\$55|\$99/, 'no hard-coded prices in the page itself');
  assert.match(page, /role="status" aria-live="polite"/);
  assert.match(fs.readFileSync('public/today.html', 'utf8'), /href="\/plans\.html"/);
});

test('the plans page signs its requests, so a signed-in person is recognised', () => {
  // Walked 16 Sept 2026: without desk-auth.js the page thought everyone was signed out, and choosing a
  // plan sent a signed-in person to the login page.
  const page = fs.readFileSync('public/plans.html', 'utf8');
  assert.ok(page.indexOf('/js/desk-auth.js') > 0 && page.indexOf('/js/desk-auth.js') < page.indexOf("fetch('/api/subscriptions/plans')"));
});
