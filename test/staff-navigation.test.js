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

// COMPLETING A TASK, NOT JUST FINDING THE SCREEN.
//
// The other half of "difficult to complete tasks". Walked signed-in on a phone, approving a listing
// waiting for review. Three faults, all in the one action:
//
//   1. "Approve — put it on the market" sat at y=2886 in a 2,177-pixel panel — nearly four
//      screenfuls down, below four brief textareas, the title, the price and the risk note. The most
//      common action on a review queue was the furthest thing from the top of it.
//
//   2. The right sentence was produced and then buried. The handler said "Approved. It is on the
//      market now." and announced it — and then called load(), which announced "1 listing shown."
//      over the top. The approval genuinely happened (verified in the database). The only thing a
//      blind staff member heard was a count of what was left.
//
//   3. Focus landed on BODY, dropping a keyboard or screen-reader user at the top of the document
//      with no idea what had happened.
const control = fs.readFileSync('public/market-control.html', 'utf8');

test('the decision comes before the editing, because deciding is the job', () => {
  const decide = control.indexOf('// ---- deciding');
  const edit = control.indexOf('// ---- what a buyer would see');
  assert.ok(decide > -1 && edit > -1);
  assert.ok(decide < edit, 'Approve and Reject must come before the brief editor');
});

test('the outcome leads and survives the refresh that follows it', () => {
  // load() re-renders the list and destroys the card, so the sentence is handed TO it rather than
  // spoken and overwritten a moment later.
  assert.match(control, /async function load\(outcome\)/);
  assert.match(control, /var lead = outcome \? outcome \+ ' ' : ''/);
  assert.match(control, /await load\(outcome\)/);
  // The count still follows — it is how somebody knows whether the queue is done — but it cannot
  // come first.
  assert.match(control, /lead \+ d\.listings\.length/);
});

test('the outcome names which listing, and names the saved one', () => {
  // "Approved" alone does not say WHICH, and on a queue that is the whole question. It reads
  // l.title rather than the title box: if somebody edits the title and approves without saving,
  // the saved title is what went live, so naming the unsaved one would report something that is
  // not on the market.
  assert.match(control, /var title = String\(l\.title \|\| 'That listing'\)/);
  assert.ok(!/String\(ti\.value \|\| l\.title/.test(control));
});

test('focus lands on what changed rather than on the document body', () => {
  assert.match(control, /region\.focus\(\)/);
  assert.match(control, /setAttribute\('tabindex','-1'\)/);
});

test('staff are not offered a decision they are forbidden to make', () => {
  // Walked live: submitted a listing as a creator, then opened the review queue as staff on the same
  // account. Approve and Reject were drawn, and pressing Approve returned 403 "You must recuse
  // yourself — you are the seller of this listing."
  //
  // The server guard is right and stays; neutrality has to be enforced where it cannot be bypassed.
  // What was missing is that the screen did not know, so the only way to learn the rule was to press
  // the button. Third instance of this shape today, after the endless auction's bid box and my own
  // project-page section offering to list a running business.
  assert.match(control, /l\.status==='in_review' && l\.is_mine/);
  assert.match(control, /Not yours to decide/);
  assert.match(control, /Somebody else on the team has to review it/);
  // And the feed has to actually carry it, or the check is always false and nothing changes.
  const admin = fs.readFileSync('src/routes/marketAdmin.js', 'utf8');
  assert.match(admin, /\(l\.seller_id = \$2\) AS is_mine/);
  assert.match(admin, /\[CLAY_EMAIL, req\.user\.id\]/);
});

test('the two composition tools fold; nothing about the state of the business does', () => {
  // Measured on a 390x780 phone, signed in, with real data: the console was 7,682 pixels — 9.8
  // screenfuls. Where it went:
  //   what needs me 1620 · handover 1351 · promotion 1307 · growth 880 · business 790
  //   clay 465 · people 341 · listings 256 · two navs 322
  //
  // Over a third of it, 2,658 pixels and 3.4 screenfuls, was two blocks that are not status at all.
  // They are tasks: compose a social post, write up your shift. Somebody opening Operations to see
  // how the business is doing scrolled past both to reach anything.
  //
  // The page argues against tabs and it is right — nothing about the state of the business should be
  // hidden behind a click you have to know to make. That rule is about STATUS. A composition form is
  // not status, and folding it hides no number from anybody. 9.8 screens down to 6.6, measured after.
  const con = fs.readFileSync('public/console.html', 'utf8');
  assert.match(con, /<summary><h2 id="mkt-h"/, 'promotion folds');
  assert.match(con, /<summary><h2 id="ho-h"/, 'end of shift folds');
  // Every status section stays open, and a test says so rather than a comment.
  for (const id of ['business-h', 'growth-h', 'people-h', 'clay-h', 'listings-h', 'now-h']) {
    assert.ok(!new RegExp('<summary><h2 id="' + id + '"').test(con), id + ' must not be folded');
  }
  // details, not a custom control: keyboard operable and announced as expanded or collapsed with no
  // JavaScript, and the content stays in the document for find-on-page.
  assert.ok(!/aria-expanded="false"/.test(con), 'no hand-rolled disclosure');
});
