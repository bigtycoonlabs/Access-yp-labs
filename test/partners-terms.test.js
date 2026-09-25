'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
// Source is read as text, but these strings are built by concatenation across lines. Flatten the
// joins and whitespace first, so an assertion tests the SENTENCE a person receives rather than how
// the code happens to be wrapped — otherwise reformatting a line silently breaks the guarantee test.
const flatten = (s) => s.replace(/`\s*\+\s*`/g, '').replace(/\s+/g, ' ');
const partners = flatten(fs.readFileSync(require.resolve('../src/routes/partners.js'), 'utf8'));
const agent = flatten(fs.readFileSync(require.resolve('../src/services/clay/agent.js'), 'utf8'));

test('the introduction email states the platform takes no fee and no cut', () => {
  assert.match(partners, /NO fee and NO cut/, 'said in the message people actually read');
  assert.match(partners, /not a party to your arrangement/i);
});

test('equity is explicitly off-platform in the introduction, with a nudge to get real advice', () => {
  assert.match(partners, /equity is not something this platform sets up, holds, or records/i);
  assert.match(partners, /off-platform and entirely your own affair/i);
  assert.match(partners, /get your own legal advice/i);
});

test('Clay will not structure an equity deal and knows the platform earns nothing here', () => {
  assert.match(agent, /Do NOT help someone structure, negotiate, price, or word an ownership stake/i);
  assert.match(agent, /charges NO fee and takes NO cut/i);
  assert.match(agent, /You are not a lawyer/i, 'and must not pretend otherwise on an equity split');
});
