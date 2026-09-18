'use strict';
// CHANGING YOUR OWN PLAN (18 September 2026).
//
// Cancelling existed; nothing could undo it, and Penny could neither see a plan nor change one, so
// the answer to "cancel my plan" was to email us and wait. On a $19 plan most people simply leave.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const W = require('../src/services/clay/workspace');
const S = require('../src/services/clay/standing');
const stripe = fs.readFileSync('src/services/stripe.js', 'utf8');
const route = fs.readFileSync('src/routes/subscriptions.js', 'utf8');
const ws = fs.readFileSync('src/services/clay/workspace.js', 'utf8')
  .replace(/\/\//g, ' ').replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');

test('a plan due to end can be turned back on', () => {
  assert.match(stripe, /async function resumeSubscription\(subscriptionId\)/);
  assert.match(stripe, /cancel_at_period_end: false/);
  assert.match(route, /router\.post\('\/:id\/resume'/);
  // A plan that has actually ended is a fresh checkout, not a resume, and says so.
  assert.match(stripe, /already_ended/);
  assert.match(ws, /has already ended rather than being due to end/);
});

test('reading a plan is safe; changing one needs a yes', () => {
  assert.strictEqual(W.TOOLS.my_plan.requires_confirmation, false);
  assert.strictEqual(W.TOOLS.change_plan.requires_confirmation, true);
  assert.deepStrictEqual(W.TOOLS.change_plan.enums.action, ['cancel', 'resume']);
  assert.ok(S.UNATTENDED_TOOLS().includes('my_plan'), 'she can check a plan on a schedule');
  assert.ok(!S.UNATTENDED_TOOLS().includes('change_plan'), 'she must never cancel a plan unattended');
});

test('cancelling says what it does and does not do', () => {
  assert.match(ws, /You keep everything until the end of the period you have already paid for/);
  assert.match(ws, /nothing is refunded/);
  assert.match(ws, /I can turn the renewal back on any time before then/);
  // And a refusal by Stripe leaves the plan alone rather than being reported as done.
  assert.match(ws, /Stripe would not take that, so your plan is unchanged/);
});

test('she reads the plan rather than guessing at billing', () => {
  assert.match(W.TOOLS.my_plan.summary, /Use it before answering anything about billing rather than guessing/);
  assert.match(ws, /You are on the free plan/);
});
