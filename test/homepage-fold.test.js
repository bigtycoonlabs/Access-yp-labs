'use strict';
// THE HOMEPAGE, AND THE FOLD DEFECT I RECREATED.
//
// The Bible records the single biggest conversion failure this site has had: "The idea box sat at
// y=828 on a 780-pixel phone screen — below the fold, on the one page whose entire job is getting
// somebody to type." Of 31 visitors, 26 never typed a word.
//
// Rewriting the hero to say more about what is built pushed the first control of the live demo to
// y=831. Three pixels from the original defect, in the same place, for the same reason.
//
// Measured after the fix: first control y=577, demo heading y=421, on a 390x780 viewport.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

test('it carries YP Labs branding, not Penny Desk', () => {
  // Penny is the assistant and keeps her name. Penny Desk is a product name that is not live yet,
  // and putting it on the homepage before the domain exists sells something nobody can reach.
  assert.match(html, /<title>Access YP Labs/);
  assert.match(html, /class="brand"[^>]*>Access YP Labs/);
  assert.ok(!/Penny Desk/.test(html));
  assert.match(html, /Penny runs the back office/);
});

test('the hero stays short enough to keep the demo above the fold', () => {
  // The second hero paragraph was true and worth saying, and it cost the one thing this page exists
  // to get somebody to do. It moved down the page instead of being deleted.
  assert.match(html, /THE FOLD|Penny runs the back office\. Filings in every state/);
  const hero = html.slice(html.indexOf('<div class="hero">'), html.indexOf('</div>', html.indexOf('<div class="hero">')));
  const paras = (hero.match(/<p class="sub">/g) || []).length;
  assert.ok(paras <= 1, 'the hero grew back to ' + paras + ' paragraphs and will push the demo down');
});

test('it names what is built without becoming a feature grid', () => {
  // A grid wins the purchase and loses the customer six months later when the workflow does not fit.
  // But the page had gone too far the other way and described a to-do list, while what exists is a
  // back office. Naming the areas is not a grid; hiding them is underselling.
  // Renamed to "What she does today" once a "What is coming" section joined it — the two headings
  // only work as a pair, and the first has to claim the present tense out loud for the second to be
  // read as the future.
  assert.match(html, /What she does today/);
  assert.match(html, /NO FEATURE GRID, DELIBERATELY/);
  assert.match(html, /Naming the areas is not a grid; hiding them is underselling/);
  // No ticks, no columns, no comparison table.
  assert.ok(!/<table/.test(html));
});

test('every claim on it is something that runs today', () => {
  assert.match(html, /Ohio does not require an LLC annual report/);
  assert.match(html, /a contractor means a W-9/);
  assert.match(html, /workers comp before their first day/);
  assert.match(html, /thirty days, fourteen, seven and the day before/);
  // And it still says what she will not do, on the page a stranger reads first.
  assert.match(html, /What she will not do/);
});

test('one main, one h1, the demo still runs unauthenticated', () => {
  assert.strictEqual((html.match(/<main/g) || []).length, 1);
  assert.strictEqual((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /\/api\/public\/preview/);
});

test('the roadmap is on the page, and reads as a roadmap', () => {
  // A homepage that only lists what shipped undersells a business that is going somewhere. One that
  // writes the roadmap in the present tense commits the single defect this estate is built against,
  // and it is the most checkable kind of lie — a visitor can ask to see it.
  //
  // Measured: "What she does today" at y=927, "What is coming" at y=2234, and the first sentence
  // under the second heading is "None of this is built yet."
  assert.match(html, /<h2 id="next-h">What is coming<\/h2>/);
  assert.match(html, /None of this is built yet/);
  assert.ok(html.indexOf('does-h') < html.indexOf('next-h'), 'what runs must come first');
  assert.match(html, /<h2 id="does-h">What she does today<\/h2>/);
  assert.match(html, /All of this runs now/);
});

test('the roadmap carries no dates', () => {
  // A date on a homepage is a promise to somebody choosing between tools.
  const coming = html.slice(html.indexOf('next-h'), html.indexOf('who-h'));
  assert.ok(!/\b(Q[1-4]|20\d\d|January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(coming),
    'a date crept into the roadmap');
  assert.match(html, /We will not put a date on any of it/);
});

test('the builder is only ever described as coming', () => {
  // clay_builds has 19 rows, 14 done — and site_pages and site_domains are both 0. Builds completed
  // and no site has ever had a page or a domain. Whatever they produced, nobody can visit it, so
  // "Penny builds your website" would fail on the most checkable claim on the page.
  const today = html.slice(html.indexOf('does-h'), html.indexOf('next-h'));
  assert.ok(!/builds it|website builder|your GitHub/.test(today),
    'the builder is claimed in the section that says everything runs now');
  const coming = html.slice(html.indexOf('next-h'));
  assert.match(coming, /She builds the thing/);
});
