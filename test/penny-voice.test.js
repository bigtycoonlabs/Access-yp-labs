'use strict';
// PENNY SPEAKING AND LISTENING (17 Sept 2026). Heart, the same engine that reads the advertisements,
// on this server. Speech is additive: every word spoken is also on the page, because a voice that
// carries something the text does not would put a blind client back where they started.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const V = require('../src/services/clay/voice');

test('she speaks as Heart, on this server, a sentence at a time', () => {
  assert.strictEqual(V.VOICE, 'af_heart');
  // Matched on behaviour, not on how a comment happens to wrap.
  const src = fs.readFileSync('src/services/clay/voice.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(src, /dtype: 'q8'/);
  assert.match(src, /never reaches the browser/);
  assert.ok(V.MAX_CHARS <= 1000);
});

test('an answer is broken into whole sentences, in order, and a web address is readable aloud', () => {
  const said = V.sentences('Connected. I can hand invoices to Arbo.\nOpen https://accessyplabs.com/plans.html to see them.');
  assert.deepStrictEqual(said.slice(0, 2), ['Connected.', 'I can hand invoices to Arbo.']);
  assert.match(said[2], /accessyplabs dot com/);
  assert.strictEqual(V.sentences('').length, 0);
});

test('nothing is ever returned as silence dressed as success', async () => {
  const empty = await V.speak('   ');
  assert.strictEqual(empty.ok, false);
  assert.match(empty.says, /nothing to say/i);
  const long = await V.speak('x'.repeat(V.MAX_CHARS + 1));
  assert.strictEqual(long.ok, false);
  assert.match(long.says, /a sentence at a time/);
  const src = fs.readFileSync('src/services/clay/voice.js', 'utf8');
  assert.match(src, /I could not speak that just now, so nothing was played/);
  assert.match(src, /The words are on the screen/);
});

test('listening never invents words, and keeps no recording', () => {
  const ears = fs.readFileSync('src/services/clay/ears.js', 'utf8');
  assert.match(ears, /never kept/);
  assert.match(ears, /I will not guess/);
  assert.match(ears, /I did not hear anything in that/);
  assert.doesNotMatch(ears, /INSERT INTO|query\(/, 'a recording is not stored anywhere');
});

test('the live channel says what she is doing, and is the same turn as the written one', () => {
  const route = fs.readFileSync('src/routes/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(route, /router\.post\('\/chat\/live'/);
  assert.match(route, /text\/event-stream/);
  assert.match(route, /sse\('working'/);
  assert.match(route, /allowTools: WORKSPACE_TOOLS[\s\S]{0,400}onEvent/);
  // The live turn is checked against the month's allowance before the model is asked, and counted
  // only when she answered, exactly as the written turn is.
  const live = route.slice(route.indexOf("router.post('/chat/live'"), route.indexOf("router.post('/chat',"));
  assert.match(live, /Allowance\.check\(req\.user, 'penny_message'\)/);
  assert.match(live, /out\.status !== 'unavailable'\) await Allowance\.record\(req\.user, 'penny_message'\)/);
  assert.match(route, /for \(const line of Voice\.sentences/);
  // A failed turn is said, never left as silence.
  assert.match(route, /a failure on my side, not/);
  assert.match(route, /an answer, and nothing has been changed/);
});

test('the voice is warmed at boot but never blocks it', () => {
  const server = fs.readFileSync('src/server.js', 'utf8');
  assert.match(server, /require\('\.\/services\/clay\/voice'\)\.warm\(\)/);
  assert.match(server, /catch \(_\) \{ \/\* speech stays off/);
});

test('the page offers both ways and takes neither away', () => {
  const page = fs.readFileSync('public/penny.html', 'utf8');
  assert.match(page, /id="talk"/);
  assert.match(page, /id="voice"[^>]*aria-pressed="false"/);
  assert.match(page, /<textarea id="msg"/, 'typing still works');
  assert.match(page, /penny-voice\.js/);
  const js = fs.readFileSync('public/js/penny-voice.js', 'utf8');
  // Held with a key as well as a finger: a mouse-only control does not exist for a keyboard user.
  assert.match(js, /addEventListener\('keydown'/);
  assert.match(js, /addEventListener\('keyup'/);
});

test('what she heard is read back before it is sent as your words', () => {
  const js = fs.readFileSync('public/js/penny-voice.js', 'utf8');
  assert.match(js, /box\.value = d\.text/);
  assert.match(js, /It is in the box\. Press send, or edit it first/);
  assert.match(js, /I could not make that out[\s\S]{0,60}Nothing was sent/);
  assert.match(js, /microphone was not allowed, so nothing was recorded/);
});

test('sentences are spoken one at a time, in order, and a broken voice says so once', () => {
  const js = fs.readFileSync('public/js/penny-voice.js', 'utf8');
  assert.match(js, /if \(playing \|\| !queue\.length\) return/);
  assert.match(js, /queue\.push\(String\(line\)\)/);
  assert.match(js, /Her words are still on the screen/);
  assert.match(js, /speaking = false;[\s\S]{0,300}Penny speaks her replies: off/);
});

test('a live turn that stops halfway is never shown as a finished answer', () => {
  const js = fs.readFileSync('public/js/penny-voice.js', 'utf8');
  assert.match(js, /stopped partway and the connection closed, so this answer is not complete/);
  assert.match(js, /return \{ handled: false \}/, 'a channel that cannot start falls back to the written turn');
});
