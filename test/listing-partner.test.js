'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/`\s*\+\s*`/g, '').replace(/\s+/g, ' ');
const page = flat(fs.readFileSync('public/listing.html', 'utf8'));

test('the buyer sees the full scope, and the limits, before paying', () => {
  assert.match(page, /will stay on as your launch partner/i);
  assert.match(page, /do not keep any ownership/i, 'states there is no stake');
  assert.match(page, /end the arrangement at any time/i);
  assert.match(page, /takes no extra fee/i, 'the platform earns nothing extra from it');
});
