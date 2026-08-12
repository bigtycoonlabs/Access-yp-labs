'use strict';
// THE DOOR IN FRONT OF THE DOOR, AND THE LANGUAGE ON IT.
//
// Clicking "The Dream Market" landed on marketplace.html, which redirected to enter.html, which
// asked you to click "Drift into the Dream Market" before letting you see anything. Somebody who
// clicked The Dream Market has already said where they want to go. Asking them to confirm it on a
// second screen is a door in front of a door.
//
// The owner's note on the copy, and he is right: "A thousand unlived ideas turn, all at once, toward
// you" is creepy. A thousand things noticing you at the same moment is a horror image, not a
// welcome, and it was the last thing anyone heard before the market opened.
//
// "Something here already has your name on it" is the worse one, and it breaks a rule this platform
// has in writing. It promises that one of these is meant for you. We cannot know that, and the
// honest caution elsewhere says the median seller earns very little and most listed projects never
// sell. Fate at the door and candour inside is two voices.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const entry = fs.readFileSync('public/js/dreamentry.js', 'utf8');
const market = fs.readFileSync('public/marketplace.html', 'utf8');
const code = entry.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

test('the entry plays on the click, which is what lets it make a sound', () => {
  // A browser will not start audio without a user gesture in the SAME document. The entry used to
  // live behind a redirect, so by the time it ran there was no gesture left and the sound was lost
  // the moment the confirm button was removed. Creating the AudioContext inside the click handler
  // is the whole fix.
  assert.match(code, /a\.addEventListener\('click', enter\)/);
  assert.match(code, /try \{ playDream\(\); \} catch/);
  assert.match(code, /new \(window\.AudioContext\|\|window\.webkitAudioContext\)/);
});

test('there is no extra screen between the click and the market', () => {
  // marketplace.html used to bounce anyone without a session flag to a separate entry page.
  assert.ok(!/location\.replace\('\/enter\.html'\)/.test(market));
  assert.match(code, /location\.href = DEST/);
});

test('no skip and no mute, because it is under three seconds', () => {
  // A control to escape a three second thing is more friction than the thing.
  // Comments stripped: the file EXPLAINS that there is deliberately no skip, and that explanation
  // is why the decision is understandable later.
  assert.ok(!/skipentry|Skip to the market|<button/i.test(code));
});

test('a stated preference for less motion is still answered with yes', () => {
  assert.match(code, /if \(reduce\) \{ location\.href = DEST; return; \}/);
});

test('the words are spoken once, not narrated as an animation', () => {
  // The overlay is hidden from assistive tech and one clean sentence goes to the live region.
  assert.match(code, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(code, /window\.announce/);
});

test('nothing turns toward you and nothing has your name on it', () => {
  assert.ok(!/turn, all at once, toward you/.test(entry));
  assert.ok(!/has your name on it/.test(entry));
  assert.match(code, /a business somebody never got around to starting/);
});

test('opening in a new tab still works, and so does having no JavaScript', () => {
  // Modified clicks are left alone, and the destination is a real href underneath.
  assert.match(code, /e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.button > 0/);
});
