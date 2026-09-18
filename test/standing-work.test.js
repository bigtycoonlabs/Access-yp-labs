'use strict';
// WORK THAT HAPPENS WITHOUT BEING ASKED (17 September 2026).
//
// The owner's rule, in his words: anything that spends money, could break something, or needs a
// human approval, she does not do. Doing the safe work on a schedule and telling him afterwards is
// exactly what he does want. This file guards both halves.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const S = require('../src/services/clay/standing');
const W = require('../src/services/clay/workspace');
const { WORKSPACE_TOOLS } = require('../src/services/clay/penny');

test('alone she may only use tools that cost nothing and can be undone', () => {
  const safe = S.UNATTENDED_TOOLS();
  assert.ok(safe.length > 10, 'she can still do real work');
  for (const t of safe) {
    assert.strictEqual(W.TOOLS[t].requires_confirmation, false, t + ' asks for a human');
    assert.ok(!W.TOOLS[t].irreversible, t + ' cannot be undone');
    assert.ok(!S.NEVER_ALONE.includes(t), t + ' is on the never-alone list');
  }
  // The ones that spend money, publish, launch or settle something wait for a person.
  for (const t of ['send_invoice_to_flow', 'launch_build', 'start_build', 'publish_build', 'connect_flow']) {
    assert.ok(WORKSPACE_TOOLS.includes(t), t + ' should still exist in conversation');
    assert.ok(!safe.includes(t), t + ' must never run unattended');
  }
});

test('the gate is a rule, not a request in a prompt', () => {
  const src = fs.readFileSync('src/services/clay/standing.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(src, /allowTools: UNATTENDED_TOOLS\(\)/);
  assert.match(src, /a prompt is a request and a gate is a rule/);
  // And the list is built when it is used, not at load, or it would be silently empty.
  assert.match(src, /Worked out on first use rather than at load/);
  assert.ok(S.UNATTENDED_TOOLS().length > 0, 'the list is not empty at runtime');
});

test('a run that stopped for a person is not reported as done', () => {
  const src = fs.readFileSync('src/services/clay/standing.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(src, /if \(r\.status === 'confirmation_required'\) \{ status = 'needs_you'/);
  assert.match(src, /I stopped there because that needs your say-so/);
  assert.match(src, /status = 'failed'; summary = 'I could not run this time, so nothing was done\.'/);
  assert.match(src, /A silent run is indistinguishable from no run/);
});

test('every run is written down, and telling them is part of the job', () => {
  const src = fs.readFileSync('src/services/clay/standing.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(src, /INSERT INTO standing_runs \(job_id, status\) VALUES \(\$1,'running'\)/);
  assert.match(src, /UPDATE standing_runs SET finished_at=now\(\), status=\$2, summary=\$3/);
  assert.match(src, /UPDATE standing_runs SET told_them=true/);
  // Claimed before running, so two servers cannot do the same job twice.
  assert.match(src, /FOR UPDATE SKIP LOCKED/);
  const server = fs.readFileSync('src/server.js', 'utf8');
  assert.match(server, /Standing\.runDue\(\{ send: pennySend \}\)/);
});

test('the hour is the hour where the person is', () => {
  const daily = { cadence: 'daily', at_hour: 9, timezone: 'America/Chicago' };
  const next = S.nextRun(daily, new Date('2026-09-17T20:00:00Z'));
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false })
    .format(next);
  assert.strictEqual(Number(hour), 9);
  assert.ok(next > new Date('2026-09-17T20:00:00Z'), 'always in the future');
  const monthly = S.nextRun({ cadence: 'monthly', day_of_month: 3, at_hour: 7, timezone: 'America/Chicago' },
    new Date('2026-09-17T20:00:00Z'));
  const dom = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', day: 'numeric' }).format(monthly);
  assert.strictEqual(Number(dom), 3);
});

test('she is told to set one up rather than wait to be asked again', () => {
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(penny, /put it on a schedule with schedule_work rather than waiting to be asked again/);
  assert.match(penny, /nobody expects you to have paid a bill while they slept/);
  const standing = fs.readFileSync('src/services/clay/standing.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(standing, /YOU ARE RUNNING THIS ON YOUR OWN/);
  assert.match(standing, /If nothing needed doing, say that plainly rather than inventing work/);
});

test('the same standing job cannot be set up twice', () => {
  // Asked live on production, she set one weekly check up four times in a single turn, then had to
  // offer to undo her own work.
  const src = fs.readFileSync('src/services/clay/standing.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(src, /THE SAME JOB TWICE IS A BUG, not a choice/);
  assert.match(src, /lower\(btrim\(asked_for\)\) = lower\(btrim\(\$3\)\)/);
  assert.match(src, /business_id IS NOT DISTINCT FROM \$4/);
  assert.match(src, /You already have that on a schedule, so I have not set it up twice/);
});
