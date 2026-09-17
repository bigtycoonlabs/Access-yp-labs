'use strict';
// PENNY HANDS MONEY WORK TO ARBO (17 Sept 2026). Labs knows what a customer owes; YP Flow keeps the
// money. Penny used to be able only to say so, which left somebody retyping what she was holding.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const W = require('../src/services/clay/workspace');

test('the three tools exist, and only the handover needs a human yes', () => {
  assert.strictEqual(W.TOOLS.connect_flow.requires_confirmation, false);
  assert.strictEqual(W.TOOLS.flow_status.requires_confirmation, false);
  assert.strictEqual(W.TOOLS.send_invoice_to_flow.requires_confirmation, true);
  for (const t of ['connect_flow', 'flow_status', 'send_invoice_to_flow']) {
    assert.ok(W.TOOLS[t].summary.length < 1024, t);
    assert.strictEqual(typeof W.EXECUTORS[t], 'function', t);
  }
  assert.deepStrictEqual(W.TOOLS.send_invoice_to_flow.required, ['email', 'counterparty', 'label', 'amount_usd']);
  const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
  assert.match(agent, /amount_usd: 'number'/, 'an amount is a number, not text the other side guesses at');
});

test('she is told to hand it over rather than send people elsewhere, and never to call the books updated', () => {
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8');
  assert.match(penny, /you do not tell somebody to go and retype something you are\nholding/);
  assert.match(penny, /Never tell them their books already show it/);
  assert.match(penny, /'send_invoice_to_flow',/);
});

test('nothing is sent without an amount, a name and a reason', async () => {
  const F = require('../src/services/clay/flowLink');
  for (const [params, expect] of [
    [{ email: 'a@b.com', label: 'Groom', amount_usd: 10 }, /Who owes it/],
    [{ email: 'a@b.com', counterparty: 'Chris', amount_usd: 10 }, /What is it for/],
    [{ email: 'a@b.com', counterparty: 'Chris', label: 'Groom', amount_usd: 0 }, /greater than zero/],
    [{ email: 'a@b.com', counterparty: 'Chris', label: 'Groom', amount_usd: 'about a hundred' }, /will not send a number I had to guess/],
  ]) {
    const r = await F.sendInvoice(params);
    assert.strictEqual(r.ok, false);
    assert.match(r.says, expect);
  }
});

test('an unreachable or unconfigured Flow says nothing happened, and never that it did', () => {
  const src = fs.readFileSync('src/services/clay/flowLink.js', 'utf8');
  assert.match(src, /The connection to YP Flow is not set up on this server/);
  assert.match(src, /I could not reach YP Flow, so nothing happened there/);
  assert.match(src, /did not accept this platform\\u2019s credentials/);
  assert.match(src, /x-labs-secret/);
});

test('a handed-over invoice is reported as awaiting their confirmation, not as done', () => {
  const src = fs.readFileSync('src/services/clay/workspace.js', 'utf8');
  assert.match(src, /awaiting_their_confirmation: true/);
  assert.match(src, /Reported exactly as Flow reported it/);
});
