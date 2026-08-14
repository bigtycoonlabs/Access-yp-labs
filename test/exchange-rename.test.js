'use strict';
// THE MARKETPLACE IS THE EXCHANGE. THE ROLE IS AFFILIATE.
//
// "Dream" was doing the wrong work. It means NOT REAL, on a marketplace asking people for real money
// for real business projects, and every other word on the page was fighting it — pre-proven,
// transfer agreement, 20% fee, most listed projects do not sell.
//
// The brand is not changing: Access YP Labs stays. This names a room inside it, a sibling to The
// Desk and Launch Partners, which is why it needs no qualifier in context.
//
// SCOPE, deliberately: copy only. dream_movers, mover_earnings, /api/movers, movers.html and
// dreamhold.html are all untouched. Renaming those is a schema migration plus a set of broken
// bookmarks for no user-visible gain, and doing it in the same pass as a copy change is how a
// rename takes a platform down.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const glob = (dir, ext) => fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => dir + '/' + f);
const SURFACES = [...glob('public', '.html'), ...glob('public/js', '.js')];

test('no page still says Dream Market or Dream Mover', () => {
  for (const f of SURFACES) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/Dream Market/.test(s), f + ' still says Dream Market');
    assert.ok(!/Dream Mover/.test(s), f + ' still says Dream Mover');
  }
});

test('nothing calls a project a dream to a person', () => {
  // A project on this platform is a project, a concept or a business. It is real, somebody may pay
  // thousands for it, and calling it a dream tells a buyer it is not.
  for (const f of SURFACES) {
    const s = fs.readFileSync(f, 'utf8');
    // Identifiers are exempt by design — dreamentry.js, dreamhold.html, dreamsEl.
    // Identifiers and CSS class names are exempt by design — dreamentry.js, dreamhold.html,
    // dreamsEl, .dream{}. What must not survive is a sentence a person reads.
    const copy = s.replace(/dreamentry|dreamhold|dreamsEl|dreamHero|dreamholdLink|dream_movers|\.dream\b/g, '');
    assert.ok(!/this dream|View this Dream|Claim this dream|No Dreams|Fresh Dreams|Untitled Dream/i.test(copy),
      f + ' still calls a project a dream');
  }
});

test('the identifiers are deliberately untouched', () => {
  // If these ever change it is a migration, not a copy sweep.
  assert.match(fs.readFileSync('src/routes/movers.js', 'utf8'), /FROM dream_movers/);
  assert.ok(fs.existsSync('public/movers.html'));
  assert.ok(fs.existsSync('public/dreamhold.html'));
});

test('Clay is TOLD the words changed, not just swapped underneath him', () => {
  // Otherwise he speaks fluent old-vocabulary from his own past output and from every reference he
  // has to the previous name, and the platform runs two vocabularies at once — worse than either
  // name alone. Same lesson as the earning path that still recruited consultants months after
  // consultants were retired.
  const { CLAY_LANGUAGE } = require('../src/services/clay/version');
  assert.match(CLAY_LANGUAGE, /The marketplace is THE EXCHANGE/);
  assert.match(CLAY_LANGUAGE, /RETIRED WORDS/);
  assert.match(CLAY_LANGUAGE, /same place, new name/);
});

test('and both surfaces get it, the member and the stranger', () => {
  const { PUBLIC_SYSTEM_PROMPT } = require('../src/services/clay/capabilityProfile');
  const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
  assert.match(PUBLIC_SYSTEM_PROMPT, /THE WORDS WE USE/);
  assert.match(agent, /\$\{CLAY_LANGUAGE\}/);
});

test('affiliate, never broker', () => {
  // Brokering the sale of a business is a licensed activity in several US states. The word invites a
  // reading of this platform that is not true of it.
  const { CLAY_LANGUAGE } = require('../src/services/clay/version');
  assert.match(CLAY_LANGUAGE, /AFFILIATE, not a broker/);
  assert.match(CLAY_LANGUAGE, /licensed activity/);
});

