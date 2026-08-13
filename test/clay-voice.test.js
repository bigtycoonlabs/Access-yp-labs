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

test('Clay does not apologise for things he never did', () => {
  // Caught live. Somebody wrote "thanks for emailing me that research last week". He had never
  // emailed them anything. He answered: "I shouldn't have implied I could. That one's on me."
  //
  // He had not implied it. Apologising for something you did not do is not humility — it is agreeing
  // with a version of events that did not happen, which on this platform is the same failure as
  // claiming something you did not do. It also tells the person their memory is right when it is
  // not, and they may act on that.
  const { CLAY_VOICE } = require('../src/services/clay/version');
  assert.match(CLAY_VOICE, /DO NOT ACCEPT A FALSE PREMISE ABOUT YOUR OWN PAST/);
  assert.match(CLAY_VOICE, /that never happened, here is what did/);
  // The correction must not swing the other way into coldness, and a real mistake is still owned.
  assert.match(CLAY_VOICE, /you can be warm and still be the one holding the facts steady/);
  assert.match(CLAY_VOICE, /When you ARE wrong, say you were wrong and move on/);
});

test('Clay does not guess which country somebody is in', () => {
  // Caught live: a creator said "Cleveland" and got a first-year forecast in POUNDS STERLING, with
  // DBS checks and National Insurance — a British criminal record check and a British tax scheme —
  // delivered with complete confidence to somebody in Ohio. Many place names exist in more than one
  // country. Getting it wrong is not a rounding error: it sends somebody to register with the wrong
  // government.
  const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
  assert.match(agent, /MONEY IS IN US DOLLARS, AND YOU DO NOT GUESS SOMEBODY'S COUNTRY/);
  assert.match(agent, /Never name a country-specific scheme you have not been told applies/);
});

test('an earnings question is modelled, never forecast', () => {
  // The legal exposure the owner asked about. Refusing to discuss money would make Clay useless, and
  // a number with the arithmetic shown is genuinely valuable. What he must not do is present it as
  // his prediction: "My number: eighteen thousand in year one" is a forecast.
  const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
  assert.match(agent, /MODEL IT, DO NOT FORECAST IT/);
  assert.match(agent, /Never state what a project WILL earn/);
  assert.match(agent, /never quote an income figure for something listed in the Exchange/);
});

test('Clay is not still recruiting consultants', () => {
  // Consultants were retired, and I said so. One line survived in the coaching prompt: "as they
  // gain experience, creators can also consult for other creators for pay." So he kept selling a
  // product with no routes, no checkout and nobody on the other end — the exact failure I had
  // documented while fixing its twin in intent.js. Found by grepping for something else entirely.
  for (const f of ['src/services/clay/agent.js', 'src/services/clay/capabilityProfile.js',
    'src/services/clay/intent.js', 'src/services/clay/spine.js']) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    assert.ok(!/consult for other creators|become a consultant|as a paid consultant/i.test(code),
      f + ' still recruits consultants');
  }
});

test('the rename left no broken articles behind', () => {
  // "Dream Mover" -> "Affiliate" without touching the article in front of it, in 18 places including
  // user-facing errors: "Enroll as a Affiliate first."
  const files = [...fs.readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => 'public/' + f),
    ...fs.readdirSync('public/js').map((f) => 'public/js/' + f),
    ...fs.readdirSync('src/routes').map((f) => 'src/routes/' + f)];
  for (const f of files) {
    assert.ok(!/\ba Affiliate\b|\ba Exchange\b/.test(fs.readFileSync(f, 'utf8')), f);
  }
});
