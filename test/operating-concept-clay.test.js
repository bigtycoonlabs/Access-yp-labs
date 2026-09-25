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
// it with a 409, deliberately. So he set a path toward a wall and then asked for a display name, a
// format and a price so he could propose a listing that could only ever be refused.
//
// He half-sensed it — "we need to list it carefully as a transferable growth plan, not the sale of
// your existing operating company" — and reasoned around the tension instead of naming it, because
// nothing in his context said the plain thing was true. is_operating was not in the query that
// builds what he knows about a project.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');

test('and Clay is told plainly what that means', () => {
  assert.match(agent, /if \(concept\.is_operating\) \{/);
  assert.match(agent, /CANNOT be listed or sold in the Exchange/);
  // Not just a prohibition. He is told where to go instead, because growing a business somebody
  // already runs is a real path here and is why they came.
  assert.match(agent, /get straight back to helping them grow it/);
});
