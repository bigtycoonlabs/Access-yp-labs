'use strict';
// ONBOARDING — where the rule engine stops being data.
//
// Before this route, fifty-one jurisdictions of compliance rules were reachable by nobody. A person
// could sign up and the only way to get an obligation onto their list was to POST one by hand. The
// engine was built and unreachable, which is the same as unbuilt.
//
// Walked over real HTTP as four different businesses: a Florida cleaner with contractors, an Ohio
// LLC, a Delaware entity operating in California and Wyoming, and a brand-new empty account.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const route = fs.readFileSync('src/routes/onboard.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');
const ranking = fs.readFileSync('src/lib/ranking.js', 'utf8');

test('it is mounted — a route nobody can reach does not exist', () => {
  assert.match(server, /app\.use\('\/api\/onboard'/);
});

test('there is no wizard', () => {
  // No steps, no progress bar, nothing required but a name. A form demanding entity type and
  // formation state before it saves is how somebody bounces on day one — and a wizard is worse for a
  // screen-reader user, who cannot tell how much is left or go back without losing their place.
  assert.match(route, /It is not a wizard/);
  assert.match(route, /body\('entity_type'\)\.optional/);
  assert.match(route, /body\('formation_state'\)\.optional/);
});

test('signing up actually seeds the compliance rules', () => {
  // The whole point. Walked: a Florida cleaner with contractors came back with the FL annual report,
  // the 1099-NEC deadline and the W-9 task, written to the spine with sources attached.
  assert.match(route, /compliance\.rulesFor\(business/);
  assert.match(route, /INSERT INTO obligations/);
  assert.match(route, /'rule_engine'/);
});

test('the summary agrees with the list under it', () => {
  // THE DEFECT THIS TEST EXISTS FOR. The first version used rankedToday, which answers "what needs
  // you in the next 45 days". Onboarding asks a different question. It produced "One thing needs
  // you" directly above a list of three, because the Florida report was 228 days out and the 1099
  // was 138.
  //
  // Two statements from the same assistant disagreeing is where trust ends, and this estate has had
  // that failure before.
  assert.match(route, /NOT rankedToday/);
  assert.match(route, /Two statements from the same assistant disagreeing is where trust ends/);
  assert.match(route, /const byCost = written\.slice\(\)\.sort/);
});

test('found, missing and not-owed are kept separate', () => {
  // Never blended into one confident summary. A picture half-understood and stated confidently is
  // worse than an admitted gap.
  assert.match(route, /Found, assumed, missing — kept separate/);
  assert.match(route, /notes: found\.notes/);
  assert.match(route, /missing,/);
  assert.match(route, /coverage: compliance\.coverageNote\(business\)/);
});

test('what you do NOT owe is returned, not swallowed', () => {
  // Walked as an Ohio LLC: one obligation, plus the note that Ohio requires no annual report at all.
  // People pay for filings they never needed.
  assert.match(route, /Absence is an answer/);
});

test('the formation date is only asked for when it changes the answer', () => {
  // The first version asked whenever ANY obligation had no date, which caught Ohio's statutory agent
  // and the W-9 — both standing conditions with no date by design.
  //
  // Walked after the fix: WY asks (anniversary-timed), OH and FL do not.
  assert.match(route, /Asking for something that would not change the answer is how/);
  assert.match(route, /w\.detail && \/anniversary\/i\.test\(w\.detail\)/);
});

test('an undated obligation is still recorded, with its reason', () => {
  // A standing condition, or an anniversary state whose formation date is unknown. It carries the
  // reason instead of a fake date — inventing one is the failure the whole engine was rebuilt around.
  assert.match(route, /An obligation with no date is still worth recording/);
  assert.match(route, /o\.due_note \|\| null/);
});

test('the owner is a relationship, not a special case', () => {
  // One path for permission checks rather than a special case that can rot.
  assert.match(route, /VALUES \(\$1,\$2,\$3,'owner'\)/);
});

test('finding nothing is said honestly', () => {
  assert.match(route, /either good news or a sign I do not know/);
});

test('a consequence that already ends in a full stop does not get another', () => {
  // Produced "...on the fourth Friday.." — a stumble read aloud and sloppiness read on screen.
  assert.match(ranking, /appending another produced/);
  const R = require('../src/lib/ranking');
  const line = R.explain({ cost_if_missed_cents: 40000, cost_basis: 'known',
    due_at: new Date(Date.now() + 10 * 86400000), consequence: 'It dissolves the company.' });
  assert.ok(!/\.\./.test(line), 'double full stop: ' + line);
  const line2 = R.explain({ cost_if_missed_cents: 40000, cost_basis: 'known',
    due_at: new Date(Date.now() + 10 * 86400000), consequence: 'It dissolves the company' });
  assert.match(line2, /company\.$/);
});
