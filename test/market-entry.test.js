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
const enter = fs.readFileSync('public/enter.html', 'utf8');
const code = enter.replace(/<!--[\s\S]*?-->/g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

test('the entry plays on arrival rather than asking for a second click', () => {
  assert.ok(!/<button id="go">/.test(enter), 'the Drift button is gone');
  assert.match(code, /else \{[\s\S]*drift\(\);/, 'the sequence starts by itself');
});

test('there is a way out for anyone who does not want to sit through it', () => {
  // A skip is the replacement for the button: not a way in, a way past. Real 44px target, visible
  // rather than revealed on focus — "skip this" that only appears when you tab is only a skip for
  // people who tab.
  assert.match(enter, /class="skipentry" id="skip" href="\/marketplace\.html\?entered=1"/);
  assert.match(enter, /\.skipentry\{[^}]*min-height:44px/);
});

test('a stated preference for less motion is answered with yes', () => {
  // Reduced motion used to only turn off the floating motes; the person still sat through the
  // sequence and a three second wait. They now go straight to the market.
  assert.match(code, /if \(reduce\) \{ location\.replace\('\/marketplace\.html\?entered=1'\); \}/);
});

test('nothing turns toward you and nothing has your name on it', () => {
  assert.ok(!/turn, all at once, toward you/.test(code));
  assert.ok(!/has your name on it/.test(code));
  assert.ok(!/You let go/.test(code), 'nobody arriving at a market wants to be told they are surrendering');
});

test('what replaces it is the actual pitch, and it is true', () => {
  // These really are businesses nobody got around to starting. That is the whole proposition, it
  // needs no ghost story, and it promises nothing we cannot keep.
  assert.match(code, /a business somebody never got around to starting/);
  assert.match(code, /They are all still here/);
});
