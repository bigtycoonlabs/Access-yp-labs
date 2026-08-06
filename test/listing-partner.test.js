'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/`\s*\+\s*`/g, '').replace(/\s+/g, ' ');
const listings = flat(fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8'));
const orders = flat(fs.readFileSync(require.resolve('../src/routes/orders.js'), 'utf8'));
const page = flat(fs.readFileSync('public/listing.html', 'utf8'));

test('a launch partner offer is SERVICES ONLY — equity is not among the options', () => {
  const areas = listings.slice(listings.indexOf('PARTNER_AREAS = ['), listings.indexOf('PARTNER_AREAS = [') + 300);
  assert.ok(!/equity|ownership|stake|shares?\b/i.test(areas), 'no ownership option is offered');
  assert.match(areas, /marketing|development|coaching/);
});

test('a vague offer is refused: scope and an amount are both required', () => {
  assert.match(listings, /at least 30 characters/, 'the scope must actually say something');
  // Note: the apostrophe is a \u2019 escape in the source, so match around it rather than through it.
  assert.match(listings, /be around[^]{0,25}is not enough/i, 'and the error explains why');
  assert.match(listings, /a number of sessions, or a number of weeks/i, 'the help has a defined end');
});

test('the buyer can end it unconditionally, and never loses the project by doing so', () => {
  const block = orders.slice(orders.indexOf("partner/remove"), orders.indexOf("partner/restore"));
  assert.match(block, /buyer_id = \$2/, 'only the buyer can end it');
  assert.match(block, /still entirely yours/i, 'ownership is explicitly unaffected');
  assert.match(block, /nothing was charged or refunded/i, 'money is not silently moved');
  // Ending the arrangement must not touch the order's status or the transfer itself.
  assert.ok(!/SET[^;]*status\s*=/.test(block), 'removal never rewrites the order status');
});

test('the buyer sees the full scope, and the limits, before paying', () => {
  assert.match(page, /will stay on as your launch partner/i);
  assert.match(page, /do not keep any ownership/i, 'states there is no stake');
  assert.match(page, /end the arrangement at any time/i);
  assert.match(page, /takes no extra fee/i, 'the platform earns nothing extra from it');
});
