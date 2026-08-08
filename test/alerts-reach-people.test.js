'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const notify = fs.readFileSync(require.resolve('../src/services/clay/staffNotify.js'), 'utf8');

test('an operational alert is never blocked by the chatter cap', () => {
  // The cap exists so Clay's own observations cannot flood an inbox, and for that it is right. It
  // was applied to EVERYTHING, so six chatty notes in a morning would swallow an alert saying a
  // seller is still being charged for a project they sold.
  assert.match(notify, /const ALWAYS_DELIVER = new Set\(/);
  assert.match(notify, /const urgent = ALWAYS_DELIVER\.has\(kind\)/);
  assert.match(notify, /if \(!urgent\) \{/);
  assert.match(flat(notify), /OPERATIONAL ALERTS ARE NOT SUBJECT TO THE DAILY CAP/i);
});

test('every alert raised on a money or delivery failure is in that set', () => {
  // If a caller raises a kind that is not listed, it silently becomes suppressible again.
  ['seller_billing_not_stopped', 'webhook_not_recorded', 'webhook_dedupe_unavailable',
   'auction_email_failed', 'watch_delivery_failed', 'seed_failed'].forEach((kind) => {
    assert.ok(notify.includes(`'${kind}'`), kind + ' must always be delivered');
  });

  // And the code actually raises them under those exact names.
  const raisers = {
    'seller_billing_not_stopped': '../src/routes/orders.js',
    'webhook_not_recorded': '../src/routes/webhooks.js',
    'webhook_dedupe_unavailable': '../src/routes/webhooks.js',
    'auction_email_failed': '../src/services/clay/auctions.js',
    'watch_delivery_failed': '../src/services/clay/watchActivity.js',
  };
  Object.entries(raisers).forEach(([kind, file]) => {
    const src = fs.readFileSync(require.resolve(file), 'utf8');
    assert.ok(src.includes(`'${kind}'`), file + ' must raise ' + kind);
  });
});

test('a suppressed routine note is still counted honestly', () => {
  // Discretionary notes count toward the cap; urgent ones are excluded from that count, so a burst
  // of real problems cannot use up Clay's allowance either.
  assert.match(notify, /AND kind NOT IN/);
});
