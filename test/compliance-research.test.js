'use strict';
// COMPLIANCE RESEARCH. Live, cited, never from memory (owner, 16 Sept 2026).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const C = require('../src/services/clay/complianceResearch');

const src = fs.readFileSync('src/services/clay/complianceResearch.js', 'utf8');

test('the picture always covers the same eight areas', () => {
  assert.deepStrictEqual(C.AREA_NAMES, ['formation', 'state_tax', 'sales_tax', 'employer',
    'local_license', 'trade_license', 'permits', 'federal']);
  const sql = fs.readFileSync('docs/migrations/070_compliance_research.sql', 'utf8');
  for (const a of C.AREA_NAMES) assert.match(sql, new RegExp("'" + a + "'"));
  const W = require('../src/services/clay/workspace');
  assert.deepStrictEqual(W.TOOLS.research_compliance.enums.area, ['all', ...C.AREA_NAMES]);
});

test('government pages are told apart from everything else', () => {
  assert.strictEqual(C.isOfficial('https://www.sos.state.oh.us/x'), true);
  assert.strictEqual(C.isOfficial('https://tax.ohio.gov/business'), true);
  assert.strictEqual(C.isOfficial('https://www.irs.gov/businesses'), true);
  assert.strictEqual(C.isOfficial('https://www.legalzoom.com/ohio'), false);
  assert.strictEqual(C.isOfficial('https://gov.example.com'), false);
  assert.strictEqual(C.isOfficial('not a url'), false);
});

test('an answer without a source is never shown or kept', () => {
  assert.match(src, /if \(!answer \|\| !sources\.length\)/);
  assert.match(src, /so I am not answering this one/);
  const sql = fs.readFileSync('docs/migrations/070_compliance_research.sql', 'utf8');
  assert.match(sql, /jsonb_array_length\(sources\) > 0/);
  assert.match(src, /I will not answer compliance from memory/);
});

test('research uses the top model at high reasoning, told to prefer official sources', () => {
  assert.match(src, /effort: 'high'/);
  assert.match(C.INSTRUCTION, /Prefer official sources/);
  assert.match(C.INSTRUCTION, /Never state a figure or date you did not find on a page/);
  assert.doesNotMatch(src, /model: ['"]gpt-5\.6-(terra|luna)|nano/);
});

test('a change to the business means searching again', () => {
  const a = C.profileOf({ entity_type: 'llc', formation_state: 'OH', operating_states: ['OH'], localities: [], trade: 'landscaping', headcount: 0 });
  const b = C.profileOf({ entity_type: 'llc', formation_state: 'OH', operating_states: ['OH'], localities: [], trade: 'landscaping', headcount: 2 });
  const c = C.profileOf({ entity_type: 'llc', formation_state: 'OH', operating_states: ['OH', 'KY'], localities: [], trade: 'landscaping', headcount: 0 });
  assert.notStrictEqual(C.profileKey(a), C.profileKey(b));
  assert.notStrictEqual(C.profileKey(a), C.profileKey(c));
  assert.strictEqual(C.profileKey(a), C.profileKey(C.profileOf({ entity_type: 'llc', formation_state: 'OH', operating_states: ['OH'], localities: [], trade: 'landscaping', headcount: 0 })));
});

test('what is unknown about the business is named, not guessed', () => {
  const p = C.profileOf({ entity_type: null, formation_state: 'TX', operating_states: [], localities: [], trade: null, headcount: null });
  const m = C.missingFacts(p);
  assert.strictEqual(m.length, 3);
  assert.match(C.describe('Acme', p), /number of employees unknown/);
});

test('Penny is told compliance never comes from memory', () => {
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8');
  assert.match(penny, /Legal and tax requirements never come from your memory/);
  assert.match(penny, /'research_compliance'/);
});

test('research runs in the background and a lost search is never an answer', () => {
  const prov = fs.readFileSync('src/services/clay/provider.js', 'utf8');
  const deep = prov.slice(prov.indexOf('async function deepSearch'), prov.indexOf('async function webSearch'));
  assert.match(deep, /background: true/);
  assert.match(deep, /responses\.retrieve/);
  assert.match(deep, /responses\.cancel/);
  assert.match(deep, /if \(resp\.status !== 'completed'\)/);
  // Usage is recorded whether or not the search finished.
  assert.ok((deep.match(/recordText\(/g) || []).length >= 2);
  assert.match(src, /setImmediate\(\(\) => \{ runJob/);
  assert.match(fs.readFileSync('src/server.js', 'utf8'), /complianceResearch'\)\.resume\(\)/);
});

test('a run that finished says how it ended, and there is always something to research', () => {
  const sql = fs.readFileSync('docs/migrations/071_compliance_runs.sql', 'utf8');
  assert.match(sql, /finished_says_how CHECK \(status NOT IN \('done', 'failed'\) OR \(finished_at IS NOT NULL AND says IS NOT NULL\)\)/);
  assert.match(sql, /something_to_research CHECK \(question IS NOT NULL OR cardinality\(areas\) > 0\)/);
});

test('fresh research is answered at once, and a second request does not start a second search', () => {
  assert.match(src, /Everything already fresh: answer now, no search, no charge/);
  assert.match(src, /I am already researching/);
  const W = require('../src/services/clay/workspace');
  assert.deepStrictEqual(W.TOOLS.research_compliance.enums.action, ['start', 'status']);
  assert.ok(W.TOOLS.research_compliance.summary.length < 1024);
});

test('a search that comes back empty is tried once more, and why it failed is kept', () => {
  assert.match(src, /let found = await ask\(\);[\s\S]*found = await ask\(\);/);
  assert.match(src, /What went wrong: /);
});

test('the overview is one short line per area, so the whole picture fits in one reply', () => {
  assert.strictEqual(C.shortOf('**In short:** Ohio has no annual report. It does have the CAT.\n\nMore detail.'),
    'Ohio has no annual report. It does have the CAT.');
  const long = 'Sentence one is here. ' + 'x'.repeat(400);
  assert.ok(C.shortOf(long).length <= 321);
  assert.match(C.INSTRUCTION, /Begin with one line that starts "In short:"/);
  const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
  assert.match(agent, /this result was cut off at/);
});

test('sources are stored without the search tool\'s tracking tags', () => {
  assert.strictEqual(C.cleanUrl('https://comptroller.texas.gov/taxes/sales/?utm_source=openai'), 'https://comptroller.texas.gov/taxes/sales/');
  assert.strictEqual(C.cleanUrl('https://x.gov/a?id=4&utm_medium=y'), 'https://x.gov/a?id=4');
  assert.strictEqual(C.cleanUrl('not a url'), 'not a url');
});

test('the research\'s own summary line is never cut short', () => {
  const tx = 'In short: Ordinary residential house cleaning does not require a Texas state occupational or trade license, and Texas does not have a general state business license. But the LLC likely needs a Texas sales and use tax permit for maid and house-cleaning charges, and it must keep up with LLC and franchise-tax filings; local permits depend on the city.\n\nDetail.';
  assert.match(C.shortOf(tx), /sales and use tax permit/);
  assert.match(C.shortOf(tx), /depend on the city\.$/);
});

test('asking about an area nobody researched shows what was found, not nothing', () => {
  // The live walk: a single question was answered and filed as a question, and asking about "permits"
  // reported that nothing had been found.
  const ws = fs.readFileSync('src/services/clay/workspace.js', 'utf8');
  assert.match(ws, /not_researched_as_its_own_area: true/);
  assert.match(ws, /has not been researched as its own area\. Here is what has been found/);
  assert.match(ws, /if \(!st\.research\.length\) return empty/);
});
