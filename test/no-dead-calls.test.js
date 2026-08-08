'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const app = fs.readFileSync('public/js/app.js', 'utf8');

test('the Laboratory does not call a function that does not exist', () => {
  // tuneIntro() was called and defined nowhere. An undefined call THROWS, so every line below it
  // stopped executing — the whole "Your projects — pick up where you left off" panel never
  // rendered, and a returning creator opened the Laboratory to no sign of the work they had done.
  // The projects were safe in the database and simply invisible on the one screen built to bring
  // them back to it.
  // Strip comments first: the explanation of the bug NAMES tuneIntro(), and a check that cannot
  // tell a live call from a mention of one would fail on its own documentation.
  const code = app.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/\btuneIntro\s*\(/.test(code), 'tuneIntro is no longer CALLED');
  assert.match(flat(app), /DEFINED NOWHERE/i);
});

test('a returning creator still gets their project list rendered', () => {
  // The lines that were unreachable behind the throw.
  assert.match(app, /pick up where you left off/);
  assert.match(app, /'Continue: ' \+ \(c\.title/);
  // And the render must not be gated behind anything that can throw first.
  // And the early return is reached directly, with no call in between that could throw first.
  const fn = app.slice(app.indexOf('async function renderMyConcepts'));
  const beforeReturn = fn.slice(0, fn.indexOf('if (!projects.length) return;'));
  assert.ok(!/\btuneIntro\b/.test(beforeReturn.replace(/\/\/.*$/gm, '')), 'no dead call before the render');
});
