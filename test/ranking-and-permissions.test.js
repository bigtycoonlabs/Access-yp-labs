'use strict';
// THE RANKED LIST, AND WHO CAN SEE WHAT.
//
// Both driven against a real Postgres with two businesses, seven obligations, an owner and a
// bookkeeper before any of this was written.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const rank = fs.readFileSync('src/lib/ranking.js', 'utf8');
const perm = fs.readFileSync('src/lib/permissions.js', 'utf8');
const R = require('../src/lib/ranking');

test('the ranked list is SQL, and no model is called to produce it', () => {
  // Three reasons: it is arithmetic and arithmetic should not be probabilistic; it is read every
  // morning so it must be identical twice; and calling a model for what SQL already answers is how
  // competitors reach $30 a month per user of inference.
  assert.match(rank, /NO MODEL IS CALLED TO PRODUCE IT/);
  assert.ok(!/anthropic|openai|completion|generateText/i.test(rank), 'no model call in the ranker');
});

test('a known cost outranks an estimate of the same size', () => {
  // If two things both say $2,000 and one is an actual invoice, the invoice is the one to act on.
  assert.strictEqual(R.ESTIMATE_DISCOUNT, 0.8);
  assert.strictEqual(R.UNKNOWN_DISCOUNT, 0.4);
  assert.match(rank, /WHEN 'known' THEN 1\.0/);
});

test('overdue climbs, but it is capped', () => {
  // An ancient forgotten item must not permanently outrank a real deadline today. That is how a
  // ranked list becomes a list nobody trusts.
  assert.strictEqual(R.OVERDUE_MULTIPLIER_CAP, 3.0);
  // The SQL interpolates the named constant rather than repeating the number, so the cap cannot be
  // changed in one place and left stale in the other.
  assert.match(rank, /LEAST\(\$\{OVERDUE_MULTIPLIER_CAP\},/);
  assert.ok(!/LEAST\(3(\.0)?,/.test(rank), 'the cap is not hardcoded beside its own constant');
});

test('there is a horizon', () => {
  // Without one, a $400 filing due in eight months sits above a $200 one due Friday. Verified live:
  // a permit 120 days out did not appear in today's list and did appear nowhere near the top.
  assert.strictEqual(R.DEFAULT_HORIZON_DAYS, 45);
});

test('every row can say why it is where it is', () => {
  // A ranking nobody can explain is a ranking nobody should trust, and the whole argument for this
  // over a priority field is that the ordering is arithmetic rather than opinion.
  const line = R.explain({ cost_if_missed_cents: 240000, cost_basis: 'known',
    due_at: new Date(Date.now() - 19 * 86400000), overdue: true,
    consequence: 'Most jobs never get billed after three weeks' });
  assert.match(line, /Missing it costs \$2,400 and it was due 19 days ago/);
  assert.match(line, /Most jobs never get billed after three weeks/);
});

test('"roughly" carries the estimate, so it reads aloud cleanly', () => {
  // The first version appended ", estimated" as well and produced "costs roughly $1,800, estimated
  // and it was due 3 days ago", which stumbles. This line is read aloud every morning.
  const line = R.explain({ cost_if_missed_cents: 180000, cost_basis: 'estimated',
    due_at: new Date(Date.now() - 3 * 86400000), overdue: true });
  assert.match(line, /costs roughly \$1,800 and it was due/);
  assert.ok(!/, estimated and/.test(line));
});

test('not knowing the cost is said, not hidden', () => {
  const line = R.explain({ cost_if_missed_cents: null, cost_basis: null, due_at: null });
  assert.match(line, /I do not know what missing it costs yet/);
});

test('nothing due is a real answer', () => {
  // A list that always finds something urgent is a list people stop reading. The quiet days are what
  // make the loud ones worth reading.
  assert.strictEqual(R.summarise([]), 'Nothing is due. Nothing overdue either.');
});

test('the ranked list filters by permission AREA, not just by business', () => {
  // THE BUG THIS FILE EXISTS FOR. Found by running the list as a bookkeeper with money:view and
  // nothing else: she saw five items including the Florida annual report and the city licence. The
  // query filtered by which BUSINESSES she could reach and then showed her everything inside them.
  //
  // Same defect as a screen that hides a number while the assistant reads it out. After the fix she
  // sees one item — the Henderson invoice — and the owner still sees all six.
  assert.match(rank, /WHICH PERMISSION AREA EACH KIND OF OBLIGATION BELONGS TO/);
  assert.match(rank, /const VISIBLE_SQL/);
  assert.strictEqual(R.KIND_AREA.filing, 'compliance');
  assert.strictEqual(R.KIND_AREA.invoice_out, 'money');
  assert.strictEqual(R.KIND_AREA.promise, 'customers');
  // Both queries use it, not just the one that was tested.
  assert.strictEqual((rank.match(/\$\{VISIBLE_SQL\}/g) || []).length, 2);
  // The owner short-circuits — they own it, so they are not a row in permissions.
  assert.match(R.VISIBLE_SQL, /b\.owner_id = \$1\s*\n?\s*OR EXISTS/);
});

test('permissions fail closed', () => {
  // If the permission cannot be read, the answer is no. Verified live with an unknown user and an
  // unknown business: both false.
  assert.match(perm, /FAIL CLOSED\. If the permission cannot be read, the answer is no/);
  assert.match(perm, /console\.error\('permissions: could not read business'[\s\S]{0,60}return null;/);
});

test('a refusal names what exists rather than pretending it does not', () => {
  const P = require('../src/lib/permissions');
  const line = P.refusalLine({ reason: 'insufficient' }, 'compliance', 'Night Rounds', 'Vission');
  assert.match(line, /outside what you can see on Night Rounds/);
  assert.match(line, /you do not have access to the filings and licences/);
  assert.match(line, /Vission can give you access/);
  // Telling somebody a thing does not exist is a lie that makes them distrust everything else.
  assert.match(perm, /Telling them it does not exist is a lie/);
});

test('export is never implied, and always leaves a record', () => {
  const P = require('../src/lib/permissions');
  assert.ok(P.AREAS.includes('export'));
  assert.match(perm, /EXPORT IS NEVER IMPLIED/);
  assert.match(perm, /async function logExport/);
  // After the rows are produced, never before — a logged export that failed is a worse record.
  assert.match(perm, /Called after the rows are produced, never before/);
});
