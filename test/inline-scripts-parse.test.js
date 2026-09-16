'use strict';
// EVERY PAGE'S OWN SCRIPT HAS TO PARSE.
//
// The People page shipped with a script that did not parse: a broken edit left a stray quote on one
// line, so nothing on the page ran. It still returned HTTP 200 and every check that looked at the
// file's text passed. A page whose script is a syntax error is a page with no buttons.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');

const pages = fs.readdirSync('public').filter((f) => f.endsWith('.html'));

test('every inline script on every page parses', () => {
  const broken = [];
  for (const f of pages) {
    const html = fs.readFileSync('public/' + f, 'utf8');
    const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    let m; let n = 0;
    while ((m = re.exec(html))) {
      const attrs = m[1] || '';
      if (/\bsrc=/.test(attrs)) continue;
      if (/type=["'](application\/ld\+json|application\/json|text\/template)["']/i.test(attrs)) continue;
      n += 1;
      try { new vm.Script(m[2], { filename: f + ' inline #' + n }); } catch (e) {
        broken.push(f + ' inline script ' + n + ': ' + e.message);
      }
    }
  }
  assert.deepStrictEqual(broken, []);
});

test('every script file under public/js parses', () => {
  const broken = [];
  for (const f of fs.readdirSync('public/js').filter((x) => x.endsWith('.js'))) {
    try { new vm.Script(fs.readFileSync('public/js/' + f, 'utf8'), { filename: f }); } catch (e) {
      broken.push(f + ': ' + e.message);
    }
  }
  assert.deepStrictEqual(broken, []);
});
