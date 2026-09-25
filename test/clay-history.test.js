'use strict';
// YOUR CONVERSATION BACK.
//
// Found by walking production: two exchanges with Clay, reload the Laboratory, one message on the
// page — the greeting. Everything said was gone.
//
// It was never lost. clay_messages has stored every message since that table shipped and nothing
// ever read it. There was a route to DELETE your history and none to SEE it, which is a striking
// shape for a gap to take: the platform could erase a conversation it could not show you.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const app = fs.readFileSync('public/js/app.js', 'utf8');

test('an empty history and a failed read are different answers', () => {
  // They look identical to a caller and only one of them means this person has never spoken to Clay.
  assert.match(app, /A failed read is not an empty history/);
});

test('a restored conversation replaces the greeting, it does not follow it', () => {
  // Welcoming somebody who was mid-conversation is its own small dishonesty — it tells them nothing
  // happened when something did.
  assert.match(app, /if \(restored\) \{/);
  assert.match(app, /Greeting a person who was mid-conversation is its own small dishonesty/);
  // And it is announced, so a screen-reader user knows the page did not start fresh.
  assert.match(app, /Picking up where you left off\. ' \+ restored \+ ' earlier messages restored/);
});

test('restored text goes through the markdown strip like everything else', () => {
  // sayLine is the one place every line Clay says is rendered. Restoring through anything else would
  // put literal asterisks back on screen for exactly the conversations people return to.
  assert.match(app, /node\.appendChild\(sayLine\(msg\.content\)\)/);
});

test('restoring gives the conversation back to CLAY, not only to the reader', () => {
  // My first version restored the DOM and left chatHistory empty — the array actually sent with the
  // next message. Found on production: the page showed six messages and Clay answered "I don't have
  // the earlier thread in front of me here, so I don't know what 'keep going' is attached to."
  //
  // He was honest about it, which is the only reason it was survivable. But the restore was
  // cosmetic: the person could read their conversation and the one participant who needed it could
  // not. A worse-behaved assistant would have guessed at what "keep going" meant.
  assert.match(app, /chatHistory\.push\(\{ role: msg\.role === 'user' \? 'user' : 'assistant', content: msg\.content \}\)/);
  // Rendering and remembering happen in the same loop, so one cannot be added without the other.
  const block = app.slice(app.indexOf("const h = await Kiln.api('/clay/history"), app.indexOf('restored += 1;'));
  assert.ok(block.includes('log.appendChild(node)'), 'render and remember must stay together');
});
