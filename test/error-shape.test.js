'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const server = fs.readFileSync(require.resolve('../src/server.js'), 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');

test('a mistyped link is a 404 in plain words, not a 500 leaking the database', () => {
  // Postgres rejects a bad uuid with 22P02. Left alone it surfaced as a 500 carrying
  // 'invalid input syntax for type uuid' — blaming us for a bad link, telling a stranger what the
  // database is made of, and firing the 500 alarms for something routine.
  assert.match(server, /err\.code === '22P02'/);
  assert.match(server, /res\.status\(404\)/);
  assert.match(flat(server), /A MALFORMED ID IS NOT A SERVER FAULT/i);
});

test('a value too long is the input being too big, not a fault', () => {
  assert.match(server, /err\.code === '22001'/);
  assert.match(server, /too long to save/i);
});

test('the laboratory project list cannot crash on a cold load', () => {
  // It assigned to 'concepts' and then read 'projects.length' — it only ever worked because the
  // caller happened to pass the list in.
  assert.match(app, /projects = \(r && \(r\.projects \|\| r\.concepts\)\) \|\| \[\]/);
  assert.ok(!/concepts = \(r && r\.concepts\) \|\| \[\];\s*\}\s*if \(!projects\.length\)/.test(app));
});
