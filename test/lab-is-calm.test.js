'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const nav = fs.readFileSync('public/js/nav.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const html = fs.readFileSync('public/app.html', 'utf8');

test('the menu is a list, not one run-on word', () => {
  // Links were appended with nothing between them, so a screen reader announced
  // "LaboratoryDashboardThe Dream MarketDream MoverProfileSign out" as a single unbroken string —
  // the first thing heard on every page of the platform.
  assert.match(nav, /function asList\(items\)/);
  assert.match(nav, /nav\.appendChild\(asList\(/);
  // Both states, signed in and signed out.
  assert.strictEqual((nav.match(/asList\(/g) || []).length >= 3, true);
  assert.ok(!/nav\.appendChild\(link\(/.test(nav), 'no bare link appended straight to the nav');
});

test('the Staff link joins the list rather than sitting outside it', () => {
  // Inserting into `nav` would put a bare anchor outside the list, where a screen reader would not
  // count it among the menu items.
  assert.match(app.length ? nav : nav, /li\.appendChild\(link\('\/admin-overview\.html', 'Staff'\)\)/);
});

test('nothing asks for a decision before the person has spoken', () => {
  // Tuning used to open a second Clay message with a paragraph and two buttons — a decision
  // standing between somebody and the message box before they had said a word.
  assert.match(app, /const offer = el\('p', 'muted'\)/);
  assert.match(app, /'Tune it to me'/);
  assert.match(flat(app), /Opt-in was never the problem; being asked first was/i);
});

test('the welcome is said once, by Clay', () => {
  // A static page intro and Clay's own opening said the same thing, so arriving meant reading the
  // welcome twice.
  assert.ok(!/Clay is here in your laboratory/.test(html), 'the duplicate intro is gone');
  assert.match(app, /Welcome back, /);
});
