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

// Redesigned 17 Sept 2026: the eight old screens were retired and now redirect to /staff/, which has
// one nav on every page (test/staff-portal.test.js). What remains here is the part of this file that
// checks live code: the review feed the old screens read.

test('the review feed says which listings are the reviewer\'s own', () => {
  // Walked live: submitted a listing as a creator, then opened the review queue as staff on the same
  // account. Approve and Reject were drawn, and pressing Approve returned 403 "You must recuse
  // yourself — you are the seller of this listing."
  //
  // The server guard is right and stays; neutrality has to be enforced where it cannot be bypassed.
  // A screen can only avoid offering that decision if the feed actually carries it, or the check is
  // always false and nothing changes.
  const admin = fs.readFileSync('src/routes/marketAdmin.js', 'utf8');
  assert.match(admin, /\(l\.seller_id = \$2\) AS is_mine/);
  assert.match(admin, /\[CLAY_EMAIL, req\.user\.id\]/);
});
