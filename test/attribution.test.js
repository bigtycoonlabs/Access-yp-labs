'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const attr = fs.readFileSync(require.resolve('../src/services/clay/attribution.js'), 'utf8');
const listings = fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8');
const a = require('../src/services/clay/attribution');

test('a listing share link carries where it came from', () => {
  // Clay Weekly already did this; listings carried nothing, so promoting one across four channels
  // produced no way to tell which worked.
  const links = a.shareLinks('abc-123');
  assert.ok(links.length >= 10);
  assert.match(links[0].url, /listing\.html\?id=abc-123&from=/);
});

test('the channel list is fixed, not free text', () => {
  // "instagram", "Instagram" and "ig" in one report is how a source breakdown becomes useless.
  assert.ok(a.CHANNELS.includes('instagram'));
  assert.match(attr, /CHANNELS\.includes\(String\(source \|\| ''\)\.toLowerCase\(\)\)/);
});

test('an unrecognised source is kept, not discarded', () => {
  // A visit we cannot attribute is still a visit; dropping it would understate arrivals.
  assert.match(attr, /: \(source \? 'other' : null\)/);
  assert.match(attr, /unattributed_visits/);
});

test('recording a visit can never break the page', () => {
  // The listing is what they came for; the counting is ours.
  assert.match(listings, /attribution must never break a listing page/);
  assert.match(listings, /\.catch\(\(\) => \{\}\)/);
});

test('a listing page issues the visitor token itself', () => {
  // A listing is often the FIRST page somebody lands on, straight from a shared link. Only the
  // homepage used to mint this, so every visit arriving from a post counted as an anonymous nobody.
  assert.match(listings, /require\('\.\/visitor'\)\.ensureToken\(req, res\)/);
  const visitor = fs.readFileSync(require.resolve('../src/routes/visitor.js'), 'utf8');
  assert.match(visitor, /module\.exports\.ensureToken = ensureToken/);
});

test('we never record WHICH named person viewed a listing', () => {
  // A listing view is browsing. Recording that a specific creator opened a specific listing would
  // be surveillance wearing an analytics badge.
  assert.match(attr, /signed_in/);
  assert.ok(!/user_id/.test(attr), 'no user id on a visit');
  assert.match(flat(attr), /surveillance wearing an analytics badge/i);
});

test('the channel report shows posts AND visits together', () => {
  // 20 posts with 2 visits and 1 post with 2 visits are telling you opposite things.
  assert.match(attr, /COALESCE\(p\.posts, 0\)::int AS posts/);
  assert.match(attr, /COALESCE\(v\.visits, 0\)::int AS visits/);
});

test('the rotation puts never-promoted listings first', () => {
  // So a creator's project cannot quietly go untouched while the easy ones get posted repeatedly.
  assert.match(attr, /ORDER BY last_promoted ASC NULLS FIRST/);
  assert.match(attr, /never_promoted: !x\.last_promoted/);
});
