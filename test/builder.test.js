'use strict';
// ASKING PENNY TO BUILD SOMETHING.
//
// The database refuses to charge for anything nobody approved. This is the flow above it, and its
// job is to make the free path the obvious one rather than a concession.
//
//   ask -> mock (free, unlimited) -> approve -> real (charged once) -> handed over
//
// Walked end to end against a real Postgres. Every line quoted below is what it actually said.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/services/clay/builder.js', 'utf8');
const B = require('../src/services/clay/builder');

test('it will not build from a brief it does not understand', () => {
  // The old concept generator got this right and it is the one behaviour worth carrying forward: it
  // said "'Making money' is a goal, not yet a business concept" rather than generating something
  // plausible. A build made from a guess wastes the person's time and then asks them to judge it.
  //
  // Walked: "build me a website" ->
  //   "tells me what to make but not what it should do. What should somebody be able to do with it?
  //    For example: take a booking without calling you, see what they owe, or send you photos."
  assert.strictEqual(B.understand('build me a website').ok, false);
  assert.strictEqual(B.understand('make me an app').ok, false);
  assert.strictEqual(B.understand('more customers').ok, false);
  // And it does not mistake brevity for vagueness. "Booking page" is four words and perfectly clear.
  assert.strictEqual(B.understand('a booking page for cleans').ok, true);
  assert.strictEqual(B.understand('somewhere customers see what they owe').ok, true);
});

test('the refusal offers the shape of an answer', () => {
  // A refusal that leaves somebody guessing what would have worked is a slower no.
  const s = B.understand('build me a website').says;
  assert.match(s, /What should somebody be able to do with it\?/);
  assert.match(s, /For example/);
});

test('free is said out loud, every time', () => {
  // "Free" that has to be discovered is not free in the way that matters. Somebody unsure whether
  // this costs money does not ask for the second one, and the second one is the whole point.
  assert.match(src, /It is free, it does not count against '/);
  assert.match(src, /as many as you like before deciding/);
  assert.match(src, /somebody who is unsure whether this costs money does not ask for the second/);
});

test('a build is never ready without somewhere to look', () => {
  // Walked: marking ready with no URL -> "A build is not ready until there is a URL somebody can
  // open. Nothing was marked done."
  //
  // "Does it respond" is not "can somebody get there". Three separate incidents in this estate were
  // a thing correct at every layer checked and unreachable at the layer that counted.
  return B.ready('00000000-0000-0000-0000-000000000000', {})
    .then((r) => {
      assert.strictEqual(r.ok, false);
      assert.match(r.says, /not ready until there is a URL somebody can open/);
      assert.match(r.says, /Nothing was marked done/);
    });
});

test('nothing unfinished can be approved', () => {
  // Approving something nobody has seen working would charge for exactly what this arrangement
  // exists to prevent. Walked: "That version is not finished yet, so there is nothing to approve."
  assert.match(src, /Approving something that is not finished would charge for work nobody has seen/);
  assert.match(src, /so there is nothing to approve/);
});

test('approval records the yes, and promises no charge that does not exist yet', () => {
  // Approval writes approved_at and chargeable in the same insert, so there is no state where
  // somebody agreed and it was not recorded. No price or invoicing exists yet (16 Sept 2026), so the
  // words must not announce a charge.
  assert.match(src, /mock_of, approved_at, chargeable, edit_of, tier\)/);
  assert.match(src, /This is the version you keep/);
  assert.doesNotMatch(src, /charged for, once/);
});

test('fixing our own mistake says it is not charged for', () => {
  // The database refuses a chargeable retry. This names it so nobody has to wonder. Walked:
  // "Fixing that now. This one is not charged for." — chargeable false.
  assert.match(src, /Fixing that now\. This one is not charged for/);
});

test('every failure carries a reason, including having none', () => {
  // A build that fails silently teaches people the thing is broken in general rather than that this
  // one attempt did not work.
  assert.match(src, /I do not have a reason to give you, which is itself a /);
});

test('a failed read is not a business with no builds', () => {
  assert.match(src, /That is not the same as you having '/);
});

test('an empty list says the mock-up is offered, not assumed', () => {
  const s = B.summarise([]);
  assert.match(s, /I will ask whether you want a free mock-up first/);
});

test('the summary counts what is waiting on the person', () => {
  // Walked 16 Sept 2026: a finished real build went unmentioned. Now every state is said.
  const s = B.summarise([
    { stage: 'mock', status: 'ready' }, { stage: 'real', status: 'queued' },
    { stage: 'real', status: 'building' }, { stage: 'real', status: 'ready' },
    { stage: 'mock', status: 'failed' },
  ]);
  assert.strictEqual(s, 'One mock-up is ready for you to look at, one build is finished and ready '
    + 'to open, 2 are still building, one did not finish.');
});
