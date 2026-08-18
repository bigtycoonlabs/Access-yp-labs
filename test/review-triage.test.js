'use strict';
// WHY A LISTING IS SITTING IN THE REVIEW QUEUE.
//
// 33 in review against 13 live. Counts alone cannot say whether that is staffing, materials or
// policy, and today a listing in review says nothing about itself: staff rediscover the same problem
// every time they open the queue, and the creator waits in silence with nothing to fix.
//
// This is a FIRST READ, never a decision. A human still approves or rejects everything and staff can
// override the status. The point is that the queue arrives split into "waiting on us" and "waiting
// on them" — the one distinction that says whether 33 is a hiring decision or a materials problem.

const { test } = require('node:test');
const assert = require('node:assert');
const { triage, waitingOnStaff, STATUSES } = require('../src/lib/reviewTriage');

const ok = { risk_summary: 'No licence identified for this in most US states, but food handling rules vary by county and would need checking before launch.' };
const plan = ['business_plan'];

test('a complete listing is ready for a person', () => {
  const r = triage({ concept: ok, assetKinds: plan });
  assert.strictEqual(r.status, 'ready_for_decision');
  assert.ok(waitingOnStaff(r.status));
});

test('a business somebody already runs is caught, and told why kindly', () => {
  const r = triage({ concept: { ...ok, is_operating: true }, assetKinds: plan });
  assert.strictEqual(r.status, 'possible_live_business');
  // Not an accusation. Self-declaration is porous and a false one here is insulting.
  assert.match(r.note, /everything else on it still works/);
});

test('an outcome promise is caught and quoted back', () => {
  // These are claims the platform cannot stand behind, and "turnkey" specifically is the vocabulary
  // of business-opportunity enforcement — the FTC has sued repeatedly over turnkey income promises.
  for (const claim of ['This guarantees $4,000/month', 'A turnkey business on autopilot',
    'Risk-free passive income', 'You will earn within 90 days']) {
    const r = triage({ concept: { ...ok, risk_summary: ok.risk_summary, title: claim }, assetKinds: plan });
    assert.strictEqual(r.status, 'possible_misrepresentation', claim);
    assert.match(r.note, /promises a buyer an outcome nobody can promise/);
  }
});

test('a thin risk note is caught', () => {
  const r = triage({ concept: { risk_summary: 'Some risk.' }, assetKinds: plan });
  assert.strictEqual(r.status, 'needs_risk_disclosure');
});

test('a missing business plan is named specifically', () => {
  const r = triage({ concept: ok, assetKinds: [] });
  assert.strictEqual(r.status, 'missing_baseline');
  // Names the thing and the fix. "Missing baseline" alone would move the silence, not end it.
  assert.match(r.note, /no business plan/);
  assert.match(r.note, /Ask Clay to build one/);
});

test('it does not fire on ordinary honest wording', () => {
  // The expensive failure is a FALSE positive: sending a creator off to fix something that was never
  // wrong is worse than saying nothing, which is why this is deliberately conservative.
  const fine = [
    'A cleaning round with room to grow in Cleveland',
    'Research suggests demand is strongest among night shift workers',
    'The plan estimates costs of around $2,000 to start',
    'Customers pay monthly for a recurring visit',
    'This could work well for someone who already drives',
  ];
  for (const title of fine) {
    const r = triage({ concept: { ...ok, title }, assetKinds: plan });
    assert.strictEqual(r.status, 'ready_for_decision', title);
  }
});

test('the note is written for the creator, not for staff', () => {
  // A queue that tells staff what is wrong and leaves the creator guessing has only moved the
  // silence. Every note addresses the person who has to act.
  for (const c of [{ concept: ok, assetKinds: [] }, { concept: { risk_summary: 'x' }, assetKinds: plan },
    { concept: { ...ok, is_operating: true }, assetKinds: plan }]) {
    const r = triage(c);
    assert.ok(r.note.length > 60, 'a note must actually explain: ' + r.note);
    assert.ok(!/staff|moderator|queue/i.test(r.note), 'not addressed to staff: ' + r.note);
  }
});

test('every status it can return is one the database accepts', () => {
  // The check constraint and this list must not drift apart. If they do, a triage result becomes an
  // exception on submission instead of a note.
  const sql = require('fs').readFileSync('docs/migrations/057_teams_seats_contributions.sql', 'utf8');
  for (const s of STATUSES) assert.ok(sql.includes("'" + s + "'"), 'not in the constraint: ' + s);
});

test('triage never blocks a submission', () => {
  const routes = require('fs').readFileSync('src/routes/listings.js', 'utf8');
  // The listing IS submitted. An untriaged one arrives without a note, which is exactly where the
  // platform is today — so a failure here costs nothing rather than costing somebody their listing.
  assert.match(routes, /try \{[\s\S]*?const t = triage\(\{[\s\S]*?\} catch \(e\) \{/);
  assert.match(routes, /console\.error\('triage failed for listing'/);
});
