'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const nav = fs.readFileSync('public/js/nav.js', 'utf8');

test('the menu is a list, not one run-on word', () => {
  // Links were appended with nothing between them, so a screen reader announced
  // "LaboratoryDashboardThe ExchangeAffiliateProfileSign out" as a single unbroken string —
  // the first thing heard on every page of the platform.
  assert.match(nav, /function asList\(items\)/);
  assert.match(nav, /nav\.appendChild\(asList\(/);
  // Both states, signed in and signed out.
  assert.strictEqual((nav.match(/asList\(/g) || []).length >= 3, true);
  assert.ok(!/nav\.appendChild\(link\(/.test(nav), 'no bare link appended straight to the nav');
});

test('the staff link joins the list rather than sitting outside it', () => {
  // Inserting into `nav` would put a bare anchor outside the list, where a screen reader would not
  // count it among the menu items. The link now points at the Operations console rather than the
  // old overview page, which was one of eight staff pages with no front door.
  // Since 17 Sept 2026 it points at the redesigned staff portal.
  assert.match(nav, /li\.appendChild\(link\('\/staff\/', 'Staff'\)\)/);
});
