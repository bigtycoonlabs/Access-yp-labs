'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const spine = require('../src/services/clay/spine');
const fs = require('fs');

test('changing a dreamer tag asks first, because it changes how people recognise you everywhere', () => {
  assert.strictEqual(spine.requiresConfirmation('set_dreamer_tag'), true);
  // Reading it never needs a confirmation — that would make Clay annoying for no benefit.
  assert.strictEqual(spine.requiresConfirmation('get_dreamer_tag'), false);
});

test('Clay is told to check before asking, and to ask only once', () => {
  const agent = fs.readFileSync(require.resolve('../src/services/clay/agent.js'), 'utf8');
  assert.match(agent, /get_dreamer_tag first/i, 'he must not nag someone who already has one');
  assert.match(agent, /ask once, not every session/i);
  assert.match(agent, /AFTER they finish their first project/i, 'timed as a reward, not a chore');
});

test('the dreamer tag is ONE identity: the Dream Mover page reads it from the account', () => {
  const movers = fs.readFileSync(require.resolve('../src/routes/movers.js'), 'utf8');
  assert.match(movers, /display_name[\s\S]{0,80}dreamer_tag/, 'the promo page carries the same tag');
});

test('a project can be both for sale and seeking a partner, and each side links to the other', () => {
  const listings = fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8');
  const partners = fs.readFileSync(require.resolve('../src/routes/partners.js'), 'utf8');
  assert.match(listings, /partner_request_id/, 'a listing knows if the creator also wants a partner');
  assert.match(partners, /AS listing_id/, 'a partner ask knows if the project is also for sale');
});
