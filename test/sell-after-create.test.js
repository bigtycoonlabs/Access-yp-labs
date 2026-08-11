'use strict';
// WHAT HAPPENS AFTER YOU CREATE A LISTING.
//
// Walked live in a browser: signed in, picked a project, filled the form, clicked Create listing.
// It worked — the draft was created, the payout warning fired honestly. Three faults after that.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sell = fs.readFileSync('public/sell.html', 'utf8');

test('the announcement says what arrived and what it does, not only that a draft exists', () => {
  // "Listing created as a draft." is true and not enough. A draft does nothing: it is not on the
  // market and nobody can see it. The only thing that moves it is a Submit button that appears at
  // the same moment — and the announcement never mentioned it. Somebody who cannot see the page was
  // told they had made a thing, not that they were one click from the market and had not taken it.
  assert.match(sell, /It is not on the market yet/);
  assert.match(sell, /Submit for staff review button/);
});

test('focus lands on the button that just appeared', () => {
  // It was landing on BODY, dropping a keyboard or screen-reader user at the top of a 4,000-pixel
  // page while the thing they needed sat three thousand pixels down.
  assert.match(sell, /submit\.scrollIntoView\(\{block:'center'\}\); submit\.focus\(\)/);
});

test('submitting removes the button that no longer does anything', () => {
  // A button that has already been pressed and cannot be pressed again is a thing to trip over.
  assert.match(sell, /submit\.remove\(\)/);
  assert.match(sell, /nothing more for you to do on this one/);
});

test('the waitlist link is not advertised as shareable while it is dead', () => {
  // Two sentences contradicted each other: "Once this listing is live, anyone can join" followed by
  // "Share this link to capture real demand before it launches". Walked it as a stranger — that URL
  // currently reads "Could not load this listing: Listing not available." A seller following the
  // instruction sends an error page to the people whose interest they were capturing, and has no
  // way to know, least of all if they cannot see the screen.
  assert.match(sell, /It does not work yet/);
  assert.match(sell, /anyone you send it to today would see an error/);
  assert.match(sell, /Save it now, share it then/);
  // Comments stripped: the fix's own note quotes the old sentence, and that quote is why the change
  // is understandable later. What must not survive is the string being rendered to a person.
  const code = sell.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/Share this link to capture real demand before it launches/.test(code));
});
