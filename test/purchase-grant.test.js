'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const orders = fs.readFileSync(require.resolve('../src/routes/orders.js'), 'utf8');

test('buying a project makes it PERMANENTLY the buyer\'s, not a 30-day grant', () => {
  // A buyer losing export access a month after paying would be a quiet, indefensible failure.
  assert.match(orders, /UPDATE concepts SET free_forever = true WHERE id = \$1/);
  assert.ok(!/VALUES \(\$1,'maker','active',\$2,0, now\(\) \+ interval '30 days'/.test(orders),
    'the expiring maker grant is gone');
  assert.match(flat(orders), /they bought it, so it is theirs/i);
});

test('the seller\'s own retired per-project subscription is still cancelled on sale', () => {
  // Legacy subscribers must stop being billed for something they no longer own.
  assert.match(orders, /plan='maker' AND status='active'/);
});
