'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const server = fs.readFileSync(require.resolve('../src/server.js'), 'utf8');

test('credential endpoints are rate limited far tighter than the rest of the API', () => {
  // Separate budgets since 17 Sept 2026: a shared one let failed refreshes lock people out of sign-in.
  assert.match(server, /app\.use\('\/api\/auth\/login', credentialLimiter\(12\)\)/);
  assert.match(server, /app\.use\('\/api\/auth\/register', credentialLimiter\(12\)\)/);
  assert.match(server, /app\.use\('\/api\/auth\/refresh', credentialLimiter\(120, \{/);
  assert.match(server, /kiln_rt=/, 'the skip rule names the real refresh cookie');
  assert.match(fs.readFileSync('src/routes/auth.js', 'utf8'), /const REFRESH_COOKIE = 'kiln_rt'/);
  // Successful sign-ins must not burn the budget, or a normal person gets locked out of their own
  // account for using the product.
  assert.match(server, /skipSuccessfulRequests: true/);
});

test('the auth budget is small enough to matter', () => {
  // Where a password can be guessed, the budget stays small. Refresh has a larger one (test above):
  // its token is a signed secret, not something a person can guess, and browsing makes refreshes.
  for (const path of ['login', 'register']) {
    const m = new RegExp("app\\.use\\('/api/auth/" + path + "', credentialLimiter\\((\\d+)\\)\\)").exec(server);
    assert.ok(m && Number(m[1]) <= 20, path + ': a credential limit above ~20 per window is not a limit');
  }
});

test('a Content Security Policy is actually set, not disabled', () => {
  assert.ok(!/contentSecurityPolicy: false/.test(server), 'CSP must not be switched off');
  assert.match(server, /frameAncestors: \["'none'"\]/, 'the site cannot be framed');
  assert.match(server, /objectSrc: \["'none'"\]/);
  assert.match(server, /defaultSrc: \["'self'"\]/);
});
