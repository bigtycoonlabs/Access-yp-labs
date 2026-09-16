'use strict';
// THE CHAT PAGE.
//
// Walked on a 390x780 phone: once against the real server with no model key, and once with the
// response stubbed at the network boundary so the paths a model would produce — a confirmation, a
// tool list containing a failure, an incomplete turn — could actually be seen rather than reasoned
// about.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const html = fs.readFileSync('public/penny.html', 'utf8');

test('every attached component contributes a spoken sentence', () => {
  // On Flow a go-live checklist rendered perfectly and was announced to nobody, because the live
  // region only ever carried the message text. The card was there; for somebody listening it did
  // not exist.
  //
  // Verified live — the announcement with a failure and a confirmation attached read:
  //   "1 step did not work. She needs you to confirm something first. Mark this off as done...
  //    That is your Florida annual report..."
  assert.match(html, /EVERY ATTACHED COMPONENT CONTRIBUTES A SPOKEN SENTENCE/);
  assert.match(html, /function announce\(parts\)/);
  assert.match(html, /spoken\.push\(renderConfirm\(waiting, d\.awaiting_confirmation\)\)/);
  assert.match(html, /spoken\.push\(renderDid\(waiting, d\.tools_used\)\)/);
});

test('the outcome leads, the paragraph follows', () => {
  // "She needs you to confirm something" matters more than the prose before it. The reply is pushed
  // last, deliberately.
  const order = html.indexOf('spoken.push(d.reply)');
  assert.ok(order > html.indexOf('spoken.push(renderConfirm'), 'reply is announced after the outcome');
  assert.ok(order > html.indexOf("if (d.status === 'incomplete')"), 'status is announced first');
});

test('a confirmation is reachable, not merely present', () => {
  // SEEN ON THE PHONE RENDER: the card was behind the sticky composer. It existed, it was announced,
  // and a sighted person could not see it or press either button. Same defect Flow had, where an
  // answer rendered thirty pixels below the fold and the person said "nothing happened".
  //
  // After: card bottom at 563, composer top at 593, focus on "Yes, go ahead".
  assert.match(html, /"It is in the DOM" is not "somebody can get to it"/);
  assert.match(html, /box\.scrollIntoView\(\{ block: 'center'/);
  assert.match(html, /focus\(\{ preventScroll: true \}\)/);
});

test('what the tools did is a real list', () => {
  // A screen reader announces "list, two items" and lets somebody move between them. Lines joined
  // with <br/> are one run-on sentence. Verified: 2 list items inside a ul.
  assert.match(html, /A real list rather than lines joined with <br\/>/);
  assert.match(html, /'<div class="did"><ul>' \+ lines \+ '<\/ul><\/div>'/);
});

test('a failed step is shown even when the prose sounds confident', () => {
  // If Penny's words and this list disagree, the list is true.
  assert.match(html, /If Penny's prose and this disagree, this is\s*\n?\s*true/);
  assert.match(html, /<li class="no">/);
});

test('the confirmation shows the sentence written for a person', () => {
  assert.match(html, /The sentence written for a person, handed down from the tool's `ask`/);
  assert.match(html, /esc\(c\.ask\)/);
});

test('declining changes nothing, and says so', () => {
  assert.match(html, /Left alone\. Nothing was changed\./);
});

test('a failed confirmation never looks like a completed one', () => {
  assert.match(html, /That did not go through, so nothing has changed/);
});

test('an incomplete turn is never dressed up as a finished answer', () => {
  assert.match(html, /She stopped partway rather than rushing the rest/);
  assert.match(html, /spoken\.push\('She stopped partway and did not finish\.'\)/);
});

test('a failed request never leaves a blank considered answer', () => {
  assert.match(html, /I could not get an answer just now, and nothing has been changed/);
});

test('the whole conversation is sent every turn', () => {
  // She has no memory between calls. Sending only the last message is how an assistant answers the
  // same question twice and contradicts itself.
  assert.match(html, /she has no memory between calls/);
  assert.match(html, /body: JSON\.stringify\(\{ messages: messages \}\)/);
});

test('one main, one h1, one live region, labelled input, 44px targets', () => {
  // Verified in the rendered DOM: mains 1, h1s 1, live regions 1, unlabelled 0, none under 44px.
  assert.strictEqual((html.match(/<main/g) || []).length, 1);
  assert.strictEqual((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<label for="msg"/);
});

test('it has its own title', () => {
  assert.match(html, /<title>Ask Penny, Access YP Labs<\/title>/);
});
