'use strict';
// STANDING IN YOUR OWN WORK, OR SOMEBODY'S TEAM (17 September 2026).
//
// The owner's rule: a team member is held to the limits the owner set unless they subscribe for
// their own usage, and they can toggle between the team and their own Penny.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const views = fs.readFileSync('src/services/clay/views.js', 'utf8')
  .replace(/\/\//g, ' ').replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
const allowance = fs.readFileSync('src/services/allowance.js', 'utf8');

test('whose plan pays is stored, not guessed', () => {
  assert.match(views, /The choice is stored, not guessed, because it decides whose plan pays/);
  assert.match(allowance, /async function payer\(user\)/);
  // Read in one place, so no path can forget it.
  assert.match(allowance, /const s = await status\(await payer\(user\), kind\)/);
  assert.match(allowance, /const who = await payer\(user\)/);
  assert.match(allowance, /\[who\.id, kind, fromTopup/);
});

test('you can only stand somewhere you were actually added', () => {
  assert.match(views, /You are not on that team, so I have not moved you/);
  assert.match(views, /r\.user_id = \$1 AND r\.ended_on IS NULL AND u\.id <> \$1/);
});

test('it says what changes when you move, including whose plan pays', () => {
  assert.match(views, /counts against their plan, and you can only do what they allowed/);
  assert.match(views, /Your own work is untouched/);
  assert.match(views, /You are in your own work now/);
});

test('Penny is told where she is standing, on both the written and spoken turn', () => {
  const route = fs.readFileSync('src/routes/penny.js', 'utf8')
    .replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  assert.strictEqual((route.match(/PENNY_WORKSPACE \+ told \+ standing/g) || []).length, 2);
  assert.match(route, /businesses are not part of this conversation/);
  assert.match(route, /counts against/);
});

test('an allowance that cannot be read still lets the work happen', () => {
  // Unchanged rule: an unreadable allowance allows the work and logs it, rather than blocking
  // somebody out of their own business over our own fault.
  assert.match(allowance, /return \{ ok: true, unread: true \}/);
  // An unreadable choice falls back to their own work rather than charging somebody at random.
  assert.match(views, /catch\(\(\) => \(\{ working_for: null \}\)\)/);
  assert.match(allowance, /catch \(_\) \{ return user; \}/, 'a failure to read it still lets the work happen');
});

test('the switcher is on every page somebody works on, not the retired ones', () => {
  // The first version went into nav.js, which the workspace does not use: it rendered on the retired
  // marketplace pages and nowhere a person actually works.
  const sw = fs.readFileSync('public/js/whose-work.js', 'utf8');
  assert.match(sw, /if \(!v \|\| !v\.views \|\| v\.views\.length < 2\) return;/, 'one option is noise');
  assert.match(sw, /lab\.setAttribute\('for', 'whose-work'\)/, 'a real label for a real select');
  assert.match(sw, /status\.textContent = \(r && r\.says\)/, 'moving is said before the page turns over');
  assert.match(sw, /That did not change, so you are where you were/);
  assert.match(sw, /aria-live', 'polite'/);
  for (const page of ['today', 'penny', 'businesses', 'files', 'team', 'portal', 'builds', 'keys', 'plans', 'profile']) {
    assert.match(fs.readFileSync('public/' + page + '.html', 'utf8'), /whose-work\.js/, page + ' has no switcher');
  }
  assert.ok(!fs.readFileSync('public/js/nav.js', 'utf8').includes('whose-work'), 'one implementation only');
});

test('the menu lists the platform as it is, not the one that was retired', () => {
  const nav = fs.readFileSync('public/js/nav.js', 'utf8');
  for (const gone of ['/app.html', '/dashboard.html', '/marketplace.html', '/seats.html', '/movers.html']) {
    assert.ok(!nav.includes("link('" + gone), 'the menu still offers ' + gone + ', which only redirects');
  }
  for (const here of ['/today.html', '/penny.html', '/businesses.html', '/files.html', '/plans.html']) {
    assert.ok(nav.includes("link('" + here), 'the menu should reach ' + here);
  }
});
