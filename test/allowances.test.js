'use strict';
// ALLOWANCES AND TOP-UPS (owner's plans, 16 Sept 2026): checked before new work, counted after it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const money = require('../src/lib/money');
const A = require('../src/services/allowance');

test('top-ups are $10 and cost us less than they sell for', () => {
  assert.strictEqual(money.TOPUP_CENTS, 1000);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(money.TOPUPS).map(([k, t]) => [k, t.units])),
    { penny_message: 150, build: 25, compliance_question: 8 });
  const cost = { penny_message: 4.5, build: 18, compliance_question: 85 }; // cents, measured 16 Sept 2026
  for (const k of Object.keys(cost)) assert.ok(money.TOPUPS[k].units * cost[k] < 1000 - 59, k);
});

test('a used-up allowance is refused in words, with where to get more, and nothing running stops', () => {
  const says = A.refusal({ kind: 'penny_message', plan: 'desk', included: 400 });
  assert.match(says, /^You have used all 400 messages included with Desk this month, so I have not started this\./);
  assert.match(says, /Nothing you already have has stopped\./);
  assert.match(says, /A \$10 top-up adds 150 more messages with Penny\./);
  assert.match(says, /https:\/\/accessyplabs\.com\/plans\.html/);
  assert.match(A.refusal({ kind: 'compliance_review', plan: 'desk', included: 1 }), /Office includes reviews for up to three businesses/);
  const office = A.refusal({ kind: 'compliance_review', plan: 'office', included: 3 });
  assert.doesNotMatch(office, /A \$10 top-up/, 'full reviews have no top-up');
  assert.match(office, /you can still ask me single compliance questions/);
  assert.match(A.refusal({ kind: 'build', plan: 'free', included: 3 }), /included with the free plan/);
});

test('a warning comes only when little is left', () => {
  assert.strictEqual(A.lowNote({ kind: 'penny_message', included: 400, left: 200, topup: 0 }), null);
  assert.strictEqual(A.lowNote({ kind: 'penny_message', included: 400, left: 40, topup: 0 }), 'You have 40 messages left this month.');
  assert.strictEqual(A.lowNote({ kind: 'build', included: 20, left: 1, topup: 0 }), 'You have 1 build left this month.');
  assert.strictEqual(A.lowNote({ kind: 'build', included: 20, left: 0, topup: 0 }), null, 'the refusal says it instead');
  assert.strictEqual(A.lowNote({ unlimited: true }), null);
});

test('staff and retired plans are never limited, and an unreadable allowance never locks anyone out', () => {
  const src = fs.readFileSync('src/services/allowance.js', 'utf8');
  assert.match(src, /if \(billingExempt\(user\)\) return \{ plan: 'staff', unlimited: true \}/);
  assert.match(src, /if \(plan === 'builder' \|\| plan === 'sculptor'\) return \{ plan, unlimited: true \}/);
  assert.match(src, /return \{ ok: true, unread: true \}/);
  assert.match(src, /units > 0 RETURNING units/, 'a top-up never goes below zero');
});

test('work is checked before it starts and counted only once it happened', () => {
  const penny = fs.readFileSync('src/routes/penny.js', 'utf8');
  assert.ok(penny.indexOf("Allowance.check(req.user, 'penny_message')") < penny.indexOf('agent.runChat('));
  assert.match(penny, /if \(out\.status !== 'unavailable'\) \{\s*await Allowance\.record\(req\.user, 'penny_message'\)/);
  const builder = fs.readFileSync('src/services/clay/builder.js', 'utf8');
  assert.strictEqual((builder.match(/Allowance\.check\(viewer, 'build'\)/g) || []).length, 3, 'start, approve and fix');
  const gen = fs.readFileSync('src/services/clay/buildGen.js', 'utf8');
  assert.ok(gen.indexOf("record(who, 'build'") > gen.indexOf('await B.ready('), 'counted after it is ready');
  const cr = fs.readFileSync('src/services/clay/complianceResearch.js', 'utf8');
  assert.ok(cr.indexOf("require('../allowance').check(viewer, unit)") > cr.indexOf('Everything already fresh: answer now'),
    'reused findings are answered before the allowance is asked');
  assert.match(cr, /if \(out\.ok && run\.requested_by\)/);
});

test('a top-up is added once per payment', () => {
  const src = fs.readFileSync('src/services/allowance.js', 'utf8');
  assert.match(src, /ON CONFLICT \(stripe_session_id\) DO NOTHING RETURNING id/);
  assert.match(src, /if \(!ins\.rows\.length\) return \{ added: false/);
  assert.match(fs.readFileSync('src/routes/webhooks.js', 'utf8'), /md\.kind === 'topup'/);
  const sql = fs.readFileSync('docs/migrations/074_allowances.sql', 'utf8');
  assert.match(sql, /units\s+integer NOT NULL DEFAULT 0 CHECK \(units >= 0\)/);
});

test('the plans page shows this month and sells top-ups', () => {
  const page = fs.readFileSync('public/plans.html', 'utf8');
  assert.match(page, /fetch\('\/api\/subscriptions\/allowance'\)/);
  assert.match(page, /data-topup="/);
  assert.match(page, /only new work pauses/);
  assert.doesNotMatch(page, /Top-ups are coming/);
});
