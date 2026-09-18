'use strict';
// A DESK ARTICLE IS WRITTEN IN MARKDOWN, SO IT IS READ AS MARKDOWN (18 September 2026).
//
// Every article was rendered as plain paragraphs: headings showed as "## What it costs", lists ran
// together, and a linked government source appeared as raw brackets mid-sentence. The sourced
// articles are the point of the Desk and their sources were neither readable nor clickable.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/routes/deskPages.js', 'utf8');

test('headings, lists and sources come out as headings, lists and links', () => {
  assert.match(src, /<a href="\$\{href\}" rel="nofollow noopener">/);
  assert.match(src, /out\.push\('<ul>'\)/);
  assert.match(src, /out\.push\('<ol>'\)/);
  assert.match(src, /<h2>\$\{inline\(line\.replace\(\/\^##\\s\+\/, ''\)\)\}<\/h2>/);
});

test('an article cannot inject markup or a javascript link', () => {
  // Escaped first, and only http or https is made clickable.
  assert.match(src, /const inline = \(t\) => esc\(t\)/);
  assert.match(src, /\\\[\(\[\^\\\]\]\{1,120\}\)\\\]\\\(\(https\?:\\\/\\\/\[\^\\s\)\]\{1,300\}\)\\\)/);
});

test('a lone hash does not create a second h1 on a page that already has one', () => {
  assert.match(src, /A single # would be a second h1/);
});

test('every article is reachable without running JavaScript', () => {
  // The Desk's front page draws its list with a script. A crawler that does not run scripts saw an
  // empty library — the thing the library is written for.
  assert.match(src, /router\.get\('\/desk\/all'/);
  assert.match(src, /a crawler that does not run\n\/\/ scripts sees an empty page/);
  assert.match(src, /\{ loc: `\$\{site\}\/desk\/all`, priority: '0\.8' \}/, 'and it is in the sitemap');
  const page = fs.readFileSync('public/desk.html', 'utf8');
  assert.match(page, /<a href="\/desk\/all">Every article, by subject<\/a>/);
  // The subjects on the page are the nine, not the retired seven.
  assert.ok(!page.includes('/desk/topic/buying-and-selling'));
  assert.match(page, /\/desk\/topic\/furnished-rentals/);
  assert.match(page, /\/desk\/topic\/by-ear/);
});

test('the index is declared above the article route that would swallow it', () => {
  // /desk/:slug matched "all" as an article slug, so the whole library returned a not-found page.
  const current = fs.readFileSync('src/routes/deskPages.js', 'utf8');
  assert.ok(current.indexOf("router.get('/desk/all'") < current.indexOf("router.get('/desk/:slug'"),
    '/desk/all must be registered before /desk/:slug');
  assert.match(current, /Declared ABOVE \/desk\/:slug on purpose/);
});
