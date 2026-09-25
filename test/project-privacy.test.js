'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const adminUsers = fs.readFileSync(require.resolve('../src/routes/adminUsers.js'), 'utf8');

test('the staff people view shows counts, never project content', () => {
  assert.match(adminUsers, /count\(\*\) FROM concepts c WHERE c\.owner_id = u\.id/);
  assert.ok(!/SELECT[^;]*c\.title[^;]*FROM concepts/.test(adminUsers), 'no project titles are exposed');
});
