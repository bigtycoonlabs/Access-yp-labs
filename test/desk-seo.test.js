'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const seo = require('../src/services/clay/deskSeo');
const compose = fs.readFileSync(require.resolve('../src/services/clay/deskCompose.js'), 'utf8');
const pages = fs.readFileSync(require.resolve('../src/routes/deskPages.js'), 'utf8');
const server = fs.readFileSync(require.resolve('../src/server.js'), 'utf8');

test('the Desk has browsable subjects, not one-off topics', () => {
  assert.strictEqual(seo.CATEGORIES.length, 7);
  assert.ok(seo.isCategory('pricing'));
  assert.ok(!seo.isCategory('nonsense'));
  assert.match(pages, /router\.get\('\/desk\/topic\/:category'/);
});

test('a keyword chooses the subject, never the content', () => {
  // SEO is where honesty gets cut first. Clay writes the true piece and targets a real search; he is
  // told explicitly not to repeat a phrase to game anything or write what he does not believe.
  assert.match(compose, /never repeat the phrase to game anything/i);
  assert.match(compose, /never write something you do not believe in order to be found/i);
});

test('every piece lands in a real category, so nothing is unbrowsable', () => {
  assert.match(compose, /deskSeo\.isCategory\(cat\) \? cat : 'starting-out'/);
});

test('keyword targets are search intents, not invented traffic numbers', () => {
  const all = Object.values(seo.KEYWORD_TARGETS).flat();
  assert.ok(all.length > 20);
  assert.ok(all.every((k) => typeof k === 'string' && !/\d+\s*(searches|volume|\/mo)/i.test(k)),
    'no fabricated volume claims');
});

test('the sitemap is generated live and includes subjects and issues', () => {
  // Nothing is cached, so anything Clay publishes and every Weekly issue appears the moment it does.
  assert.match(pages, /desk\/topic\/\$\{c\.slug\}/);
  assert.match(pages, /listPublished/);
  assert.match(flat(pages), /the sitemap is generated on request/i);
});

test('trust proxy is one hop, so per-IP limits cannot be spoofed away', () => {
  // 'true' trusts the whole X-Forwarded-For chain: anyone could append a fake address and get a
  // fresh rate-limit budget, defeating the brute-force protection on sign-in.
  assert.match(server, /app\.set\('trust proxy', 1\)/);
  assert.ok(!/app\.set\('trust proxy', true\)/.test(server));
});

test('a subject page is canonical to ITSELF, not to the Desk', () => {
  // I first wrote every page declaring /desk as its canonical, which tells a search engine these
  // pages are duplicates and should be dropped — the exact opposite of why they exist. A canonical
  // pointing elsewhere is not a small mistake; it is an instruction to ignore the page.
  assert.match(pages, /canonical: `\$\{SITE\(\)\}\/desk\/topic\/\$\{cat\}`/);
  assert.match(flat(pages), /canonical MUST be the page's own address/i);
  assert.ok(!/`<link rel="canonical" href="\$\{esc\(site\)\}\/desk"\/>`/.test(pages));
});

test('every indexable public page declares a canonical', () => {
  const glob = require('fs').readdirSync('public').filter((f) => f.endsWith('.html'));
  const missing = glob.filter((f) => {
    const s = require('fs').readFileSync('public/' + f, 'utf8');
    if (s.includes('noindex')) return false;                 // deliberately not indexed
    if (['launch.html', 'mover.html'].includes(f)) return false;  // templates: a fixed canonical would be wrong
    return !s.includes('rel="canonical"');
  });
  assert.deepStrictEqual(missing, [], 'these pages have no canonical: ' + missing.join(', '));
});
