'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const server = fs.readFileSync(require.resolve('../src/server.js'), 'utf8');

test('credential endpoints are rate limited far tighter than the rest of the API', () => {
  assert.match(server, /authLimiter/, 'a dedicated limiter exists');
  assert.match(server, /app\.use\('\/api\/auth\/login', authLimiter\)/);
  assert.match(server, /app\.use\('\/api\/auth\/register', authLimiter\)/);
  assert.match(server, /app\.use\('\/api\/auth\/refresh', authLimiter\)/);
  // Successful sign-ins must not burn the budget, or a normal person gets locked out of their own
  // account for using the product.
  assert.match(server, /skipSuccessfulRequests: true/);
});

test('the auth budget is small enough to matter', () => {
  const block = server.slice(server.indexOf('const authLimiter'), server.indexOf("app.use('/api/auth/login'"));
  const max = /max:\s*(\d+)/.exec(block);
  assert.ok(max && Number(max[1]) <= 20, 'a credential limit above ~20 per window is not a limit');
});

test('a Content Security Policy is actually set, not disabled', () => {
  assert.ok(!/contentSecurityPolicy: false/.test(server), 'CSP must not be switched off');
  assert.match(server, /frameAncestors: \["'none'"\]/, 'the site cannot be framed');
  assert.match(server, /objectSrc: \["'none'"\]/);
  assert.match(server, /defaultSrc: \["'self'"\]/);
});
