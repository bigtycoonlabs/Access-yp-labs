const { test } = require('node:test');
const assert = require('node:assert');
const sc = require('../src/services/clay/staffCapability');

test('regular builders get no staff tools', () => {
  assert.deepStrictEqual(sc.staffToolsFor('regular'), []);
  assert.deepStrictEqual(sc.staffToolsFor(undefined), []);
  assert.ok(!sc.allows('regular', 'decide_listing'));
  assert.ok(!sc.allows('regular', 'platform_pulse'));
});

test('staff (Kennedy) gets review + moderation + health, not onboarding or suspension', () => {
  const t = sc.staffToolsFor('staff');
  for (const x of ['check_systems', 'platform_pulse', 'review_queue', 'decide_listing', 'report_queue', 'resolve_report']) assert.ok(t.includes(x), x);
  assert.ok(!t.includes('manage_staff'));
  assert.ok(!t.includes('suspend_user'));
  assert.ok(sc.allows('staff', 'decide_listing'));
  assert.ok(!sc.allows('staff', 'manage_staff'));
});

test('admin adds account suspension but not staff onboarding', () => {
  assert.ok(sc.allows('admin', 'suspend_user'));
  assert.ok(sc.allows('admin', 'reinstate_user'));
  assert.ok(!sc.allows('admin', 'manage_staff'));
});

test('master_staff (owners) get everything, including onboarding', () => {
  const t = sc.staffToolsFor('master_staff');
  for (const x of sc.ALL_STAFF_TOOLS) assert.ok(t.includes(x), x);
  assert.ok(sc.allows('master_staff', 'manage_staff'));
  assert.strictEqual(sc.tierFor('master_staff'), 'master');
});
