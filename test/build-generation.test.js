'use strict';
// WRITING PAGES, AND OPENING THEM SAFELY.
//
// Walked 16 Sept 2026 against the real model: a quote form (mock-up), two direct builds, a quick
// edit with no mock-up that changed only the two button labels asked about, and a mock-up approved
// into a real build. All passed these checks on the first attempt. Inside the preview, localStorage
// threw SecurityError and a fetch to our API was refused by the policy.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const G = require('../src/services/clay/buildGen');
const preview = require('../src/routes/preview');
const B = require('../src/services/clay/builder');

const GOOD = '<!DOCTYPE html><html lang="en"><head><title>Quote request</title></head><body>'
  + '<main><h1>Ask for a quote</h1><form><label for="a">Your address</label><input id="a" type="text">'
  + '<label>Yard size <select id="y"><option>Small</option></select></label>'
  + '<button type="submit">Send</button><p role="status" aria-live="polite"></p></form></main>'
  + '</body></html>';

test('a well formed page passes', () => {
  const c = G.check(GOOD);
  assert.deepStrictEqual(c.problems, []);
});

test('an unlabelled field fails, and says which', () => {
  const c = G.check(GOOD.replace('<label for="a">Your address</label>', ''));
  assert.strictEqual(c.ok, false);
  assert.match(c.problems.join(' '), /these fields have no label: a/);
});

test('anything loaded from another site fails, because the preview has no network', () => {
  const c = G.check(GOOD.replace('</head>', '<script src="https://cdn.example.com/x.js"></script></head>'));
  assert.match(c.problems.join(' '), /loads things from other sites \(script\)/);
  const f = G.check(GOOD.replace('</head>', '<style>@import url(https://fonts.example.com/a.css);</style></head>'));
  assert.match(f.problems.join(' '), /other sites/);
});

test('landmarks and headings are counted, not assumed', () => {
  assert.match(G.check(GOOD.replace('<main>', '<main><main>')).problems.join(' '), /2 main landmarks/);
  assert.match(G.check(GOOD.replace('<h1>Ask for a quote</h1>', '')).problems.join(' '), /0 h1 headings/);
  assert.match(G.check(GOOD.replace(' lang="en"', '')).problems.join(' '), /no language/);
});

test('em-dashes fail, by the owner rule', () => {
  assert.match(G.check(GOOD.replace('Ask for a quote', 'Ask \u2014 quote')).problems.join(' '), /em-dashes/);
});

test('controls with nowhere to say what happened fail', () => {
  assert.match(G.check(GOOD.replace(' role="status" aria-live="polite"', '')).problems.join(' '),
    /no status region/);
});

test('the html is found inside fences or chatter, and absent html is absent', () => {
  assert.strictEqual(G.extractHtml('Here you go:\n```html\n' + GOOD + '\n```'), GOOD);
  assert.strictEqual(G.extractHtml('I cannot do that.'), null);
});

test('the preview runs in a sandbox with no network', () => {
  const csp = preview.SANDBOX_CSP;
  assert.match(csp, /^sandbox allow-scripts allow-forms/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  const src = fs.readFileSync('src/routes/preview.js', 'utf8');
  assert.match(src, /'X-Robots-Tag': 'noindex, nofollow'/);
  assert.match(src, /\^\[a-f0-9\]\{36\}\$/);
});

test('a build is only called ready with a page and an address', () => {
  const src = fs.readFileSync('src/services/clay/buildGen.js', 'utf8');
  const insert = src.indexOf('INSERT INTO build_pages');
  const ready = src.indexOf('B.ready(build.id');
  assert.ok(insert > 0 && ready > insert, 'the page is stored before the build is called ready');
  assert.match(src, /I wrote it twice and it did not pass my own checks/);
});

test('the mock-up is asked about, never assumed', () => {
  assert.strictEqual(B.mockChoice(undefined), null);
  assert.strictEqual(B.mockChoice(null), null);
  assert.strictEqual(B.mockChoice('yes'), 'yes');
  assert.strictEqual(B.mockChoice(false), 'no');
  assert.match(B.MOCK_QUESTION, /^Do you want me to create a mock-up first/);
  assert.match(B.MOCK_QUESTION, /go straight to building it/);
});

test('the screen asks the same question, with no answer picked for them', () => {
  const html = fs.readFileSync('public/builds.html', 'utf8');
  assert.match(html.replace(/\s+/g, ' '), /Do you want me to create a mock-up first, so you can make sure everything is to your liking before I start building\?/);
  assert.strictEqual((html.match(/name="mock"[^>]*checked/g) || []).length, 0);
  const today = fs.readFileSync('public/today.html', 'utf8');
  assert.match(today, /href="\/builds\.html"/);
});

test('Penny cannot start a build without an answer', async () => {
  const W = require('../src/services/clay/workspace');
  const P = require('../src/lib/permissions');
  const orig = P.can;
  P.can = async () => ({ ok: true, perms: { business: { name: 'T' } } });
  try {
    const r = await W.EXECUTORS.start_build({ id: 'u' },
      { business_id: 'b', asked_for: 'a booking page for cleans' });
    assert.strictEqual(r.status, 'needs_answer');
    assert.match(r.says, /Nothing has started/);
  } finally { P.can = orig; }
});
