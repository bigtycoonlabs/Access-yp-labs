'use strict';
// WHAT PENNY HAS BEEN TOLD (17 September 2026). The owner's line: "Penny, tell her how you want to
// work, tell her about your business, she does whatever you need." She used to start every
// conversation knowing only the records, so anything a person explained about how they like things
// done had to be said again the next day.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const W = require('../src/services/clay/workspace');

test('she can keep it, read it back, and drop it', () => {
  for (const t of ['remember_this', 'what_you_know', 'forget_this']) {
    assert.ok(W.TOOLS[t], t);
    assert.ok(W.TOOLS[t].summary.length < 1024, t);
    assert.strictEqual(typeof W.EXECUTORS[t], 'function', t);
    assert.strictEqual(W.TOOLS[t].requires_confirmation, false, t);
  }
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8');
  for (const t of ['remember_this', 'what_you_know', 'forget_this']) assert.match(penny, new RegExp("'" + t + "'"));
});

test('only what they said, never what she concluded', () => {
  const notes = fs.readFileSync('src/services/clay/notes.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(notes, /only what they actually said/i);
  assert.match(notes, /a guess read back as fact/i);
  assert.match(notes, /in their own words/);
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(penny, /never a conclusion you drew about them/);
});

test('it is carried into every turn, written or spoken, and never blocks one', () => {
  const route = fs.readFileSync('src/routes/penny.js', 'utf8');
  assert.strictEqual((route.match(/Notes\.forPrompt\(req\.user\.id\)\.catch\(\(\) => ''\)/g) || []).length, 2,
    'both the written turn and the spoken one');
  assert.strictEqual((route.match(/systemOverride: PENNY_WORKSPACE \+ told/g) || []).length, 2);
});

test('she will not hold more than she can keep straight, and says so', () => {
  const notes = fs.readFileSync('src/services/clay/notes.js', 'utf8');
  assert.match(notes, /const MAX = 40/);
  assert.match(notes, /as many as I can keep/);
  assert.match(notes, /I already had that, so I have not added it twice/);
  assert.match(notes, /I was not holding anything like that, so nothing changed/);
});

test('the homepage says what the product is: her, for whatever you need', () => {
  const home = fs.readFileSync('public/index.html', 'utf8').replace(/\s+/g, ' ');
  assert.match(home, /Penny is your business assistant/);
  assert.match(home, /There is no one thing she is for/);
  assert.match(home, /She remembers how you work/);
});
