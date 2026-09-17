'use strict';
// BUNDLES WITH YP FLOW (owner, 16 Sept 2026). One subscription on the shared Stripe account; both
// platforms' webhooks receive it; each records its half and sends its own welcome.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const money = require('../src/lib/money');
const W = require('../src/services/planWelcome');

test('the bundle prices are the approved ones, and each is 17% below the two apart', () => {
  assert.deepStrictEqual(Object.fromEntries(Object.entries(money.BUNDLES).map(([k, b]) => [k, [b.labs, b.flow, b.cents]])), {
    desk_flow: ['desk', 'flow', 5800], desk_power: ['desk', 'power', 7800], office_master: ['office', 'master', 13900] });
  for (const k of Object.keys(money.BUNDLES)) {
    const pct = Math.round(100 - (money.BUNDLES[k].cents * 100) / money.bundleSeparateCents(k));
    assert.strictEqual(pct, 17, k);
  }
  assert.strictEqual(money.bundleYearlyCents('office_master'), 139000);
  assert.strictEqual(money.recordedPlanCents('desk', 'monthly', 'desk_power'), 7800);
});

test('a bundle checkout tells Flow what to grant and to whom, without looking like a Flow checkout', () => {
  const s = fs.readFileSync('src/services/stripe.js', 'utf8');
  assert.match(s, /bundle, flow_tier: flowTier, flow_email: String\(email \|\| ''\)\.toLowerCase\(\), sold_by: 'labs'/);
  assert.match(s, /subscription_data: mode === 'subscription' \? \{ metadata \} : undefined/);
  assert.doesNotMatch(s, /type: 'subscription'/, 'Flow treats metadata.type = subscription as its own checkout');
});

test('the webhook records the bundle and welcomes once, without letting mail fail the payment', () => {
  const s = fs.readFileSync('src/routes/webhooks.js', 'utf8');
  assert.match(s, /BUNDLES\[md\.bundle\]\.labs === md\.plan/);
  assert.match(s, /stripe_subscription_id, billing, bundle, flow_tier\)/);
  assert.match(s, /planWelcome'\)\.sendOnce\(stripeSubId\)/);
  const w = fs.readFileSync('src/services/planWelcome.js', 'utf8');
  assert.match(w, /SET plan_welcomed_at = now\(\)[\s\S]*plan_welcomed_at IS NULL/);
  assert.match(w, /if \(!r \|\| !r\.sent\) throw/, 'a refused send is not a sent one');
  assert.match(w, /SET plan_welcomed_at = NULL/, 'a failed send can be retried');
  const sql = fs.readFileSync('docs/migrations/073_bundles.sql', 'utf8');
  assert.match(sql, /bundle = 'office_master' AND plan = 'office' AND flow_tier = 'master'/);
});

test('the welcome names the plan, and for a bundle says Flow sends its own', () => {
  const a = W.compose({ name: 'Dana Brooks', plan: 'office', bundle: null, billing: 'yearly' });
  assert.strictEqual(a.subject, 'Your Office plan is active');
  assert.match(a.text, /^Hi Dana, it’s Penny\./);
  assert.match(a.text, /paid yearly\. It includes everything in Desk/);
  assert.doesNotMatch(a.text, /YP Flow/);
  const b = W.compose({ name: '', plan: 'desk', bundle: 'desk_power', billing: 'monthly' });
  assert.strictEqual(b.subject, 'Your Desk + Power bundle is active');
  assert.match(b.text, /^Hi there/);
  assert.match(b.text, /the Power plan on Access YP Flow/);
  assert.match(b.text, /YP Flow sends its own welcome email/);
  assert.match(b.html, /<h1[^>]*>Your Desk \+ Power bundle is active<\/h1>/);
});

test('the plans page offers the bundles from the server', () => {
  const page = fs.readFileSync('public/plans.html', 'utf8');
  assert.match(page, /catalog\.bundles\.forEach/);
  assert.match(page, /data-bundle="/);
  assert.match(page, /Flow creates it and emails you how to sign in/);
  const subs = fs.readFileSync('src/routes/subscriptions.js', 'utf8');
  assert.match(subs, /Adding YP Flow as a bundle is not self-serve yet, so nothing was charged/);
});
