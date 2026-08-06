'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../src/routes/partners.js'), 'utf8');

test('a creator controls how much of the project a browser sees', () => {
  assert.match(src, /visibility = 'full' THEN c\.brief ELSE NULL/, 'the brief is withheld on summary');
  assert.match(src, /visibility = 'full' THEN pr\.arrangement ELSE NULL/, 'terms are withheld on summary');
  assert.match(src, /visibility IS NOT NULL|req\.body\.visibility === 'full' \? 'full' : 'summary'/,
    'visibility defaults to the private option, never the exposing one');
});

test('offering to help requires a dreamer tag first', () => {
  assert.match(src, /need_dreamer_tag/, 'the client is told exactly what is missing');
  assert.match(src, /dreamer tag/i);
  // The gate must sit BEFORE the interest row is written, or someone lands on the board nameless.
  const gateAt = src.indexOf('need_dreamer_tag');
  const insertAt = src.indexOf('INSERT INTO partner_interest');
  assert.ok(gateAt > -1 && insertAt > -1 && gateAt < insertAt, 'the tag is checked before the offer is recorded');
});

test('Clay only suggests opportunities to people who opted in', () => {
  assert.match(src, /open_to_partnering/, 'consent is stored');
  assert.match(src, /Clay will not suggest/i, 'turning it off is stated plainly');
  // Turning it ON also requires a tag, so a suggestion never leads somewhere the person can't act.
  const onBlock = src.slice(src.indexOf("if (on) {"), src.indexOf("UPDATE users SET open_to_partnering"));
  assert.match(onBlock, /need_dreamer_tag/);
});
