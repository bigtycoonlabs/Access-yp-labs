'use strict';
// THE SITE MUST BE ABLE TO COUNT ITS OWN VISITORS.
//
// Cloudflare Web Analytics adds a beacon script from static.cloudflareinsights.com to every page
// and reports to cloudflareinsights.com. Our content security policy named neither, so every
// browser refused the script and no visit was ever recorded, silently: the pages worked and the
// analytics screen simply stayed empty. This checks the header a browser actually receives,
// not the source text, so rewording the policy cannot break it and removing the host will.
const { test } = require('node:test');
const assert = require('node:assert');

const app = require('../src/server');

function directives(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = values;
  }
  return out;
}

test('pages allow the Cloudflare analytics beacon to load and report', async () => {
  const server = app.listen(0);
  try {
    await new Promise((r) => server.once('listening', r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { redirect: 'manual' });
    const csp = directives(res.headers.get('content-security-policy'));
    assert.ok(csp['script-src'], 'the page sends a script-src directive');
    assert.ok(csp['script-src'].includes('https://static.cloudflareinsights.com'),
      `script-src must allow the beacon; got: ${csp['script-src'].join(' ')}`);
    const connect = csp['connect-src'] || csp['default-src'] || [];
    assert.ok(connect.includes('https:') || connect.includes('https://cloudflareinsights.com'),
      `connect-src must let the beacon report; got: ${connect.join(' ')}`);
  } finally {
    server.close();
  }
});
