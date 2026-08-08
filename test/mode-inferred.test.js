'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const html = fs.readFileSync('public/app.html', 'utf8');

test('nobody picks Create or Enhance — Clay reads it', () => {
  // Clay works out which one you mean from what you write, and confirms before building either way,
  // so picking first was a step that decided nothing and made the person do his reading for him.
  assert.ok(!/mode-create|mode-enhance/.test(html), 'the toggle buttons are gone');
  assert.ok(!/mode-create|mode-enhance|setMode\(/.test(app), 'and nothing still reaches for them');
  assert.match(app, /function currentMode\(\)/);
  assert.match(flat(app), /a step that decided nothing/i);
});

test('mode is derived from things we can actually see', () => {
  // Refining an open project is an enhance; saying you run the business is an enhance; anything
  // else is a create. No stored choice to drift out of sync.
  const fn = app.slice(app.indexOf('function currentMode()'), app.indexOf('function currentMode()') + 400);
  assert.match(fn, /if \(currentConceptId\) return 'enhance'/);
  assert.match(fn, /op\.checked\) return 'enhance'/);
  assert.match(fn, /return 'create'/);
  assert.ok(!/let mode = 'create'/.test(app), 'no stale stored mode');
});

test('the one thing Clay cannot infer is still asked', () => {
  // Whether the business ALREADY EXISTS changes whether it can be listed for sale, and no amount of
  // reading the prompt establishes it.
  assert.match(html, /id="operating"/);
  assert.match(html, /already exists and I run it/i);
  assert.ok(!/operating-wrap/.test(app + html), 'and it no longer depends on a mode being picked first');
});

test('opening a project hides the checkbox that no longer applies', () => {
  // You are refining that project; whether some other business exists does not apply to it.
  const fn = app.slice(app.indexOf('function setEditingConcept'), app.indexOf('function goSignIn'));
  assert.match(fn, /wrap\.hidden = !!editing/);
  assert.match(fn, /if \(editing && op\) op\.checked = false/);
});
