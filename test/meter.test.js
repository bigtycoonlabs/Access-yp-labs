'use strict';
// METERING. Every model call and image is recorded with its cost; an unknown price is never zero.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const Prices = require('../src/lib/modelPrices');
const M = require('../src/services/meter');

test('costs are exact and follow the published rates', () => {
  // 10,000 input of which 6,000 cached, 2,000 output on gpt-5.5:
  // 4,000 x $5 + 6,000 x $0.50 + 2,000 x $30, per million = $0.083
  assert.strictEqual(Prices.textCostMicros('gpt-5.5', { input: 10000, cached: 6000, output: 2000 }), 83000);
  assert.strictEqual(Prices.textCostMicros('gpt-5.5-2026-04-23', { input: 200000, output: 0 }), 1000000);
  assert.strictEqual(Prices.imageCostMicros('dall-e-3', 2), 80000);
});

test('long prompts on gpt-5.5 are billed at the higher rate for the whole request', () => {
  const c = Prices.textCostMicros('gpt-5.5', { input: 300000, output: 1000 });
  assert.strictEqual(c, Math.round((300000 * 10 + 1000 * 45) / 1e6 * 1e6));
});

test('a model with no known price costs unknown, not nothing', () => {
  assert.strictEqual(Prices.textCostMicros('some-new-model', { input: 5, output: 5 }), null);
  assert.strictEqual(Prices.imageCostMicros('gpt-image-9', 1), null);
  const sql = fs.readFileSync('docs/migrations/069_model_usage.sql', 'utf8');
  assert.match(sql, /cost_micros\s+bigint CHECK \(cost_micros IS NULL OR cost_micros >= 0\)/);
});

test('each API\'s usage shape is read correctly', () => {
  assert.deepStrictEqual(M.readUsage({ prompt_tokens: 100, completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } }, 'chat'),
    { input: 100, cached: 40, output: 20, reasoning: 5 });
  assert.deepStrictEqual(M.readUsage({ input_tokens: 100, output_tokens: 20,
    input_tokens_details: { cached_tokens: 30 }, output_tokens_details: { reasoning_tokens: 7 } }, 'responses'),
    { input: 100, cached: 30, output: 20, reasoning: 7 });
  assert.deepStrictEqual(M.readUsage({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 }, 'anthropic'),
    { input: 150, cached: 50, output: 20, reasoning: 0 });
  assert.strictEqual(M.readUsage(null, 'chat'), null);
});

test('the context follows the work, and background work carries its own', async () => {
  assert.strictEqual(M.purposeFor('/api/penny/chat'), 'penny');
  assert.strictEqual(M.purposeFor('/builds.html'), 'web');
  await new Promise((done) => M.middleware({ path: '/api/penny/chat' }, {}, async () => {
    M.setUser('u1');
    await Promise.resolve();
    assert.deepStrictEqual(M.context(), { user_id: 'u1', business_id: null, purpose: 'penny' });
    await M.within({ purpose: 'build', business_id: 'b1' }, async () => {
      assert.deepStrictEqual(M.context(), { user_id: 'u1', business_id: 'b1', purpose: 'build' });
    });
    assert.strictEqual(M.context().purpose, 'penny');
    done();
  }));
  assert.strictEqual(M.context(), null);
});

test('every model call in the provider is metered', () => {
  const full = fs.readFileSync('src/services/clay/provider.js', 'utf8');
  // The background search is checked on its own below: it polls, so calls and records do not pair up.
  const deep = full.slice(full.indexOf('async function deepSearch'), full.indexOf('async function webSearch'));
  const src = full.replace(deep, '');
  assert.strictEqual((deep.match(/recordText\(/g) || []).length, 2, 'records when stopped and when finished');
  assert.ok(deep.indexOf('recordText(') < deep.indexOf("if (resp.status !== 'completed')"), 'records before judging the result');
  const calls = (src.match(/await (openaiClient\(\)|anthropicClient\(\)|call\()/g) || []).length;
  const metered = (src.match(/meter\(\)\.recordText\(/g) || []).length;
  // The probe is the one deliberate exception: it checks the connection, it does no work.
  const probe = src.slice(src.indexOf('async function probe'), src.indexOf('async function webSearch'));
  const probeCalls = (probe.match(/await (openaiClient\(\)|anthropicClient\(\)|call\()/g) || []).length;
  assert.strictEqual(metered, calls - probeCalls);
  assert.match(fs.readFileSync('src/services/image.js', 'utf8'), /recordImages\(/);
  assert.match(fs.readFileSync('src/middleware/auth.js', 'utf8'), /meter'\)\.setUser/);
  assert.match(fs.readFileSync('src/services/clay/buildGen.js', 'utf8'), /purpose: 'build'/);
});

test('a failure to record is logged, never swallowed silently', () => {
  const src = fs.readFileSync('src/services/meter.js', 'utf8');
  assert.match(src, /console\.error\('\[meter\] could not record/);
  assert.match(src, /came back with no usage, so its cost is unknown/);
});
