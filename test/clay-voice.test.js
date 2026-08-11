'use strict';
// CLAY'S VOICE WAS SWITCHED ON FOR PEOPLE WHO HAD ALREADY SIGNED UP.
//
// Read out of production — the first time anyone has read Clay's real generated words, because no
// model key has ever been available in a development session. Four visitor questions, four replies.
// Honest and competent every time. Flat every time: no opinion, no humour, no spark, a rhetorical
// question posed and then answered by him, and a nudge to create an account at the end of ALL FOUR,
// including in reply to a plain "hey".
//
// The cause was not the model. It was the prompt, and specifically a split: the account agent said
// "a sharp, funny, genuinely confident partner... a little playful... you have opinions and you
// share them". The PUBLIC prompt — the only Clay a stranger ever meets, and the one that decides
// whether they stay — said "warm, plain-spoken" and carried none of his beliefs at all.
//
// The personality was on for the people already inside and off for everyone at the door.

const { test } = require('node:test');
const assert = require('node:assert');
const { CLAY_VOICE } = require('../src/services/clay/version');
const { PUBLIC_SYSTEM_PROMPT } = require('../src/services/clay/capabilityProfile');
const fs = require('fs');
const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');

test('there is one definition of the voice, and both surfaces read it', () => {
  // Same fix the version string got, for the same reason: six surfaces once hardcoded their own and
  // drifted. A voice goes stale silently in exactly the same way.
  assert.match(CLAY_VOICE, /sharp, funny, genuinely confident/);
  assert.match(agent, /\$\{CLAY_VOICE\}/);
  assert.ok(PUBLIC_SYSTEM_PROMPT.includes('sharp, funny, genuinely confident'),
    'the visitor meets the same Clay as the member');
  // And the account agent must no longer carry its own copy to drift from.
  assert.ok(!/Your voice: you talk like a sharp/.test(agent));
});

test('the visitor gets his beliefs too, not just his manners', () => {
  assert.ok(PUBLIC_SYSTEM_PROMPT.includes('WHAT YOU BELIEVE'),
    'the public prompt carried CLAY_PURPOSE but none of CLAY_VALUES');
});

test('collaboration is defined as behaviour, not as a tone word', () => {
  // "Be collaborative" produces nothing. The measurable version is whether the turn comes back.
  assert.match(CLAY_VOICE, /the turn comes back to them/);
  assert.match(CLAY_VOICE, /Ask the one question you actually want the answer to/);
  assert.match(PUBLIC_SYSTEM_PROMPT, /REAL QUESTIONS ONLY/);
  assert.match(PUBLIC_SYSTEM_PROMPT, /One question, not three/);
});

test('he holds an opinion instead of hedging', () => {
  assert.match(CLAY_VOICE, /"it depends" is not an answer/);
});

test('the account is mentioned once, not every turn', () => {
  // Measured: 4 of 4 replies ended with a signup nudge, including to "hey". A person who has been
  // told once has not forgotten — they are deciding — and the repeat makes a partner feel like a
  // funnel while crowding out the thing that would actually convince them.
  assert.match(PUBLIC_SYSTEM_PROMPT, /MENTION THE ACCOUNT ONCE, NOT EVERY TIME/);
  assert.match(PUBLIC_SYSTEM_PROMPT, /do not say it again unless they bring it up/);
});

test('none of this loosens the honesty rules', () => {
  // Personality is the thing most likely to be bought with accuracy, and here that trade is not
  // available: the people relying on him cannot see the screen to catch a confident wrong answer.
  assert.match(CLAY_VOICE, /a confident wrong answer is the one thing you never give/);
  for (const rule of ['Never invent a number', 'Never claim you did something',
    'Never promise that an idea will succeed']) {
    assert.ok(PUBLIC_SYSTEM_PROMPT.includes(rule), 'still holds: ' + rule);
  }
});
