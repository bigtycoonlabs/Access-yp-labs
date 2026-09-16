'use strict';
// DOCUMENTS, AND THE ONES THAT ARE NOT THERE.
//
// Every tool in this space stores files. The useful half is knowing what SHOULD be on file and is
// not — a business discovers the missing certificate of insurance on the day a client asks for it,
// not the day it lapsed.
//
// Driven against a real Postgres with an LLC, a contractor, a partner and four documents.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sql = fs.readFileSync('docs/migrations/060_documents.sql', 'utf8');
const src = fs.readFileSync('src/services/clay/documents.js', 'utf8');
const ws = fs.readFileSync('src/services/clay/workspace.js', 'utf8');
const spine = require('../src/services/clay/spine');
const { WORKSPACE_TOOLS } = require('../src/services/clay/penny');
const D = require('../src/services/clay/documents');

test('it is a record of a document, not the file', () => {
  // Refusing to record anything until a PDF is uploaded is how the ledger stays empty and the answer
  // stays wrong. A W-9 in somebody's kitchen filing cabinet still counts as known about.
  assert.match(sql, /it is not binary storage/i);
  assert.match(sql, /location_kind text NOT NULL DEFAULT 'note'/);
  assert.match(sql, /'note','link','upload','elsewhere'/);
});

test('a document about a person must say which person', () => {
  // Driven live: a W-9 with no relationship was refused by the database.
  assert.match(sql, /CONSTRAINT person_doc_has_person/);
  assert.match(sql, /kind NOT IN \('w9','w8ben','coi'\) OR relationship_id IS NOT NULL/);
});

test('an expiry before its issue date is refused', () => {
  // A typo in a date here means a wrong warning, which is worse than no warning.
  assert.match(sql, /CONSTRAINT expiry_after_issue/);
});

test('expectations come from the record, not a generic checklist', () => {
  // A "12 documents every business needs" list is wrong for almost everybody and gets ignored within
  // a week. Driven live: an LLC with a contractor and a partner produced formation documents, an EIN
  // letter, an operating agreement and a W-9 for Ellis Vance — and nothing else.
  assert.match(src, /EXPECTATIONS COME FROM THE RECORD, NOT FROM A CHECKLIST/);
  assert.ok(D.BUSINESS_DOCS.llc.some((d) => d.kind === 'ein'));
  assert.ok(D.PERSON_DOCS.contractor.some((d) => d.kind === 'w9'));
  assert.ok(!D.BUSINESS_DOCS.sole_proprietor, 'a sole proprietor is not asked for formation papers');
});

test('a W-8BEN satisfies the same need as a W-9', () => {
  // Somebody working outside the US needs the other form. Asking for a W-9 they cannot provide is
  // how an assistant teaches people its requests are noise.
  assert.match(src, /A W-8BEN satisfies the same need as a W-9/);
});

test('expired leads, because it is worse than missing', () => {
  // Nobody believes they are covered by a certificate they never collected. Everybody believes they
  // are covered by one that quietly expired in March.
  assert.match(src, /AN EXPIRED DOCUMENT IS WORSE THAN A MISSING ONE/);
  const s = D.summarise({ expired: [{ document: { title: 'General liability' }, days_ago: 199 }],
    missing: [{ label: 'EIN letter' }], expiring: [], onFile: 4 });
  assert.match(s, /^One document has expired — General liability, 199 days ago/);
});

test('nothing missing is said as a fact, not as silence', () => {
  const s = D.summarise({ expired: [], missing: [], expiring: [], onFile: 3 });
  assert.match(s, /Nothing missing and nothing expiring\. 3 documents on file\./);
  const none = D.summarise({ expired: [], missing: [], expiring: [], onFile: 0 });
  assert.match(none, /until you tell me more about the business/);
});

test('a failed read is never an empty shelf', () => {
  // The worst possible wrong answer here: "nothing missing" is exactly the reassurance somebody
  // would act on. Driven live with an unknown business id: ok false, not an empty list.
  assert.match(src, /A failed read is not an empty shelf/);
  assert.match(ws, /an empty shelf and a failed look are different things/);
  return D.missingFor('00000000-0000-0000-0000-000000000000')
    .then((r) => assert.strictEqual(r.ok, false));
});

test('Penny can reach it, under the documents area', () => {
  // A bookkeeper with documents:view should see that a W-9 is missing without being shown filings.
  assert.ok(spine.TOOLS.whats_missing, 'not registered with the planner');
  assert.ok(WORKSPACE_TOOLS.includes('whats_missing'), 'not in her tool set');
  assert.match(ws, /P\.can\(viewer\.id, params\.business_id, 'documents', 'view'\)/);
});

test('it is registered and rebuilds from empty', () => {
  // Verified: 82 tables from an empty database.
  assert.ok(fs.readFileSync('docs/migrations/ORDER.txt', 'utf8').includes('060_documents.sql'));
});
