'use strict';
// THE PROJECT PAGE READ A KEY THE API HAS NEVER RETURNED.
//
// Found by signing in on the LIVE site in a browser and opening a real project — not by reading the
// code, and not by any HTTP check, because nothing failed.
//
// GET /api/concepts/:id returns { concept, assets, entitled }. The page read `data.project`, with a
// `|| {}` fallback that turned the wrong key into an empty object instead of an error. So `project`
// was `{}` on every project page anybody has ever opened, and every read off it was undefined.
//
// Six user-visible defects from one wrong word, none of them throwing:
//   - the h1 and document title never said the project's name, only "Your project". Every project a
//     person owns announced the same heading, which for a screen-reader user makes them
//     indistinguishable — the same fault as nine pages sharing one title on the sister platform.
//   - Clay's take on the project never appeared.
//   - the value panel called /concepts/undefined/value and 404'd, so "what this is worth" — the
//     whole value ladder — rendered as nothing.
//   - the delete box said "this project" rather than naming what it was about to delete.
//   - the spoken vault summary said "your project" instead of the title.
//   - `if (!project.is_operating)` was ALWAYS true, so "List this in the Dream Market" was offered
//     on businesses the API refuses to list with a 409. The guard was written correctly and had
//     never once run.
//
// Same shape as PropertyDetail.tsx reading property.square_feet on the sister platform: a key that
// never existed, undefined for the life of the page, and nobody noticed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const page = fs.readFileSync('public/js/concept.js', 'utf8');
const route = fs.readFileSync('src/routes/concepts.js', 'utf8');

test('the page reads the key the endpoint actually returns', () => {
  assert.match(page, /var project = data\.concept \|\| data\.project \|\| \{\}/);
});

test('the endpoint really does return it under that name', () => {
  // Pinned against the route rather than against memory, so a rename breaks here rather than
  // silently emptying the page again.
  assert.match(route, /res\.json\(\{ concept/);
});

test('the value panel is called with a real id', () => {
  assert.match(page, /renderValue\(project\.id\)/);
  assert.match(page, /'\/concepts\/' \+ conceptId \+ '\/value'/);
});

test('a business somebody already runs is not offered a listing that would be refused', () => {
  // The API returns 409 for it, so the button could only ever end in a refusal. I wrote this
  // section in the same session as the staff-side fix stating that an offered button the server
  // will refuse is the same as a button that does nothing, and then made that exact mistake here.
  assert.match(page, /listingBox\(id, project\)/);
  assert.match(page, /if \(project && project\.is_operating\)/);
  assert.match(page, /it is not for sale/);
  // And the older guard on the other list button, which now actually runs.
  assert.match(page, /if \(!project\.is_operating\) \{/);
});

test('the page names the project rather than calling everything "Your project"', () => {
  assert.match(page, /document\.title = \(project\.title \|\| 'Your project'\)/);
  assert.match(page, /titleEl\.textContent = project\.title \|\| 'Your project'/);
});
