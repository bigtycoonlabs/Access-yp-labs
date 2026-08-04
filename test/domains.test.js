const { test } = require('node:test');
const assert = require('node:assert');
const d = require('../src/services/clay/domains');

test('subdomain labels: normalize + validate + reserved words', () => {
  assert.strictEqual(d.normalizeLabel('  My Cool Site!! '), 'my-cool-site');
  assert.ok(d.validLabel('empower-blind-parents'));
  assert.ok(!d.validLabel('www'));
  assert.ok(!d.validLabel('api'));
  assert.ok(!d.validLabel('-bad'));
  assert.strictEqual(d.subdomainHost('empower'), 'empower.' + d.sitesRoot());
});

test('custom host: normalize strips scheme/path/port; validates fqdn', () => {
  assert.strictEqual(d.normalizeCustomHost('https://YourBiz.com/pricing'), 'yourbiz.com');
  assert.ok(d.validCustomHost('yourbusiness.com'));
  assert.ok(d.validCustomHost('shop.yourbusiness.co.uk'));
  assert.ok(!d.validCustomHost('nodot'));
  assert.ok(!d.validCustomHost('bad_underscore.com'));
  assert.ok(!d.validCustomHost('anything.' + d.sitesRoot()), 'a subdomain of our root is not a custom host');
});

test('app host vs site host', () => {
  assert.ok(d.isAppHost('accessyplabs.com'));
  assert.ok(d.isAppHost('www.accessyplabs.com'));
  assert.ok(d.isAppHost('yp-labs-production.up.railway.app'));
  assert.ok(d.isSiteHost('empower.sites.accessyplabs.com'));
  assert.ok(d.isSiteHost('someones-domain.com'));
  assert.ok(!d.isSiteHost('accessyplabs.com'));
});

test('hostOf respects x-forwarded-host', () => {
  assert.strictEqual(d.hostOf({ headers: { 'x-forwarded-host': 'Empower.sites.accessyplabs.com:443', host: 'origin' } }), 'empower.sites.accessyplabs.com');
  assert.strictEqual(d.hostOf({ headers: { host: 'yourbiz.com' } }), 'yourbiz.com');
});
