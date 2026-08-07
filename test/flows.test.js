'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:--|\/\/)\s*/g, ' ').replace(/\s+/g, ' ');
const listings = fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8');
const weekly = fs.readFileSync(require.resolve('../src/services/clay/weekly.js'), 'utf8');

test('a settled auction stops being shown as an open opportunity', () => {
  // It has a winner and bidding is closed. Leaving it in the market invites someone to get
  // interested in something already decided.
  const live = (listings.match(/WHERE l\.status='live'/g) || []).length;
  const guarded = (listings.match(/AND l\.settled_at IS NULL/g) || []).length;
  assert.ok(live > 0, 'there are browse queries');
  assert.strictEqual(guarded, live, 'every one of them excludes settled auctions');
});

test('an issue delivered to nobody is not recorded as sent', () => {
  // Doubly wrong before: it claimed success, AND stamping sent_at meant the already-sent guard
  // would refuse to ever retry — a week's issue silently lost with the record insisting otherwise.
  assert.match(weekly, /reason: 'nothing_delivered'/);
  assert.match(flat(weekly), /ZERO DELIVERED IS NOT A SEND/i);
  const stamp = weekly.indexOf("UPDATE weekly_issues SET sent_at=now()");
  const guard = weekly.indexOf("if (sent === 0)");
  assert.ok(guard > -1 && guard < stamp, 'the zero check runs before the stamp');
});

test('a partial send reports the real gap rather than rounding up', () => {
  assert.match(weekly, /that gap is real/i);
});

test('a draft issue can be READ before it is approved', () => {
  // The only reader was the published one, so approving was the only way to find out what an issue
  // said. Nobody should have to publish something to discover what it says.
  const wk = fs.readFileSync(require.resolve('../src/services/clay/weekly.js'), 'utf8');
  const pages = fs.readFileSync(require.resolve('../src/routes/weeklyPages.js'), 'utf8');
  const admin = fs.readFileSync('public/weekly-admin.html', 'utf8');
  assert.match(wk, /async function getForPreview/);
  assert.match(pages, /router\.get\('\/weekly\/preview\/:slug'/);
  assert.match(pages, /staffViewer\(req\)/, 'preview is staff-only');
  assert.match(admin, /function previewLink/);
  // Match the rendered string, not the comment that explains why it was removed.
  assert.ok(!/'Approve it to see the page\.'/.test(admin), 'the approve-to-see dead end is gone');
});

test('the preview renders through the SAME function as the public page', () => {
  // A different layout for preview could hide the very problem you are checking for.
  const pages = fs.readFileSync(require.resolve('../src/routes/weeklyPages.js'), 'utf8');
  assert.match(pages, /issueHtml\(issue\)\.replace/);
});

test("Clay's own projects are not emailed for permission to feature them", () => {
  // Consent protects a real creator. A platform-seeded project has none — asking means emailing
  // Clay to ask Clay, and waiting for a click that will never come.
  const wk = fs.readFileSync(require.resolve('../src/services/clay/weekly.js'), 'utf8');
  assert.match(wk, /origin = 'clay_seed' OR u\.email = 'clay@accessyplabs\.com'/);
  assert.match(wk, /self_owned: true/);
  assert.match(wk, /'accepted',now\(\)/);
});
