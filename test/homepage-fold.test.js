'use strict';
// THE HOMEPAGE, rewritten 17 September 2026 after the owner walked it: "it makes it seem like a lot
// of things are not working, and it is a wall of features."
//
// Two causes. A roadmap section, written before the builder, the launcher and the Arbo handoff
// existed, was still on the page in the future tense after all three shipped — so a working product
// read as an empty one. And a compliance questionnaire sat at the top, which made the narrowest part
// of the platform look like the whole of it.
//
// What these tests protect is unchanged: the page says what runs, says it short, and claims nothing
// that is not true.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
// Matched with whitespace collapsed: a claim is no less true for being wrapped across lines.
const html = fs.readFileSync('public/index.html', 'utf8').replace(/\s+/g, ' ');

test('it carries YP Labs branding', () => {
  assert.match(html, /<title>Access YP Labs/);
  assert.match(html, /class="brand"[^>]*>Access YP Labs/);
  assert.ok(!/Penny Desk/.test(html));
  assert.match(html, /Penny is your business assistant/);
});

test('the hero says what she is and what to do, and stays short', () => {
  const hero = html.slice(html.indexOf('<div class="hero">'), html.indexOf('</div>', html.indexOf('<div class="hero">')));
  assert.ok((hero.match(/<p/g) || []).length <= 3, 'the hero grew into an essay');
  assert.match(hero, /class="btn" href="\/register.html">Start free/);
  assert.match(hero, /See the plans/);
  // Built to be run by ear as well as by eye — said as a strength of the product, about the product.
  assert.match(hero, /run by ear as well as by eye/);
});

test('nothing on the page is described as coming, because it is all built', () => {
  assert.ok(!/What is coming|None of this is built yet|not built yet/.test(html),
    'a roadmap left up after it ships makes a working product read as an empty one');
  assert.ok(!/<h2 id="next-h">/.test(html));
});

test('the things it names are the things that run', () => {
  const does = html.slice(html.indexOf('id="does-h"'), html.indexOf('id="who-h"'));
  for (const claim of [/keeps everything you owe/i, /builds what your business needs/i,
    /your own GitHub/, /shows her working|shows the government pages|every page she used/i,
    /files, keys and people/i, /Money goes to Arbo/i, /talk to her/i]) {
    assert.match(does, claim);
  }
  assert.ok(!/<table/.test(html), 'not a comparison grid');
});

test('one main, one h1, and the narrowest feature is not the front door', () => {
  assert.strictEqual((html.match(/<main/g) || []).length, 1);
  assert.strictEqual((html.match(/<h1/g) || []).length, 1);
  assert.ok(!/id="try"/.test(html), 'the compliance questionnaire is no longer the first thing');
  assert.ok(!/\/api\/public\/preview/.test(html), 'and its script went with it');
});

test('what she will not do stays, and stays short', () => {
  const wont = html.slice(html.indexOf('id="wont-h"'), html.indexOf('id="start-h"'));
  assert.match(wont, /will not invent a filing/);
  assert.match(wont, /A failed look is not a clear day/);
  assert.match(wont, /She does not do your books/);
  assert.ok((wont.match(/<li>/g) || []).length <= 5, 'a long list of refusals reads as a list of gaps');
});
