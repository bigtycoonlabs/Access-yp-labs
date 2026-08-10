'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|--)\s*/g, ' ').replace(/\s+/g, ' ');
const mod = fs.readFileSync('public/moderation.html', 'utf8');
const consoleApi = fs.readFileSync(require.resolve('../src/routes/console.js'), 'utf8');

test('you read the listing before you are offered the editor', () => {
  // The editor rendered ABOVE the project, so the first thing offered was changing a listing you
  // had not yet read. Review, then fix what you found.
  const materials = mod.indexOf('(d.materials||[]).forEach');
  const editor = mod.indexOf('if(d.is_clay_seed){ host.appendChild(clayEditor(d)); }');
  assert.ok(materials > -1 && editor > -1);
  assert.ok(materials < editor, 'materials render before the editor');
  assert.match(flat(mod), /EDIT AFTER READING, not before/i);
});

test('a listing with nothing to read says so', () => {
  // It rendered as silence with the approve button sitting there anyway, so the screen looked the
  // same whether a project was thin or simply had not loaded.
  assert.match(mod, /This listing has no materials attached/);
  assert.match(mod, /approving it publishes a listing a buyer cannot/);
});

test('every queue links somewhere that shows that queue', () => {
  // "Orders holding money" pointed at people.html, which does not mention escrow at all — so
  // following it left somebody looking for money on a page about accounts.
  assert.ok(!/'Orders holding money', 'people\.html'/.test(consoleApi));
  assert.match(consoleApi, /'Orders holding money', 'console\.html#business'/);
  const dest = [...consoleApi.matchAll(/SELECT '([^']+)', '([a-z.#]+)'/g)].map((m) => m[2]);
  dest.forEach((d) => {
    const file = 'public/' + d.split('#')[0];
    assert.ok(fs.existsSync(file), d + ' must be a page that exists');
  });
});

test('nothing sits in "what needs me" that staff cannot finish', () => {
  // An open partner request is a creator waiting for another creator — there is no staff route that
  // can accept or decline one. Leaving it in the task list put a permanently unclearable item at
  // the top, ageing forever, which is exactly how somebody learns to ignore the whole list.
  assert.ok(!/'Partner requests open', 'partners\.html'/.test(consoleApi));
  assert.match(flat(consoleApi), /Partner requests are deliberately NOT here/i);

  // It is counted under Growth instead, as a health signal.
  assert.match(consoleApi, /partner_requests: partners\.rows\[0\]/);
  const page = fs.readFileSync('public/console.html', 'utf8');
  assert.match(page, /partner asks open/);
  assert.match(page, /there is nothing for you to/);
});

test('a queue nobody can clear is labelled for what CAN be done', () => {
  // Verification is Stripe's decision and nobody here can grant it. What staff can do is notice
  // somebody stuck and contact them, so the label says that rather than implying an approve button.
  assert.match(consoleApi, /Sellers stuck unverified — worth reaching out/);
  assert.match(flat(consoleApi), /verification is STRIPE'S decision and nobody here can grant it/i);
});

test('every queue that IS listed has an action on the page it points to', () => {
  // Walked each one in a browser: listings review has Approve and Reject, the weekly has Approve
  // this issue. This pins the pairing so a future queue cannot be added without a way to close it.
  const pairs = [...consoleApi.matchAll(/SELECT '([^']+)', '([a-z.#]+)'/g)].map((m) => [m[1], m[2]]);
  const actionable = { 'moderation.html': /Approve/, 'weekly-admin.html': /Approve this issue/ };
  pairs.forEach(([label, dest]) => {
    const re = actionable[dest];
    if (!re) return;
    const src = fs.readFileSync('public/' + dest.split('#')[0], 'utf8');
    assert.match(src, re, label + ' must be finishable on ' + dest);
  });
});
