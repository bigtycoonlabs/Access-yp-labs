'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const seed = fs.readFileSync(require.resolve('../src/services/clay/seed.js'), 'utf8');
const sched = fs.readFileSync(require.resolve('../src/services/clay/seedScheduler.js'), 'utf8');

test('the minority floor counts HUMAN listings, so Clay cannot block himself', () => {
  // It measured the floor against ALL live listings including Clay's own, so his seeding raised the
  // total, crossed the floor, and stopped him — at exactly the moment bootstrapping mattered most.
  assert.match(seed, /COUNT\(\*\) FILTER \(WHERE seller_id<>\$1\)::int AS human/);
  assert.match(seed, /if \(human < MINORITY_FLOOR\) return false;/);
  assert.match(flat(seed), /Clay's seeding raised the total, crossed the floor, and then blocked itself/i);
});

test('the cap still bites once real creators hold the market', () => {
  assert.match(seed, /return \(clayCount \/ total\) >= MINORITY_SHARE;/);
});

test('a deliberate refusal is reported, not silent', () => {
  // 'Enabled: true' with nothing appearing is indistinguishable from a broken seeder. That is how a
  // working guardrail got mistaken for a fault for a full day.
  assert.match(sched, /declined: true/);
  assert.match(sched, /minority_cap:/);
  assert.match(sched, /weekly_cap:/);
  assert.match(flat(sched), /A DELIBERATE REFUSAL IS NOT A FAILURE, but it must still be visible/i);
});

test('the status says whether Clay will seed, and why not', () => {
  assert.match(sched, /will_seed/);
  assert.match(sched, /row\.why/);
  assert.match(flat(sched), /answers the question a person is actually asking/i);
});

test('the listability check knows about the asset types generation ACTUALLY produces', () => {
  // Generation was consolidated to produce one 'tech_spec' instead of the older
  // build_instructions / tech_requirements / website_prompt trio, and this list was not updated
  // with it. Every new seed then built 11 real materials and silently failed to list — the project
  // existed, nothing reached the review queue, and it looked exactly like Clay had stopped seeding.
  assert.match(seed, /'tech_spec', 'build_instructions', 'tech_requirements', 'website_prompt', 'html_demo'/);
});

test('valuation counts the current build-path asset, or every new project is undervalued', () => {
  const val = fs.readFileSync(require.resolve('../src/services/clay/valuation.js'), 'utf8');
  assert.match(val, /const BUILD_PATH_TYPES = \['tech_spec'/);
});

test('every build-path list agrees on tech_spec, so they cannot drift apart again', () => {
  // Three separate files each kept their own copy of "what counts as a route to building it".
  const files = ['../src/services/clay/seed.js', '../src/services/clay/valuation.js'];
  files.forEach((f) => {
    const src = fs.readFileSync(require.resolve(f), 'utf8');
    assert.ok(src.includes("'tech_spec'"), f + ' must recognise tech_spec');
  });
});

test('a creator can add the kinds of material Clay actually writes', () => {
  const concepts = fs.readFileSync(require.resolve('../src/routes/concepts.js'), 'utf8');
  ['tech_spec', 'money_flow', 'growth_plan', 'presell_kit'].forEach((tp) => {
    assert.ok(concepts.includes("'" + tp + "'"), 'ASSET_TYPES must include ' + tp);
  });
});


test('the cap is two a week, not three a day', () => {
  // The old cap was three a day and it worked exactly as written: 43 of the platform's 55 concepts
  // are Clay's, 21 of them from a single week. The guardrail meant to keep him a minority presence
  // left him at 78% of the platform.
  //
  // Volume was never the constraint. There are 55 concepts here and one recorded customer
  // conversation. And now that projects can be built on collaboratively, a thin seed is worse than
  // no seed: it is an invitation somebody might waste an evening accepting.
  const seedjs = require('../src/services/clay/seed');
  assert.strictEqual(seedjs.WEEKLY_CAP, 2);
  assert.strictEqual(seedjs.DAILY_CAP, undefined, 'the old cap must not survive alongside the new one');
});

test('the window is a rolling seven days, in the gate AND on the screen', () => {
  // A calendar boundary would let the week's allowance land on Sunday night and the next week's on
  // Monday morning: four seeds in twelve hours, which is the exact behaviour the cap prevents.
  //
  // And both places must count the SAME window. A screen saying "0 today" while the gate refuses on
  // a seven-day count is the shape of bug this codebase keeps producing — two numbers about the same
  // thing that disagree.
  assert.match(seed, /created_at >= now\(\) - interval '7 days'/);
  assert.match(sched, /created_at >= now\(\) - interval '7 days'/);
  assert.ok(!/date_trunc\('day', now\(\)\)/.test(seed), 'no calendar-day counting left in the gate');
  assert.ok(!/date_trunc\('day', now\(\)\)/.test(sched), 'no calendar-day counting left on the screen');
});

test('the staff target can never exceed the hard cap', () => {
  const seedjs = require('../src/services/clay/seed');
  assert.match(sched, /Math\.min\(seed\.WEEKLY_CAP, dailyTarget\)/);
  assert.strictEqual(seedjs.WEEKLY_CAP, 2);
});
