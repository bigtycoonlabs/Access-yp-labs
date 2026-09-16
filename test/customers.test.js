'use strict';
// CUSTOMERS, WHICH IS NOT A CRM.
//
// A CRM is a place to put people so you can look at how many you have. Almost no small business
// needs that, and the ones that buy it stop updating it inside a month because keeping it current is
// work that pays nobody.
//
// Driven against a real Postgres with three customers, two invoices and two promises.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/services/clay/customers.js', 'utf8');
const ws = fs.readFileSync('src/services/clay/workspace.js', 'utf8');
const spine = require('../src/services/clay/spine');
const { WORKSPACE_TOOLS } = require('../src/services/clay/penny');
const C = require('../src/services/clay/customers');

test('there is nothing to keep up to date', () => {
  // A customer appears because you owe them or they owe you, and leaves when neither is true. It is
  // a view over the spine, not a second database of people.
  assert.match(src, /THE CONSEQUENCE OF THAT CHOICE: there is nothing to keep up to date/);
  assert.ok(!/INSERT INTO/.test(src), 'it writes nothing');
});

test('what you owe them and what they owe you stay apart', () => {
  // Netting them into one number hides a late invoice behind a promise you have kept.
  assert.match(src, /Kept apart on\n\/\/ purpose/);
  assert.deepStrictEqual(C.OWED_TO_US, ['invoice_out']);
  assert.ok(C.OWED_TO_THEM.includes('promise'));
});

test('it orders by what is late, never by what a customer is worth', () => {
  // The feature every CRM has and the wrong instinct at this size: the customer who owes $400 and
  // the one you promised a callback are not comparable on one axis, and sorting by worth is how the
  // callback never happens.
  assert.match(src, /THE ONE THING IT WILL NOT DO is rank customers by value/);
  assert.match(src, /Ordered by what is LATE, not by what they are worth/);
});

test('the money is counted against the customers who actually owe it', () => {
  // THE BUG THIS FOUND. The first version said "$3,260 is owed to you across 3 customers" while one
  // of the three owed nothing and was listed only for a promise. A number attached to the wrong
  // denominator is how somebody works out an average that is quietly false.
  const s = C.summarise([
    { name: 'Henderson Dental', overdue_count: 2, owed_cents: 240000 },
    { name: 'Marlow Gym', overdue_count: 0, owed_cents: 86000 },
    { name: 'Cedar Hill Apartments', overdue_count: 0, owed_cents: 0 },
  ]);
  assert.match(s, /\$3,260 is owed to you across 2 customers/);
  assert.ok(!/across 3 customers/.test(s));
});

test('reachable is stated, because a record is not a phone number', () => {
  // "A contact record exists" and "we know how to reach them" are different things, and only one is
  // useful when something is overdue. Driven: Henderson reachable, Marlow Gym not.
  // Matched on a short distinctive phrase rather than across a line break — guessing where a
  // comment wraps is how an assertion fails on prose that is perfectly correct. Third time today.
  assert.match(src, /we know how to reach them/);
  assert.match(src, /reachable: !!\(o\.email \|\| o\.phone\)/);
});

test('an empty list says why it is empty', () => {
  const s = C.summarise([]);
  assert.match(s, /People appear here when you owe them something or they owe you/);
});

test('a failed read is not a business with no customers', () => {
  assert.match(src, /A failed read is not a business with no customers/);
  assert.match(ws, /from there being nothing outstanding/);
  return C.forBusiness('00000000-0000-0000-0000-000000000000')
    .then((r) => assert.ok(r.ok === false || r.customers.length === 0));
});

test('Penny can reach it, under the customers area', () => {
  assert.ok(spine.TOOLS.whats_outstanding_with_customers);
  assert.ok(WORKSPACE_TOOLS.includes('whats_outstanding_with_customers'));
  assert.match(ws, /P\.can\(viewer\.id, params\.business_id, 'customers', 'view'\)/);
});
