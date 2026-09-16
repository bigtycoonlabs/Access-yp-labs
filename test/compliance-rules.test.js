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
  const note = r.notes.find((n) => /does not require an annual report/i.test(n.title));
  assert.ok(note, 'the absence should be stated, not left silent');
  assert.match(note.says, /one of about four states/);
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
  const ar = r.obligations.find((o) => /Florida annual report/.test(o.title));
  assert.ok(ar);
  assert.strictEqual(ar.cost_if_missed_cents, 40000);
  assert.strictEqual(ar.cost_basis, 'known');
  assert.match(ar.cost_note, /\$138\.75/);
  assert.match(ar.consequence, /dissolves the company/);
  assert.match(ar.source_ref, /https:\/\//);
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
  const note = C.coverageNote({ formation_state: 'OH', operating_states: ['OH', 'TN'] });
  assert.match(note, /not yet\s*\n?.*for TN|not yet for TN/);
  assert.match(note, /treat\s*\n?.*this as a start|treat this as a start/);
  assert.strictEqual(C.coverageNote({ formation_state: 'FL', operating_states: ['FL'] }), null);
});

test('coverage is small on purpose', () => {
  // A rule engine that covers fifty states badly is worse than one that covers two honestly.
  assert.deepStrictEqual(C.COVERED_STATES, ['FL', 'OH']);
  assert.match(src, /COVERAGE IS SMALL ON PURPOSE/);
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
