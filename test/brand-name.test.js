'use strict';
// THE NAME ON SCREEN IS ACCESS YP LABS UNTIL THE NEW DOMAIN IS BOUGHT.
//
// Owner decision, 16 Sept 2026: "Penny Desk" comes off every page. Penny keeps her name as the
// assistant. Checked on everything a person can open, including titles and search descriptions,
// but not code comments.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

test('no page a person can open says Penny Desk', () => {
  const found = [];
  for (const f of fs.readdirSync('public').filter((x) => x.endsWith('.html'))) {
    const visible = fs.readFileSync('public/' + f, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/Penny Desk/.test(visible)) found.push(f);
  }
  assert.deepStrictEqual(found, []);
});

test('Penny introduces herself inside Access YP Labs', () => {
  const src = fs.readFileSync('src/services/clay/penny.js', 'utf8');
  assert.match(src, /You are Penny, the assistant inside Access YP Labs/);
});

test('the sign-in page no longer describes the retired marketplace', () => {
  const html = fs.readFileSync('public/login.html', 'utf8');
  assert.doesNotMatch(html, /the Exchange/);
  assert.match(html, /<title>Sign in, Access YP Labs<\/title>/);
});
