'use strict';
// GROWING A BUSINESS YOU ALREADY RUN WAS REFUSED AT THE DOOR.
//
// Walked on a real production account. A man with a Cleveland house-cleaning business, two vans and
// 40 recurring homes asked Clay for a growth package.
//
// Chat-Clay read him exactly right: "You're not trying to invent a new thing — you're trying to make
// the Cleveland cleaning business you already own throw off more steady work." He saved it to memory
// (verified — the row is in clay_memory), held an opinion, asked one real question, and proposed the
// build. The man approved it.
//
// Two minutes later the build reported FAILED:
//
//   "This is an operating business already at 40 recurring homes. Dream Market is built for
//    unlaunched or pre-launch projects, not live-business growth consulting. The right next move is
//    an operating growth plan or advisory engagement outside this project format."
//
// Two Clays disagreeing about the same person, and the conversational one was right. Growing a
// business you already run is one of the five ways to earn on this platform, stated in Clay's own
// prompt, and the build pipeline has had an EXISTING BUSINESS MODE for it the whole time.
//
// The mechanism: the chat executor hardcoded `operating: false`, so everything Clay had worked out
// about this person was thrown away at the boundary. The build then hit a blanket "already running →
// redirect" rule — which is a rule about what the Dream Market may SELL, applied at BUILD time. The
// listing gate already enforces that rule separately, by itself, with its own message.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const spine = require('../src/services/clay/spine');

const routes = fs.readFileSync('src/routes/clay.js', 'utf8');
const build = fs.readFileSync('src/services/clay/index.js', 'utf8');
const listings = fs.readFileSync('src/routes/listings.js', 'utf8');

test('Clay can tell the build what he worked out in the conversation', () => {
  assert.ok((spine.TOOLS.generate_concept.optional || []).includes('operating'),
    'generate_concept must accept the operating flag');
  const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
  assert.match(agent, /operating: 'boolean'/, 'and it must reach the schema the model sees');
});

test('the chat executor passes it through instead of throwing it away', () => {
  assert.match(routes, /generate_concept: async \(\{ prompt, category, operating \}\)/);
  assert.match(routes, /prompt, operating: !!operating, conceptId: null, buildId/);
  // The exact line that caused it.
  assert.ok(!/mode: 'create', category: category \|\| null, prompt, operating: false, conceptId: null, buildId/.test(routes));
});

test('a declared operator is never refused for being an operator', () => {
  // Belt and braces: a prompt rule is guidance, not a guarantee. If the model still returns the
  // redirect we just carved out, honouring it would fail the build for the very reason we accept.
  assert.match(build, /parsed\.redirect === 'running_business' && operating/);
  // Every other redirect still stands.
  assert.match(build, /if \(parsed\.redirect\) \{/);
});

test('the rule is read narrowly, as being about selling rather than helping', () => {
  assert.match(build, /a rule about what the Dream Market may SELL, not a rule about who you may help/);
});

test('the line itself still holds where it belongs — at listing', () => {
  // Removing the build-time refusal must not open a hole. It does not: a running business is
  // refused at the point of listing, on its own, with its own message.
  assert.match(listings, /if \(own\.rows\[0\]\.is_operating\)/);
  assert.match(listings, /sells unlaunched ideas, not running businesses/);
  assert.match(build, /Never imply they should sell, list, or hand off their existing business/);
});