test('the spoken form is "the Exchange", everywhere a person reads it', () => {
  // Owner's call: The Exchange is the spoken form, not YP Exchange. It is a place inside Access YP
  // Labs, a sibling to The Desk, and a place takes an article — you go TO the Exchange.
  //
  // The rename sweep stripped the article in a few spots and left things reading like a product
  // name: a nav link that just said "Exchange", "Create your Exchange account", "Tuning your
  // Exchange", "makes an Exchange project".
  const pages = fs.readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => 'public/' + f);
  for (const p of pages) {
    const s = fs.readFileSync(p, 'utf8');
    assert.ok(!/>Exchange<\/a>/.test(s), p + ': a nav link must read "The Exchange"');
    assert.ok(!/\ban Exchange\b/.test(s), p + ': "an Exchange" is never right');
  }
  // And the brand it sits inside is never renamed to match it.
  for (const p of pages) {
    assert.ok(!/YP Exchange/.test(fs.readFileSync(p, 'utf8')), p + ': the brand stays Access YP Labs');
  }
});

test('no singular "Dream" survives in anything spoken or shown', () => {
  // The plural was swept and the SINGULAR escaped, inside a ternary: "1 fresh Dream" versus "3 fresh
  // Projects". It is the first line a returning creator hears on their dashboard, so the retired
  // vocabulary was the thing being said out loud. Another survived on the Affiliate page, in the
  // commission line: "You earn $7.45 if it sells through your link ($149.00 Dream)."
  const files = [...fs.readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => 'public/' + f),
    ...fs.readdirSync('public/js').map((f) => 'public/js/' + f)];
  for (const f of files) {
    const copy = fs.readFileSync(f, 'utf8')
      .replace(/dreamentry|dreamhold|dreamsEl|dreamHero|dreamholdLink|\.dream\b/g, '');
    assert.ok(!/\bDream\b/.test(copy), f + ' still says Dream');
  }
});

test('project is not a proper noun mid-sentence', () => {
  // "Dreams" was capitalised as a proper noun and the sweep carried the capital across: "Promote
  // Projects you believe in", "Loading Projects…", "No live Projects to promote right now."
  const files = [...fs.readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => 'public/' + f),
    ...fs.readdirSync('public/js').map((f) => 'public/js/' + f)];
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      // Headings and titles keep their capital, and so do HTML comments — the dashboard's own note
      // explaining this reorder quotes the section name "Today's Projects", and a comment is not
      // something a person reads on the page.
      if (/<h[1-6]|<title|id="[a-z-]*-h"|^\s*\/\/|^\s{5,}[A-Za-z]/.test(line)) continue;
      assert.ok(!/(?<=[a-z,] )Projects?\b/.test(line), f + ': ' + line.trim().slice(0, 70));
    }
  }
});

test('an Affiliate page names whose page it is', () => {
  // Only document.title was being set, so every Affiliate page announced "An Affiliate" as its h1
  // while the browser tab correctly showed the person's name. Somebody navigating by heading was
  // told nothing about whose page they had landed on.
  //
  // Same shape as the project page announcing "Your project" for every project somebody owns, found
  // earlier this week. A heading that never changes is a heading that says nothing.
  const mover = fs.readFileSync('public/mover.html', 'utf8');
  assert.match(mover, /titleEl\.textContent=who;/);
  assert.match(mover, /var who = m\.builder_tag\|\|m\.headline\|\|\('@'\+m\.slug\)/);
  // A missing page gets its own heading rather than keeping the placeholder: "An Affiliate" above
  // "not found" reads as though somebody's page had emptied out.
  assert.match(mover, /titleEl\.textContent='Affiliate page not found'/);
  assert.match(mover, /There is no Affiliate page at this link/);
  assert.ok(!/>An Affiliate</.test(mover), 'no placeholder heading left');
});
