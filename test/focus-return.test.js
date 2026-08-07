'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const files = {
  people: fs.readFileSync('public/people.html', 'utf8'),
  dashboard: fs.readFileSync('public/js/dashboard.js', 'utf8'),
  project: fs.readFileSync('public/js/concept.js', 'utf8'),
  weekly: fs.readFileSync('public/weekly-admin.html', 'utf8'),
};

test('dismissing a confirmation returns focus, never dumps it at the top', () => {
  // Losing focus to <body> means a keyboard or screen reader user is thrown back to the top of the
  // document and has to find their place again. It happens silently and it is deeply disorienting.
  Object.entries(files).forEach(([name, src]) => {
    assert.match(src, /restore\(\)/, name + ' must restore focus');
  });
});

test('the dashboard restore survives the list re-rendering', () => {
  // Remembering the button NODE is not enough: the list re-renders, so the remembered node is
  // detached by the time we focus it and the attempt silently does nothing.
  assert.match(files.dashboard, /openerLabel/);
  assert.match(flat(files.dashboard), /Remembering the button NODE is not enough/i);
  assert.match(files.dashboard, /row\.setAttribute\('tabindex', '-1'\)/);
});

test('focus still lands on the SAFE option when a confirmation opens', () => {
  assert.match(files.people, /if\(no\.focus\) no\.focus\(\)/);
  assert.match(files.dashboard, /if \(no\.focus\) no\.focus\(\)/);
});
