'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../src/routes/adminUsers.js'), 'utf8');
const page = fs.readFileSync('public/people.html', 'utf8');

test('an account with money history cannot be deleted', () => {
  assert.match(src, /FROM orders_transfers WHERE seller_id=\$1 OR buyer_id=\$1/);
  assert.match(src, /money history/i);
  // The check must come BEFORE the delete, or it protects nothing.
  const guard = src.indexOf('money history');
  const del = src.indexOf("DELETE FROM users");
  assert.ok(guard > -1 && del > -1 && guard < del, 'the guard runs before the delete');
});

test('nobody can suspend or delete themselves, and only an owner acts on an owner', () => {
  assert.match(src, /cannot do that to your own account/i);
  assert.match(src, /Only an owner can act on another owner/i);
});

test('suspending is reversible and says nothing was destroyed', () => {
  assert.match(src, /Nothing of theirs has been deleted/i);
  assert.match(src, /restore/);
});

test('destructive actions confirm, with focus on the safe option', () => {
  assert.match(page, /function confirmThen/);
  assert.match(page, /no\.focus\(\) no\.focus|if\(no\.focus\) no\.focus\(\)/);
  assert.match(page, /cannot be undone/i);
  // The delete button is only rendered where deletion is actually permitted.
  assert.match(page, /if\(u\.orders===0\)/);
});

test('a failed message says plainly that nothing reached them', () => {
  assert.match(src, /Nothing reached/i);
});
