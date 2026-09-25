'use strict';
// TEAM AND PERMISSIONS.
//
// The capability model has been enforced at every read since it was built, and until now an owner
// had no way to grant anything. A permission system nobody can use is a permission system that gets
// replaced by sharing a password.
//
// Walked over HTTP and on a 390x780 phone: added a bookkeeper by preset, a first employee, a
// contractor; granted and removed permissions; tried to demote and remove the owner; offboarded
// somebody.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
// The work moved out of the route into services/clay/team.js on 17 Sept 2026, so the team
// screen and Penny do the same thing. These rules live with the work.
const api = fs.readFileSync('src/routes/team.js', 'utf8')
  + fs.readFileSync('src/services/clay/team.js', 'utf8');
const html = fs.readFileSync('public/team.html', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');

test('it is mounted and carries the Access YP Labs name', () => {
  assert.match(server, /app\.use\('\/api\/team'/);
  assert.match(html, /<title>People, Access YP Labs<\/title>/);
  assert.ok(!/\bClay\b/.test(html.replace(/clay-dark/g, '')));
});

test('presets are a starting point, not fixed roles', () => {
  // Fixed roles break immediately on real teams: somebody who does compliance AND development is not
  // admin and not staff, and inventing a role per combination is how this becomes unusable.
  assert.match(api, /Sensible starting points, not fixed roles/);
  assert.match(html, /A starting point, not a role/);
});

test('export is in no preset', () => {
  // It is the one capability that removes data from the building. It should be a deliberate act
  // rather than something that arrives with a job title.
  assert.match(api, /Export is in NO preset, on purpose/);
  const presets = api.slice(api.indexOf('const PRESETS'), api.indexOf('router.get(\'/presets\''));
  assert.ok(!/export:/.test(presets), 'a preset grants export');
});

test('granting export is named out loud', () => {
  // Walked: "Dana Brooks can now take data out of this business. Every export is logged."
  assert.match(api, /can now take data out of this business/);
});

test('not every relationship is a login, and the page says which', () => {
  // A landlord is a record. A vendor is a record and a thread. Only people who work in the business
  // take a seat. Walked: four people showed "A record rather than a login — they cannot sign in."
  assert.match(api, /AND NOT EVERY RELATIONSHIP IS A LOGIN/);
  assert.match(html, /A record rather than a login — they cannot sign in/);
  assert.match(api, /No account exists for that email yet/);
});

test('adding somebody creates obligations, not just access', () => {
  // This is where the team screen stops being admin and earns its place on the spine. Walked:
  // employee raised workers comp, contractor raised a W-9, partner raises an operating agreement.
  assert.match(api, /THE RELATIONSHIP CREATES OBLIGATIONS/);
  assert.match(api, /Workers comp before their first day/);
  assert.match(api, /genuinely dangerous '\s*\n?\s*\+ 'moments in a small business/);
  assert.match(api, /Get a W-9 from/);
  assert.match(api, /W-8BEN rather than a W-9/);
});

test('a new person sees nothing until something is granted', () => {
  // Absence is never permission. Walked: an employee added with no preset had no permissions at all.
  assert.match(api, /A relationship with no permissions sees nothing, which\s*\n?\s*\/\/ is the right default/);
});

test('the owner cannot be demoted or removed through this screen', () => {
  // Ownership is not a permission row, and letting somebody with team:manage strip the owner would
  // lock the business away from the person it belongs to. Walked: both refused.
  assert.match(api, /letting\s*\n?\s*\/\/ somebody with team:manage strip the owner/);
  assert.match(api, /You cannot remove the owner/);
});

test('leaving ends the relationship, it does not delete it', () => {
  // Who had access and when is what an audit asks for, and deleting the row destroys exactly that.
  assert.match(api, /Ended, not deleted/);
  assert.match(api, /UPDATE relationships SET ended_on=CURRENT_DATE/);
  assert.ok(!/DELETE FROM relationships/.test(api));
  // And the rest of offboarding goes on the list, because that is the part people forget.
  assert.match(api, /Finish offboarding/);
});

test('permissions are one line, with the controls behind a disclosure', () => {
  // Rendering eight dropdowns per person made a five-person team a wall — three of them showing
  // "Nothing" in all eight rows, which is a lot of interface carrying no information.
  // Measured after: four details elements, none open, page grows only when one is opened.
  assert.match(html, /WHAT THEY CAN SEE, AS A SENTENCE FIRST/);
  assert.match(html, /function summarise\(areas\)/);
  assert.match(html, /<details><summary class="sees">/);
  assert.match(html, /Sees nothing yet/);
});

test('a failed permission change reverts and says nothing was saved', () => {
  assert.match(html, /That did not save, so nothing has changed/);
  assert.match(html, /sel\.value = prev/);
});

test('a refusal names what exists rather than pretending otherwise', () => {
  assert.match(html, /A refusal names what exists and who can grant it/);
});

test('one main, one h1, a live region, every control labelled', () => {
  // Verified in the rendered DOM: mains 1, h1s 1, unlabelled 0, nothing under 44px.
  assert.strictEqual((html.match(/<main/g) || []).length, 1);
  assert.strictEqual((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /autocapitalize="none" spellcheck="false"/);
});

test('the destructive confirmation defaults to the safe answer', () => {
  // Native confirm() puts focus on OK and hands a keyboard user the destructive choice by default.
  // Caught by the existing admin-users rule when this page first went in. Asked in the page now,
  // focus on "No, leave it alone", and focus returned to the row afterwards — because removing the
  // prompt without restoring focus drops somebody at the top of the document.
  assert.match(html, /INLINE, WITH FOCUS ON THE SAFE OPTION/);
  assert.match(html, /no\.focus\(\);/);
  assert.match(html, /if \(opener && opener\.focus && document\.contains\(opener\)\) opener\.focus\(\)/);
  // Checked against the CODE. The first version of this assertion matched the word inside the
  // comment that explains why native confirm is gone — the same trap as the penny-chat suite, where
  // a check that cannot tell documentation from behaviour fails honest comments or passes real
  // regressions.
  // Block comments have continuation lines that start with neither // nor *, so filtering by line
  // prefix missed "Native confirm() puts focus on OK" sitting inside a /* */ block. Strip the blocks.
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bconfirm\(/.test(code), 'no native confirm on this page');
});

test('the team screen is linked at team.html, not at the old people.html address', () => {
  // I overwrote a working admin users console by taking its filename. Restored from git, and the
  // team screen moved to its own path. Two tests caught it — both read public/people.html and
  // expected the staff page — which is the only reason it did not ship.
  const t = fs.readFileSync('public/today.html', 'utf8');
  assert.match(t, /href="\/team\.html"/);
  assert.ok(!/href="\/people\.html"/.test(t));
});

test('keys, like export, are granted on purpose and never come with a preset', () => {
  const T = fs.readFileSync('src/routes/team.js', 'utf8');
  const presets = T.slice(T.indexOf('const PRESETS = {'), T.indexOf('};', T.indexOf('const PRESETS = {')));
  assert.doesNotMatch(presets, /\bkeys:/);
  assert.doesNotMatch(presets, /\bexport:/);
  assert.ok(require('../src/lib/permissions').AREAS.includes('keys'));
});
