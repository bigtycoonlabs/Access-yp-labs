'use strict';
// THE RULE ENGINE, AND THE FILING I INVENTED.
//
// I used "Ohio annual report, $25, due annually" as the worked example throughout this build — seed
// data, fixtures, the ranked list, commit messages. It does not exist. Ohio is one of about four
// states (with Arizona, Missouri and New Mexico) that require no LLC annual report at all. The $25
// was most likely pattern-matched from Ohio's Statutory Agent Update fee, a different filing for a
// different event.
//
// Plausible, specific, confidently stated and wrong — produced while building the machinery meant to
// prevent exactly that. Had it shipped, an Ohio owner would have been told every year to file
// something that does not exist.
//
// These tests exist so it cannot happen again by review alone.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/services/clay/compliance.js', 'utf8');
const C = require('../src/services/clay/compliance');

test('no rule can ship without a source, and the guard throws at load', () => {
  // Driven: removing the source line from one rule throws
  // "rule fed-w9-before-paying has no source. A rule that cannot cite itself must not ship."
  assert.match(src, /NO RULE WITHOUT A SOURCE/);
  for (const r of C.RULES) {
    assert.ok(r.source, r.id + ' has no source');
    assert.ok(/^https:\/\//.test(r.source_url), r.id + ' has no source URL');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.verified_on), r.id + ' has no verified date');
  }
});

test('no rule can put a number on something without a basis', () => {
  // Driven: removing cost_basis from the Florida rule throws at load.
  for (const r of C.RULES) {
    if (r.cost_if_missed_cents != null) assert.ok(r.cost_basis, r.id + ' has a cost and no basis');
  }
});

test('Ohio has no LLC annual report, and the engine says so', () => {
  // The correction, raised once, because the wrong belief is expensive and extremely common — and
  // because I held it myself while building this.
  const r = C.rulesFor({ entity_type: 'llc', formation_state: 'OH', operating_states: ['OH'] });
  assert.ok(!r.obligations.some((o) => /annual report/i.test(o.title)),
    'Ohio must never be given an annual report');
  const note = r.notes.find((n) => /does not require an LLC annual report/i.test(n.title));
  assert.ok(note, 'the absence should be stated, not left silent');
  // Moved into the fifty-state table; the wording now names what Ohio DOES require instead.
  assert.match(note.says, /statutory agent/);
  assert.match(note.says, /600 municipalities/);
});

test('absence is an answer worth stating', () => {
  // Every compliance tool lists what you owe. Almost none tell you what you do not, which is why
  // people pay for filings they never needed.
  assert.match(src, /ABSENCE IS AN ANSWER WORTH STATING/);
});

test('Florida is exact, and the ranked number is the penalty not the fee', () => {
  // Verified against the Division of Corporations: $138.75 fee, due 1 May, $400 non-waivable late
  // penalty from 2 May, administrative dissolution on the fourth Friday of September.
  //
  // The $400 is what goes in cost_if_missed_cents, because the fee is owed either way — what missing
  // it costs is the penalty.
  const r = C.rulesFor({ entity_type: 'llc', formation_state: 'FL', operating_states: ['FL'] });
  const ar = r.obligations.find((o) => /FL annual report/.test(o.title));
  assert.ok(ar);
  assert.strictEqual(ar.cost_if_missed_cents, 40000);
  assert.strictEqual(ar.cost_basis, 'known');
  assert.match(ar.cost_note, /\$138\.75/);
  assert.match(ar.consequence, /third Friday in September/);
  assert.match(ar.source_ref, /checked \d{4}-\d{2}-\d{2}/);
});

test('a standing condition gets no invented deadline', () => {
  // Ohio's statutory agent is a condition, not a date. Giving it a fake annual due date would put a
  // made-up deadline on the ranked list, which is the thing this file exists to stop.
  const r = C.rulesFor({ entity_type: 'llc', formation_state: 'OH', operating_states: ['OH'] });
  const agent = r.obligations.find((o) => /statutory agent/i.test(o.title));
  assert.strictEqual(agent.due_at, null);
});

test('contractor rules only apply when there are contractors', () => {
  const b = { entity_type: 'llc', formation_state: 'FL', operating_states: ['FL'] };
  assert.ok(!C.rulesFor(b, {}).obligations.some((o) => /1099/.test(o.title)));
  assert.ok(C.rulesFor(b, { has_contractors: true }).obligations.some((o) => /1099/.test(o.title)));
});

test('what is NOT covered is said out loud', () => {
  // Silence reads as "nothing else applies". A person who thinks the list is complete is worse off
  // than one who knows it is a start.
  // Every state is in the table now, so the note is no longer about missing states — it is about
  // which figures are confirmed, which is the honest remaining gap.
  // Georgia is unconfirmed, so the gap is named. OH and TN would NOT produce that clause — Ohio has
  // no report at all and Tennessee is verified — and the first version of this test asserted it
  // anyway. The note has to be true of the states actually asked about.
  const gap = C.coverageNote({ formation_state: 'GA', operating_states: ['GA'] });
  assert.match(gap, /deadline but not a confirmed fee/);
  const solid = C.coverageNote({ formation_state: 'OH', operating_states: ['OH', 'TN'] });
  assert.ok(!/not a confirmed fee/.test(solid), 'do not warn about states that are known');
  // The local caveat is always true, so it is always said.
  assert.match(solid, /city and county licences sit on top/);
});

test('coverage is now every state, with confidence attached', () => {
  // The earlier version of this test asserted two states, which was true and honest at the time.
  // Covering fifty badly would be worse than covering two well — so the table covers fifty and each
  // entry says how well it is known, rather than all fifty pretending to equal certainty.
  assert.strictEqual(C.COVERED_STATES.length, 51);
  const S = require('../src/services/clay/states');
  assert.ok(S.VERIFIED_STATES.length >= 10);
  assert.ok(S.VERIFIED_STATES.length < S.ALL_STATES.length,
    'if everything claims to be verified, the label means nothing');
});

test('the invented filing is gone from the codebase', () => {
  // It had spread into seed data, five test files, the ranked list and the Today page.
  const files = ['src/lib/ranking.js', 'public/today.html', 'src/routes/obligations.js',
    'src/services/clay/workspace.js'];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/Ohio annual report/.test(s), f + ' still carries the invented filing');
  }
});
