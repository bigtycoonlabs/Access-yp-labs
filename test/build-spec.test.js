'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const bs = require('../src/services/clay/buildSpec');

test('the spec instructs against inventing requirements', () => {
  assert.match(bs.PROMPT, /put it in open_questions instead of inventing/i);
  assert.match(bs.PROMPT, /becomes real code and real cost/i);
});

test('the rendered document says plainly we do not build or host it', () => {
  const doc = bs.renderSpec('Test App', { summary: 'x', screens: [], data_model: [], flows: [],
    rules: [], services: [], done_when: [], open_questions: [], builder_prompt: 'p' });
  assert.match(doc, /does not build or host applications/i);
  assert.match(doc, /yours to take anywhere/i);
});

test('unsettled decisions are surfaced as unsettled, not buried', () => {
  const doc = bs.renderSpec('Test App', { summary: 'x', screens: [], data_model: [], flows: [],
    rules: [], services: [], done_when: [], builder_prompt: 'p',
    open_questions: ['Who approves a refund?'] });
  assert.match(doc, /STILL TO DECIDE/);
  assert.match(doc, /NOT settled, and nobody should build as if they were/i);
  assert.match(doc, /Who approves a refund\?/);
});

test('services carry an honest needed-or-optional marker and a cost', () => {
  const doc = bs.renderSpec('T', { summary: '', screens: [], data_model: [], flows: [], rules: [],
    services: [{ name: 'Stripe', what_for: 'payments', needed: true, rough_cost: '2.9% + 30c' }],
    done_when: [], open_questions: [], builder_prompt: '' });
  assert.match(doc, /Stripe — payments \(needed; 2\.9% \+ 30c\)/);
});
