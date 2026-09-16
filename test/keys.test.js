'use strict';
// KEYS.
//
// Walked 16 Sept 2026 against the real services: a fake Supabase token was refused and not saved; a
// real GitHub key was saved and described (acting account, classic, scopes, expiry); a Railway project
// token was saved and correctly called a project key that cannot create projects. Neither value was
// on the page or in the API. A key pasted into Penny's chat never showed on screen, was stored, was
// explained, and was not sent again on the next turn. The walk found two faults, fixed: the reminder
// fell after the key's own expiry, and a replaced key kept its encrypted value.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const crypto = require('crypto');
const K = require('../src/services/clay/keys');

const gh = 'ghp_' + 'A1b2'.repeat(9);

test('keys are recognised in chat, and ordinary IDs are not', () => {
  const found = K.detect('my github token ' + gh + ' and railway token 3c1f2a4b-1111-2222-3333-444455556666');
  assert.deepStrictEqual(found.map((f) => [f.service, f.keep]), [['github', true], ['railway', true]]);
  assert.strictEqual(K.detect('booking 3c1f2a4b-1111-2222-3333-444455556666').length, 0);
  assert.strictEqual(K.detect('sbp_' + 'f'.repeat(40))[0].service, 'supabase');
  const other = K.detect('sk-proj-' + 'x'.repeat(30) + ' sk_live_' + 'y'.repeat(20));
  assert.deepStrictEqual(other.map((f) => f.keep), [false, false], 'removed but never kept');
});

test('scrubbing replaces every copy, in every message, and only reports what the person sent', () => {
  const r = K.scrub([
    { role: 'user', content: 'use ' + gh + ' please, again ' + gh },
    { role: 'assistant', content: 'You said ' + gh },
  ]);
  assert.ok(!JSON.stringify(r.messages).includes(gh));
  assert.match(r.messages[0].content, /\[GitHub key, removed from the chat\]/);
  assert.strictEqual(r.found.length, 1);
});

test('the chat route scrubs before the model sees anything', () => {
  const src = fs.readFileSync('src/routes/penny.js', 'utf8');
  assert.ok(src.indexOf('Keys.scrub(req.body.messages)') < src.indexOf('agent.runChat('));
  assert.match(src, /messages: scrubbed\.messages,/);
  assert.doesNotMatch(src, /messages: req\.body\.messages,/);
});

test('the chat page hides keys at once and never resends the raw text', () => {
  const html = fs.readFileSync('public/penny.html', 'utf8');
  assert.match(html, /addTurn\('You', shown\.text, 'me'\)/);
  assert.strictEqual((html.match(/if \(shown\.hit\) messages\[mine\]\.content = shown\.text;/g) || []).length, 2);
  assert.match(html, /href="\/keys\.html"/);
});

test('a key is sealed with authenticated encryption and cannot be read without the master key', () => {
  const V = require('../src/lib/vault');
  const saved = process.env.KEYS_MASTER_KEY;
  try {
    delete process.env.KEYS_MASTER_KEY;
    assert.strictEqual(V.ready(), false);
    assert.throws(() => V.seal('x'), /not switched on/);
    process.env.KEYS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
    const s = V.seal(gh);
    assert.ok(!s.ciphertext.toString('utf8').includes(gh));
    assert.strictEqual(V.open(s), gh);
    const bad = Object.assign({}, s, { ciphertext: Buffer.from(s.ciphertext) });
    bad.ciphertext[0] ^= 1;
    assert.throws(() => V.open(bad));
    process.env.KEYS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
    assert.throws(() => V.open(s), 'another master key opens nothing');
  } finally {
    if (saved === undefined) delete process.env.KEYS_MASTER_KEY; else process.env.KEYS_MASTER_KEY = saved;
  }
});

test('nothing that lists keys can return the value', () => {
  const src = fs.readFileSync('src/services/clay/keys.js', 'utf8');
  const list = src.slice(src.indexOf('async function list'), src.indexOf('async function remove'));
  assert.doesNotMatch(list, /ciphertext|V\.open/);
  assert.doesNotMatch(src, /V\.open\(/, 'nothing in this service decrypts yet');
  const route = fs.readFileSync('src/routes/keys.js', 'utf8');
  assert.match(route, /'Cache-Control', 'no-store'/);
});

test('removing or replacing a key wipes it, and the database insists', () => {
  const src = fs.readFileSync('src/services/clay/keys.js', 'utf8');
  assert.strictEqual((src.match(/SET removed_at=now\(\), ciphertext=/g) || []).length, 2);
  const sql = fs.readFileSync('docs/migrations/067_keys.sql', 'utf8');
  assert.match(sql, /CHECK \(removed_at IS NULL OR length\(ciphertext\) = 1\)/);
  assert.match(sql, /ON yp_labs\.business_keys\(business_id, service\) WHERE removed_at IS NULL/);
});

test('the reminder comes before the key expires, never after', () => {
  const src = fs.readFileSync('src/services/clay/keys.js', 'utf8');
  assert.match(src, /Math\.min\(ROTATE_DAYS, before\)/);
  assert.strictEqual(K.ROTATE_DAYS, 90);
});

test('keys are their own permission, in no preset, and Penny only reads what is on file', () => {
  assert.ok(require('../src/lib/permissions').AREAS.includes('keys'));
  const sql = fs.readFileSync('docs/migrations/067_keys.sql', 'utf8');
  assert.match(sql, /'export','keys'\)\)/);
  const W = require('../src/services/clay/workspace');
  assert.ok(W.EXECUTORS.list_keys);
  assert.match(W.TOOLS.list_keys.summary, /Never the keys themselves/);
  assert.match(fs.readFileSync('src/services/clay/penny.js', 'utf8'), /Never ask anyone to\ntype or paste a key into the chat/);
});

test('reachable from Today, with the value field treated as a secret', () => {
  assert.match(fs.readFileSync('public/today.html', 'utf8'), /href="\/keys\.html"/);
  const html = fs.readFileSync('public/keys.html', 'utf8');
  assert.match(html, /id="value" class="box" type="password" autocomplete="off" autocapitalize="none" spellcheck="false"/);
  assert.match(html, /\$\('value'\)\.value = '';/);
});
