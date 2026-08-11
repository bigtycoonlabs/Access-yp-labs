'use strict';
// CLAY WAS NEVER TOLD THE PROJECT WAS A BUSINESS SOMEBODY ALREADY RUNS.
//
// Walked live on a real account. Asked him: "email me the business plan, and go ahead and list it on
// the marketplace for me."
//
// He handled the impossible parts well, and that is worth recording: he refused to claim he had
// emailed it ("I can't email you directly from here"), refused to claim he had listed it, quoted the
// value range correctly at $75 to $610, and stated the 20/80 split correctly. The false-action-claim
// guard held.
//
// Then he said: "I also marked its path as Refine it to sell." He had. The row was really written —
// no fabrication. It was simply the wrong thing to write. That project is a Cleveland cleaning
// business the person operates, and a running business CANNOT be listed: the listings route refuses
// it with a 409, deliberately. So he set a path toward a wall and then asked for a dreamer tag, a
// format and a price so he could propose a listing that could only ever be refused.
//
// He half-sensed it — "we need to list it carefully as a transferable growth plan, not the sale of
// your existing operating company" — and reasoned around the tension instead of naming it, because
// nothing in his context said the plain thing was true. is_operating was not in the query that
// builds what he knows about a project.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const routes = fs.readFileSync('src/routes/clay.js', 'utf8');
const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
const listings = fs.readFileSync('src/routes/listings.js', 'utf8');

test('the concept context carries whether it is a live operation', () => {
  assert.match(routes, /c\.movement_state, c\.movement_note,\s*\n\s*c\.is_operating/);
});

test('and Clay is told plainly what that means', () => {
  assert.match(agent, /if \(concept\.is_operating\) \{/);
  assert.match(agent, /CANNOT be listed or sold in the Dream Market/);
  // Not just a prohibition. He is told where to go instead, because growing a business somebody
  // already runs is a real path here and is why they came.
  assert.match(agent, /get straight back to helping them grow it/);
});

test('the path write refuses refine_to_sell on a running business', () => {
  // A prompt rule is guidance; this is the guarantee. Recording that path would point the creator
  // at a wall and make Clay coach toward it on every turn afterwards.
  assert.match(routes, /own\.rows\[0\]\.is_operating && path === 'refine_to_sell'/);
  assert.match(routes, /That path was not recorded/);
  // It must read is_operating to be able to check it.
  assert.match(routes, /SELECT id, is_operating FROM concepts WHERE id=\$1 AND owner_id=\$2/);
});

test('the other paths still work for a running business', () => {
  // Building it further and still exploring are both legitimate for an operator. Only selling is not.
  assert.ok(!/is_operating && path/.test(routes.replace(/path === 'refine_to_sell'/, '')),
    'only the sell path is refused');
});

test('the rule this all defers to is still the listing gate', () => {
  assert.match(listings, /sells unlaunched ideas, not running businesses/);
});
