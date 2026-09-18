'use strict';
// THE FRONT DOOR — what happened to the tests that used to live here.
//
// This file tested the Access YP Labs marketplace homepage: its nav list, its idea box, the position
// of Clay's answer. That page has been replaced by the Penny Desk homepage, so the assertions
// describe markup that no longer exists.
//
// The lessons are not stale, and deleting them silently would throw away what they cost to learn.
// Recorded here, and the transferable ones are enforced in homepage.test.js against the page that
// now exists:
//
//   THE NAV THAT ATE THE PAGE. Making the menu a real list for screen readers left the styling
//   targeting the links, so items stacked one per row and the nav grew to 362px on a phone. The idea
//   box — the one thing that page existed for — was pushed to y=828 on a 780px screen. Of 31
//   visitors, 26 never typed a word. The accessibility fix was right; not looking at it on a phone
//   was the mistake.
//
//   THE ANSWER NOBODY SAW. Typing an idea and tapping the button changed nothing on screen. The
//   request succeeded and the answer rendered at y=811, thirty pixels below the fold. The page was
//   working perfectly and the person could not tell. Fixed by scrolling the answer into view and
//   giving it focus — and errors too, because an error nobody sees is indistinguishable from nothing
//   happening.
//
// That second one is enforced on the new homepage, where the same risk exists: a long result on a
// small phone puts the answer off-screen. See homepage.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

test('the lesson survived the page it was learned on', () => {
  // It was learned on the front door and lived in that page's script. The homepage was rewritten on
  // 17 Sept 2026 and no longer answers anything; the lesson moved to the page that does.
  const chat = fs.readFileSync('public/penny.html', 'utf8');
  assert.match(chat, /BROUGHT INTO VIEW AND GIVEN FOCUS/);
  assert.match(chat, /scrollIntoView/);
  assert.match(chat, /An error nobody sees is indistinguishable from nothing happening/);
});
