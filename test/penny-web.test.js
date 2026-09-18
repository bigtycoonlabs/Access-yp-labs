'use strict';
// LOOKING THINGS UP, AND BUYING NOTHING (17 September 2026).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const W = require('../src/services/clay/workspace');

test('she can search the web, and says when it is not switched on rather than guessing', () => {
  assert.deepStrictEqual(W.TOOLS.search_web.required, ['query']);
  assert.strictEqual(typeof W.EXECUTORS.search_web, 'function');
  const src = fs.readFileSync('src/services/clay/workspace.js', 'utf8')
    .replace(/\/\//g, ' ').replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  assert.match(src, /not switched on for this server, so I have not searched\. I have not guessed either/);
  assert.match(src, /so I have nothing from the web\. I will not fill the gap myself/);
  // Compliance keeps its own harder path, with sources kept and checked.
  assert.match(W.TOOLS.search_web.summary, /use research_compliance instead/);
});

test('a shopping list is searched item by item and buys nothing', () => {
  assert.deepStrictEqual(W.TOOLS.shopping_list.required, ['business_id', 'name', 'items']);
  assert.match(W.TOOLS.shopping_list.summary, /You never buy anything/);
  const src = fs.readFileSync('src/services/clay/workspace.js', 'utf8')
    .replace(/\/\//g, ' ').replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  assert.match(src, /Each line searched for separately, because one search for six things returns six half-answers/);
  assert.match(src, /I have not bought anything/);
  // What it could not find is named, not quietly dropped.
  assert.match(src, /though I could not find/);
  assert.match(src, /Prices were what I saw when I looked/);
});

test('she is told never to stop at no', () => {
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(penny, /Never stop at no/);
  assert.match(penny, /The answer to "can you file this for me" is what filing it actually takes, not a refusal/);
  assert.match(penny, /Look it up with search_web rather than answering from memory/);
});

test('searching alone is safe work; buying is not a thing she can do at all', () => {
  const S = require('../src/services/clay/standing');
  const safe = S.UNATTENDED_TOOLS();
  assert.ok(safe.includes('search_web'), 'she can research on a schedule');
  assert.ok(safe.includes('shopping_list'), 'and prepare a list to buy from');
  assert.ok(!Object.keys(W.TOOLS).some((t) => /buy|order|checkout|purchase/i.test(t)),
    'nothing in her hands spends money');
});
