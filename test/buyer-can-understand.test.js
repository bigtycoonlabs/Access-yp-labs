'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/)?\s*/g, ' ').replace(/\s+/g, ' ');
const pres = fs.readFileSync(require.resolve('../src/services/clay/seedPresentation.js'), 'utf8');

test('every seeded project gets a brief built with it', () => {
  assert.match(pres, /async function buildBrief\(concept\)/);
  assert.match(pres, /ensureBriefFor/);
  assert.match(pres, /result\.brief = await buildBrief\(concept\)/);
  assert.match(flat(pres), /the four lines a buyer actually reads/i);
});
