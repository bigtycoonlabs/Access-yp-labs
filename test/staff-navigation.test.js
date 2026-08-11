'use strict';
// THE STAFF AREA WAS TWO DISCONNECTED ISLANDS.
//
// Walked as a staff member on a phone. The complaint was "still difficult to navigate, difficult to
// complete tasks", and the reason was structural rather than cosmetic:
//
//   From the global menu: Operations -> console.html -> market-control.html. Dead end. Two pages.
//   From the dashboard:   admin-overview.html -> admin-tools, admin-clay, desk-admin, weekly-admin,
//                         people. Six pages, cross-linked only to each other.
//
// Nothing joined them. From Operations there was no way to reach Clay Weekly, the Desk, moderation,
// people or Clay health. From the overview there was no way back to Operations or market control.
// The global menu offered exactly one staff entry, into the smaller island.
//
// The second island had no shared navigation either: each page carried its own hand-rolled `nav.top`
// listing a different subset — admin-tools four links, admin-clay six, people three — so which
// screens existed depended on which screen you were standing on. Seven of the eight had no
// aria-current, so a screen-reader user was never told where they were.
//
// A page nobody can get to does not exist. Eight of them were half in that state.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const STAFF_PAGES = ['console.html', 'market-control.html', 'desk-admin.html', 'weekly-admin.html',
  'people.html', 'admin-tools.html', 'admin-clay.html', 'admin-overview.html'];

const navSrc = fs.readFileSync('public/js/staffnav.js', 'utf8');

test('every staff screen carries the staff navigation', () => {
  for (const p of STAFF_PAGES) {
    const s = fs.readFileSync('public/' + p, 'utf8');
    assert.ok(/js\/staffnav\.js/.test(s), p + ' must load the staff navigation');
  }
});

test('the navigation lists every staff screen, so the set does not depend where you stand', () => {
  for (const p of STAFF_PAGES) {
    assert.ok(navSrc.includes("'/" + p + "'"), p + ' must be in the staff navigation');
  }
});

test('it says where you are, out loud and not only in bold', () => {
  // A colour or weight change alone answers "where am I" for one kind of user and nobody else.
  assert.match(navSrc, /setAttribute\('aria-current', 'page'\)/);
  // And the landmark is named: two unnamed nav landmarks read as "navigation, navigation", with no
  // way to tell the site menu from the staff menu.
  assert.match(navSrc, /setAttribute\('aria-label', 'Staff areas'\)/);
});

test('the competing hand-rolled bars are removed rather than left alongside', () => {
  // Leaving them would give a staff member two different answers to "what screens are there" on the
  // same page, which is worse than the one wrong answer they had before.
  assert.match(navSrc, /querySelectorAll\('nav\.top'\)/);
  assert.match(navSrc, /\.remove\(\)/);
});

test('the targets are thumb-sized', () => {
  // A queue is worked with a thumb on a phone, not a mouse.
  assert.match(navSrc, /minHeight = '44px'/);
});

test('Operations leads with what needs a person, not with a list of other places', () => {
  const s = fs.readFileSync('public/console.html', 'utf8');
  // The page is 7,300 pixels tall on a phone and the first thing anyone could act on sat at y=823,
  // forty-three pixels under a 780-pixel fold. Somebody opening Operations to find out what needed
  // them got a heading, a timestamp, and eight jump links to somewhere else — and had to scroll
  // before reaching the answer. Same fault as the idea box below the fold on the home page, on the
  // screen the team actually works from.
  const now = s.indexOf('id="now"');
  const jump = s.indexOf('class="console-nav"');
  assert.ok(now > -1 && jump > -1);
  assert.ok(now < jump, 'the urgent section must come before the list of sections');
});
