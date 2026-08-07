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
  assert.match(sched, /daily_cap:/);
  assert.match(flat(sched), /A DELIBERATE REFUSAL IS NOT A FAILURE, but it must still be visible/i);
});

test('the status says whether Clay will seed, and why not', () => {
  assert.match(sched, /will_seed/);
  assert.match(sched, /row\.why/);
  assert.match(flat(sched), /answers the question a person is actually asking/i);
});
