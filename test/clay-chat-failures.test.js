'use strict';
// WHAT A PERSON SEES WHEN CLAY CANNOT ANSWER, AND WHAT REACHES THE SCREEN WHEN HE CAN.
//
// Both found by working with Clay in a browser as a brand new account.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const stream = fs.readFileSync('public/js/clay-stream.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');

test('markdown never reaches the screen as literal characters', () => {
  // Live reply: "the hard part won't be walking dogs. It'll be **trust and access**".
  //
  // Every bubble renders with textContent, deliberately — no innerHTML near model output. The cost
  // is that markdown arrives as characters. A sighted reader shrugs; VoiceOver reads "asterisk
  // asterisk trust and access asterisk asterisk" mid-sentence, to exactly the audience this platform
  // is built for. His prompt already forbids markdown, and a prompt is guidance, so the render
  // strips it as well.
  assert.match(stream, /function speakable\(text\)/);
  for (const call of ['p.textContent = speakable(text)', 'spoken.textContent = speakable(text)']) {
    assert.ok(stream.includes(call), 'must strip on: ' + call);
  }
  // STREAMING STRIPS ON THE ACCUMULATED TEXT, NEVER PER CHUNK.
  //
  // My first version called speakable() on each delta and I shipped it. Eighteen literal asterisks
  // were still on the live page when I went and looked. The chunks arrive split — "**trust" in one
  // and " and access**" in the next — so a regex looking for a matched pair can never see one
  // inside a fragment. The test that passed was checking the call existed, not that it worked.
  assert.match(stream, /answerEl\._raw \+= ev\.text;/);
  assert.match(stream, /answerEl\.textContent = speakable\(answerEl\._raw\)/);
  assert.ok(!/textContent \+= speakable/.test(stream), 'per-chunk stripping cannot work');
  // Emphasis is removed, not converted — turning it into markup would mean innerHTML on model
  // output, which is not a trade worth making.
  assert.ok(!/innerHTML\s*=\s*[^'"]*speakable/.test(stream));
});

test('the stripper handles what Clay actually emits', () => {
  // Loaded rather than reimplemented, so the test exercises the shipped function.
  const src = stream.slice(stream.indexOf('function speakable'));
  const speakable = new Function('return ' + src.slice(0, src.indexOf('\n}\n') + 2))();
  assert.strictEqual(speakable('It will be **trust and access** here'), 'It will be trust and access here');
  assert.strictEqual(speakable('## Heading'), 'Heading');
  assert.strictEqual(speakable('- one\n- two'), 'one\ntwo');
  assert.strictEqual(speakable('use `npm test` now'), 'use npm test now');
  // Not over-eager: a lone asterisk or an underscore inside a word is left alone.
  assert.strictEqual(speakable('2 * 3 = 6'), '2 * 3 = 6');
  assert.strictEqual(speakable('snake_case_name'), 'snake_case_name');
  assert.strictEqual(speakable(null), '');

  // And the case that actually bit: a bold run split across two streaming chunks. Stripping each
  // chunk leaves both halves on screen; stripping the joined text removes them.
  const chunks = ['It will be **trust', ' and access** here'];
  assert.notStrictEqual(chunks.map(speakable).join(''), 'It will be trust and access here');
  assert.strictEqual(speakable(chunks.join('')), 'It will be trust and access here');
});

test('a failed turn is drawn, not only announced', () => {
  // Live: the session expired mid-conversation, the stream 401'd, the plain request 401'd, the
  // refresh 401'd — and the person got an empty bubble with Clay's name on it and nothing in it.
  // The failure was announced to a live region and drawn nowhere. A sighted user saw Clay reply with
  // silence; a screen-reader user heard one sentence float past with nothing to act on.
  //
  // An empty reply from an assistant is the worst version of this: it reads as "he has nothing to
  // say to you" rather than "something broke on our side".
  assert.match(app, /box\.className = 'msg err'/);
  assert.match(app, /setAttribute\('role', 'alert'\)/);
  assert.match(app, /thinking\.appendChild\(box\)/);
});

test('an expired session says so, and gives a way back', () => {
  assert.match(app, /Your session timed out/);
  assert.match(app, /Nothing was lost/);
  assert.match(app, /a\.href = '\/login\.html'/);
  // And a genuine fault says it is ours rather than blaming the person for the message they sent.
  assert.match(app, /It is a fault on our side, not something you did/);
  assert.match(app, /nothing was saved/);
});

test('focus lands on the failure so it is not scrolled past', () => {
  assert.match(app, /box\.scrollIntoView\(\{ block: 'center' \}\); box\.focus\(\)/);
});
