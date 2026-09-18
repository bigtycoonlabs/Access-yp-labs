'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// EVERY BUTTON THE INTERFACE OFFERS MUST HAVE SOMETHING BEHIND IT.
//
// The password reset was not broken — it was never built, and nothing noticed, because nothing
// compares what the front end asks for against what the server actually serves. This closes the
// direction that IS checkable: an interface calling an endpoint that does not exist. (The other
// direction — a feature nobody ever built a button for — no test can find; only using the product
// finds those.)
//
// Written after three attempts at this check produced confident nonsense. Notes on why, so the next
// person does not repeat them:
//   * Trailing slashes. A call to '/preferences' and a route defined as '/' inside a router mounted
//     at '/api/preferences' are the same endpoint. Comparing them naively reported the whole app
//     as missing.
//   * Truncated calls. `Kiln.api('/assets/' + id)` yields the literal '/assets/', which is a PREFIX
//     of a real route, not a broken one.
// A detector that cannot tell those apart reports 51 failures where there are none, which is worse
// than no detector: it trains you to ignore it.

function collect(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, ext, acc);
    else if (e.name.endsWith(ext)) acc.push(full);
  }
  return acc;
}

test('every endpoint the interface calls resolves to a real route', () => {
  const mounts = {};
  const srv = fs.readFileSync('src/server.js', 'utf8');
  //   * Hyphenated route files. The pattern was [a-zA-Z]+, so 'routes/public-preview' never matched
  //     its mount and every endpoint inside it was reported missing — a detector blind to a whole
  //     file, which is exactly the failure mode described above. Found when the first hyphenated
  //     route file was added.
  for (const m of srv.matchAll(/app\.use\('(\/api[^']*)',\s*require\('\.\/routes\/([a-zA-Z0-9-]+)'\)/g)) {
    mounts[m[2]] = m[1];
  }

  const full = [];
  for (const file of collect('src/routes', '.js')) {
    const mod = path.basename(file, '.js');
    const base = mounts[mod];
    if (!base) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/router\.(?:get|post|patch|put|delete)\(\s*'([^']+)'/g)) {
      full.push((base.replace(/\/+$/, '') + '/' + m[1].replace(/^\/+/, '')).replace(/\/\/+/g, '/').replace(/\/$/, '') || '/');
    }
  }
  assert.ok(full.length > 50, 'routes were parsed at all');

  const calls = [];
  // PAGES THAT NO LONGER EXIST DO NOT COUNT (18 September 2026).
  //
  // Retired pages redirect before they are served and their scripts never run, so an endpoint they
  // call is not a broken button. Read from server.js rather than listed here, so retiring a page in
  // one place is enough and this check cannot drift from what is actually served.
  const retiredBlock = srv.slice(srv.indexOf('const RETIRED_PAGES'), srv.indexOf('app.use((req, res, next) => {', srv.indexOf('const RETIRED_PAGES')));
  const retiredPages = [...retiredBlock.matchAll(/'(\/[a-z-]+\.html)':/g)].map((m) => 'public' + m[1]);
  const retiredScripts = new Set();
  for (const page of retiredPages) {
    if (!fs.existsSync(page)) continue;
    for (const m of fs.readFileSync(page, 'utf8').matchAll(/\/js\/([a-z0-9-]+\.js)/g)) retiredScripts.add(m[1]);
  }
  // Except any script a live page also loads: that one is still real.
  for (const file of collect('public', '.html')) {
    if (retiredPages.includes(file)) continue;
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/\/js\/([a-z0-9-]+\.js)/g)) retiredScripts.delete(m[1]);
  }

  for (const file of collect('public', '.js').concat(collect('public', '.html'))) {
    if (retiredPages.includes(file)) continue;
    if (retiredScripts.has(path.basename(file))) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/Kiln\.api\(\s*['"`]([^'"`]+)/g)) calls.push([m[1], file]);
    for (const m of src.matchAll(/fetch\(\s*['"`](\/api\/[^'"`?]+)/g)) calls.push([m[1], file]);
  }

  const missing = [];
  for (const [raw, file] of calls) {
    if (!raw.startsWith('/')) continue;
    const p = (raw.startsWith('/api/') ? raw : '/api/' + raw.replace(/^\/+/, '')).split('?')[0].replace(/\/$/, '');
    const ok = full.some((r) => {
      if (new RegExp('^' + r.replace(/:[a-zA-Z_]+/g, '[^/]+') + '$').test(p)) return true;
      if (r.startsWith(p)) return true;                                  // truncated call, real prefix
      return p.startsWith(r.replace(/:[a-zA-Z_]+/g, '').replace(/\/$/, ''));
    });
    if (!ok) missing.push(`${p}  (called from ${file})`);
  }
  assert.deepStrictEqual(missing, [],
    'the interface calls endpoints that do not exist:\n  ' + missing.join('\n  '));
});
