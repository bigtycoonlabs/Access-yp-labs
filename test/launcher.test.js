'use strict';
// LAUNCHING A CUSTOM APP ONTO THE CLIENT'S OWN ACCOUNTS.
//
// Walked 16 Sept 2026 with a real GitHub key: the Build screen created the private repository
// bigtycoonlabs/yplabs-launch-test-2026-09-16 with five files, read them back, and called it not live
// yet. The pushed app was downloaded and run: it served the page and /health, and 404 for anything
// else. A second build asking for the same name was refused without touching the existing repository;
// launching the same build twice was refused; hosting was refused because it is switched off; a site
// hosted here was sent to Put it online instead. Hosting on Railway has NOT been run against a real
// account key: the only Railway key available was a project key, which cannot create projects.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const L = require('../src/services/clay/launcher');

const src = fs.readFileSync('src/services/clay/launcher.js', 'utf8');

test('the app that goes to GitHub runs on plain Node and says what is unfinished', () => {
  const files = L.packageFiles({ html: '<title>X</title>', businessName: 'Rivera', askedFor: 'a booking app', repoName: 'Rivera App!' });
  assert.deepStrictEqual(files.map((f) => f.path), ['index.html', 'server.js', 'package.json', 'README.md', '.gitignore']);
  const pkg = JSON.parse(files[2].content);
  assert.strictEqual(pkg.scripts.start, 'node server.js');
  assert.strictEqual(pkg.name, 'rivera-app');
  assert.ok(!pkg.dependencies, 'no dependencies to install');
  assert.doesNotMatch(files[1].content, /require\('(?!http|fs|path)/);
  assert.match(files[3].content, /Forms on the page show a message instead of sending anything/);
  assert.match(files[4].content, /\.env/);
});

test('names are suggested from the business and the request', () => {
  assert.strictEqual(L.suggestName('Rivera Landscaping', 'A booking app for lawn care'), 'rivera-landscaping-booking-lawn-care');
  assert.strictEqual(L.suggestName('', ''), 'business-app');
});

test('the repository is private, never written over, and read back before it is called done', () => {
  assert.match(src, /name, private: true, auto_init: false/);
  assert.match(src, /made\.status === 422/);
  assert.match(src, /and I will not write over it/);
  assert.match(src, /Read it back rather than trusting the writes/);
  assert.match(src, /so I am not calling this done/);
  const sql = fs.readFileSync('docs/migrations/068_launches.sql', 'utf8');
  assert.match(sql, /CHECK \(status <> 'done' OR \(result IS NOT NULL AND finished_at IS NOT NULL\)\)/);
});

test('hosting stays off until it has been tried, and a project key is never used to create a project', () => {
  const saved = process.env.LAUNCH_HOSTING;
  try {
    delete process.env.LAUNCH_HOSTING; assert.strictEqual(L.hostingOn(), false);
    process.env.LAUNCH_HOSTING = 'yes'; assert.strictEqual(L.hostingOn(), false);
    process.env.LAUNCH_HOSTING = 'on'; assert.strictEqual(L.hostingOn(), true);
  } finally { if (saved === undefined) delete process.env.LAUNCH_HOSTING; else process.env.LAUNCH_HOSTING = saved; }
  const host = src.slice(src.indexOf('async function host'), src.indexOf('// ---', src.indexOf('async function host')));
  assert.ok(host.indexOf('if (!hostingOn())') < host.indexOf('Keys.withKey'));
  assert.match(host, /meta\.checked\.kind === 'project'/);
});

test('it is only called live after the address has been opened and shows the app', () => {
  const chk = src.slice(src.indexOf('async function check'));
  assert.match(chk, /text\.includes\(title\)/);
  assert.match(src, /It is not live yet: it only runs in the preview/);
});

test('launching needs both projects and keys permissions, and only for a finished custom app', () => {
  const g = src.slice(src.indexOf('async function gate'), src.indexOf('async function latest'));
  assert.match(g, /'projects', 'act'/);
  assert.match(g, /'keys', 'act'/);
  assert.match(g, /b\.tier !== 'custom_app'/);
  assert.match(g, /b\.stage !== 'real' \|\| b\.status !== 'ready'/);
});

test('keys reach the launcher only through withKey, and Penny must confirm each step', () => {
  assert.doesNotMatch(src, /V\.open|vault/);
  assert.ok((src.match(/Keys\.withKey\(/g) || []).length === 2);
  const W = require('../src/services/clay/workspace');
  assert.strictEqual(W.TOOLS.launch_build.requires_confirmation, true);
  assert.deepStrictEqual(W.TOOLS.launch_build.enums.step, ['status', 'code', 'hosting', 'check']);
});

test('the Build screen offers it only on finished custom apps', () => {
  const html = fs.readFileSync('public/builds.html', 'utf8');
  assert.match(html, /b\.status === 'ready' && b\.stage === 'real' && b\.tier === 'custom_app'/);
  assert.match(html, /Nothing is created until you choose the button/);
  assert.match(html, /may cost money there/);
});

test('every step the launcher records is one the database accepts', () => {
  // Written 16 Sept 2026 after the migration file allowed 'address' while the code wrote 'check'.
  const sql = fs.readFileSync('docs/migrations/068_launches.sql', 'utf8');
  const allowed = (sql.match(/step IN \(([^)]*)\)/) || [])[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  const used = [...src.matchAll(/stepRow\(l\.id, '(\w+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(used.sort(), ['check', 'code', 'hosting']);
  used.forEach((u) => assert.ok(allowed.includes(u), u + ' is not allowed by the migration'));
});
