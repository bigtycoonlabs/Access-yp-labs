'use strict';
// ACCESS YP LABS IS THE BRAND, AND accessyplabs.com ITS HOME (owner, 16 Sept 2026).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const money = require('../src/lib/money');

const pub = fs.readdirSync('public').filter((f) => f.endsWith('.html'));
const indexed = pub.filter((f) => !fs.readFileSync('public/' + f, 'utf8').includes('noindex'));

test('no page, route or email points at another domain or name', () => {
  for (const f of pub) assert.doesNotMatch(fs.readFileSync('public/' + f, 'utf8'), /accesspennydesk|Penny Desk/i, f);
  for (const f of ['src/routes/deskPages.js', 'src/services/clay/pennyMail.js', 'public/robots.txt']) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /accesspennydesk/i, f);
  }
});

test('every indexed page that declares a canonical declares one on accessyplabs.com', () => {
  for (const f of indexed) {
    const m = fs.readFileSync('public/' + f, 'utf8').match(/rel="canonical" href="([^"]+)"/);
    if (m) assert.match(m[1], /^https:\/\/accessyplabs\.com\//, f);
  }
});

test('the pages that bring people in carry link previews', () => {
  for (const f of ['index.html', 'plans.html', 'desk.html']) {
    const s = fs.readFileSync('public/' + f, 'utf8');
    for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card']) {
      assert.ok(s.includes(tag), f + ' is missing ' + tag);
    }
    assert.match(s, /og:url" content="https:\/\/accessyplabs\.com/);
  }
});

test('the prices search engines read are the prices checkout charges', () => {
  for (const f of ['index.html', 'plans.html']) {
    const s = fs.readFileSync('public/' + f, 'utf8');
    const block = s.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(block, f + ' has no structured data');
    const data = JSON.parse(block[1]);
    const app = data['@graph'] ? data['@graph'].find((n) => n['@type'] === 'SoftwareApplication') : data;
    const price = (name) => Number(app.offers.find((o) => o.name === name).price);
    assert.strictEqual(price('Desk') * 100, money.planCents('desk'), f);
    assert.strictEqual(price('Office') * 100, money.planCents('office'), f);
    assert.strictEqual(price('Free'), 0);
  }
});

test('the sitemap leads with what the platform is now', () => {
  const s = fs.readFileSync('src/routes/deskPages.js', 'utf8');
  const core = s.slice(s.indexOf('const core = ['), s.indexOf('];', s.indexOf('const core = [')));
  assert.match(core, /plans\.html`, priority: '0\.9'/);
  for (const gone of ['marketplace', 'seats', 'dreamhold', 'sell']) assert.doesNotMatch(core, new RegExp(gone + '\\.html'));
});
