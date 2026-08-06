'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
// Comments wrap across lines, so flatten whitespace before matching a sentence — otherwise a
// reformat silently stops the test checking what it claims to check.
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const svc = flat(fs.readFileSync(require.resolve('../src/services/clay/siteAccess.js'), 'utf8'));
const files = {
  publish: flat(fs.readFileSync(require.resolve('../src/routes/clay.js'), 'utf8')),
  serve: flat(fs.readFileSync(require.resolve('../src/routes/sites.js'), 'utf8')),
  preview: flat(fs.readFileSync(require.resolve('../src/routes/launch.js'), 'utf8')),
  checkout: flat(fs.readFileSync(require.resolve('../src/routes/store.js'), 'utf8')),
  exportFile: flat(fs.readFileSync(require.resolve('../src/routes/concepts.js'), 'utf8')),
};

test('every door a site could escape through checks the SAME rule', () => {
  // Publishing, public serving, the preview link, checkout and export must never disagree — a
  // disagreement means a site is unpublished but reachable, or unreachable but taking money.
  Object.entries(files).forEach(([name, src]) => {
    assert.match(src, /siteAccess/, name + ' must consult the shared rule');
  });
});

test('a lapsed plan stops a site being served, rather than trusting the stored flag', () => {
  assert.match(files.serve, /publiclyVisible/);
  assert.match(svc, /if a subscription lapses the site quietly stops being reachable/i);
});

test('the preview link resolves for the owner and nobody else', () => {
  assert.match(files.preview, /viewer !== c\.owner_id/);
  assert.match(files.preview, /publishing through a side door/i);
});

test('checkout is refused when the site is not public, and says nothing was charged', () => {
  assert.match(files.checkout, /publiclyVisible/);
  assert.match(files.checkout, /Nothing was charged/i);
});

test('the refusal explains what is free and promises nothing is lost', () => {
  assert.match(svc, /Building and previewing your site is free/i);
  assert.match(svc, /Nothing you have built is lost/i);
});
