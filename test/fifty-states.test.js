'use strict';
// EVERY STATE, WITH ITS CONFIDENCE ATTACHED.
//
// Built after I invented an Ohio filing, on the principle that fixing one state is worthless if the
// other forty-nine are guesses. So every entry declares how well it is known, and the confidence is
// what the person is told.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/services/clay/states.js', 'utf8');
const S = require('../src/services/clay/states');
const C = require('../src/services/clay/compliance');

const US = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA',
  'WA', 'WV', 'WI', 'WY'];

test('all fifty states and DC are present', () => {
  for (const s of US) assert.ok(S.STATES[s], 'missing state: ' + s);
  assert.ok(S.STATES.DC, 'missing DC');
  assert.strictEqual(S.ALL_STATES.length, 51);
});

test('every entry declares its confidence', () => {
  // The rule this file exists for. An entry that cannot say how well it is known must not ship.
  for (const [code, st] of Object.entries(S.STATES)) {
    assert.ok(['verified', 'unconfirmed'].includes(st.confidence),
      code + ' has no usable confidence');
  }
  assert.match(src, /EVERY ENTRY DECLARES ITS OWN CONFIDENCE/);
});

test('only a verified entry states a confident figure', () => {
  // Everything else ranks on a typical penalty and says that is what it is. A wrong fee is worse
  // than an admitted unknown, and silence is worse than both.
  for (const code of S.ALL_STATES) {
    if (S.STATES[code].report === 'none') continue;
    const got = [].concat(S.stateRule(code, { formed_on: '2020-01-15' }));
    for (const r of got) {
      if (r.confidence === 'verified') assert.strictEqual(r.cost_basis, 'known', code);
      else {
        assert.strictEqual(r.cost_basis, 'estimated', code);
        assert.match(r.cost_note, /have not confirmed/, code + ' should admit the gap');
      }
    }
  }
});

test('the five no-report states produce a correction, not an obligation', () => {
  // People pay for filings they never needed. Telling them they do not owe one is the answer.
  for (const code of ['AZ', 'MO', 'NM', 'OH', 'SC']) {
    const r = S.stateRule(code, {});
    assert.strictEqual(r.kind, 'note', code + ' should be a note');
    assert.match(r.says, /does not require/i);
  }
});

test('an anniversary state with no formation date gets no invented deadline', () => {
  // A made-up date is the exact failure this engine was rebuilt to prevent.
  const noDate = S.stateRule('WY', {});
  assert.strictEqual(noDate.due, null);
  assert.match(noDate.due_note, /I do not have that date/);
  const withDate = S.stateRule('WY', { formed_on: '2021-03-11' });
  assert.deepStrictEqual(withDate.due, { month: 3, day: 11 });
});

test('California is two obligations, not one', () => {
  // The first version merged them and put the franchise tax's date on the Statement of Information —
  // telling a California owner their $20 filing was due 15 April and saying nothing about the $800
  // that actually is.
  assert.match(src, /TWO OBLIGATIONS, NOT ONE/);
  const r = C.rulesFor({ entity_type: 'llc', formation_state: 'CA', operating_states: ['CA'],
    formed_on: '2022-08-03' });
  const soi = r.obligations.find((o) => /biennial report/.test(o.title));
  const tax = r.obligations.find((o) => /franchise tax/.test(o.title));
  assert.ok(soi && tax, 'both should appear');
  // Different dates, different agencies — which is why the tax is the one that gets missed.
  assert.strictEqual(soi.due_at.toISOString().slice(5, 10), '08-03');
  assert.strictEqual(tax.due_at.toISOString().slice(5, 10), '04-15');
  assert.match(tax.counterparty, /Franchise Tax Board/);
  assert.strictEqual(tax.cost_if_missed_cents, 80000);
});

test('Florida stays exact', () => {
  const r = C.rulesFor({ entity_type: 'llc', formation_state: 'FL', operating_states: ['FL'] });
  const ar = r.obligations.find((o) => /FL annual report/.test(o.title));
  assert.strictEqual(ar.cost_if_missed_cents, 40000);
  assert.strictEqual(ar.cost_basis, 'known');
  assert.match(ar.consequence, /third Friday in September/);
});

test('every state the business touches, not just where it formed', () => {
  // An LLC formed in Delaware and operating in California owes in both, and that is precisely the
  // person who loses an entity to administrative dissolution.
  const r = C.rulesFor({ entity_type: 'llc', formation_state: 'DE', operating_states: ['CA', 'TX'],
    formed_on: '2020-02-02' });
  const titles = r.obligations.map((o) => o.title).join(' | ');
  assert.match(titles, /DE annual tax/);
  assert.match(titles, /CA/);
  assert.match(titles, /TX franchise tax report/);
});

test('conflicting sources are declared, not resolved by guessing', () => {
  // Delaware: sources disagree on whether the annual tax is $300 or $400. Kansas changed in
  // February 2026 and sources disagree on the new figures. Saying so is the honest output.
  assert.match(S.STATES.DE.note, /Sources disagree/);
  assert.strictEqual(S.STATES.DE.confidence, 'unconfirmed');
  assert.match(S.STATES.KS.note, /sources disagree/i);
});

test('the coverage note says which parts are solid', () => {
  // Every state is in the table now. Only some are verified down to the fee, and a person who
  // believes the list is complete is worse off than one who knows which parts are.
  const n = C.coverageNote({ formation_state: 'GA', operating_states: ['GA'] });
  assert.match(n, /deadline but not a confirmed fee/);
  assert.match(n, /city and county licences sit on top/);
});

test('administrative dissolution is the stated stake where nothing else is known', () => {
  // It is what makes an unknown fee still worth ranking: the entity stops existing and the liability
  // protection goes with it.
  assert.match(S.DEFAULT_CONSEQUENCE, /administrative dissolution/);
  assert.match(S.DEFAULT_CONSEQUENCE, /liability protection the company exists for/);
});

test('fees are dated, because they age badly', () => {
  // Kansas moved February 2026, Louisiana moves October 2026, Pennsylvania's report is new since
  // 2025 with enforcement from 2027, South Dakota's dates change in 2027, Alabama dropped its
  // report in 2024.
  assert.match(S.CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(src, /FEES AGE BADLY/);
  assert.match(S.STATES.PA.note, /new since 2025/);
});
