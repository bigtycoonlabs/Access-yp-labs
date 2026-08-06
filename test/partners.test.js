'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

// These guard the PROMISE the launch partner board makes, not its markup: browsing never reveals
// anyone's contact details, and an introduction happens only when a creator says yes.
const src = fs.readFileSync(require.resolve('../src/routes/partners.js'), 'utf8');

function block(startPattern, lines) {
  const all = src.split('\n');
  const i = all.findIndex((l) => l.includes(startPattern));
  assert.ok(i >= 0, 'could not find ' + startPattern);
  return all.slice(i, i + lines).join('\n');
}

test('browsing the board never selects an email address', () => {
  const board = block("router.get('/board'", 22);
  assert.ok(!/\bemail\b/i.test(board), 'the board query must not touch emails');
  assert.ok(/display_name/.test(board), 'the board shows the pen name instead');
});

test('your own asks and offers view never selects an email address', () => {
  const mine = block("router.get('/mine'", 34).replace(/\/\/.*$/gm, '');  // ignore comments
  assert.ok(!/\bemail\b/i.test(mine), 'the mine query must not expose helper emails');
});

test('raising a hand does not hand the creator your contact details', () => {
  // Scan the WHOLE handler rather than a fixed number of lines, so adding a step to it (like the
  // dreamer tag gate) can never quietly move the thing under test out of view.
  const from = src.indexOf("requests/:id/interest");
  const to = src.indexOf("router.get('/mine'");
  assert.ok(from > -1 && to > from, 'could not bound the interest handler');
  const interest = src.slice(from, to);
  // The creator is emailed a notification, but the volunteer's address is never put in the body.
  assert.ok(/no contact details are exchanged|not shared/i.test(interest),
    'the notification must state that nothing was shared');
  assert.ok(!/\$\{?\s*req\.user\.email/.test(interest), "the volunteer's email is never embedded");
});

test('contact details are exchanged ONLY on acceptance, with the terms disclaimed', () => {
  const decide = block("router.post('/interest/:id/:decision'", 60);
  assert.ok(/helper_email/.test(decide) && /owner_email/.test(decide), 'both are introduced');
  // Match the GUARANTEE, not one exact phrasing, so rewording the sentence doesn't fail the test
  // while dropping the disclaimer entirely still does.
  assert.ok(/not a party to|not part of that agreement|holds? no responsibility/i.test(decide),
    'the introduction must say the platform is not part of the arrangement');
  // A decline must NOT introduce anyone.
  const declineChunk = decide.slice(decide.indexOf('if (!accept)'), decide.indexOf('// Accepted'));
  assert.ok(!/You can reach them at/.test(declineChunk), 'declining never shares an address');
});
