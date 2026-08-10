'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const flat = (s) => s.replace(/\n\s*#\s*/g, ' ').replace(/\s+/g, ' ');

const DIR = 'docs/migrations';
const order = fs.readFileSync(path.join(DIR, 'ORDER.txt'), 'utf8');
const listed = order.split('\n').map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

test('every migration file is in the run order', () => {
  // Filename order does not work: on a clean database 46 of 54 files failed and only five tables
  // were created, because `users` is created in 050 and nearly everything references it. The live
  // database was fine only because it was built up over time — a genuine restore from version
  // control would have produced a broken system, and nobody would find out until they needed it.
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'));
  const missing = files.filter((f) => !listed.includes(f));
  assert.deepStrictEqual(missing, [],
    'these migrations would never run: ' + missing.join(', '));
});

test('the order lists nothing that does not exist', () => {
  const gone = listed.filter((f) => !fs.existsSync(path.join(DIR, f)));
  assert.deepStrictEqual(gone, [], 'listed but missing: ' + gone.join(', '));
});

test('foundations come before the things that reference them', () => {
  const at = (f) => listed.indexOf(f);
  assert.ok(at('050_recover_untracked_tables.sql') >= 0);
  // users, then the marketplace tables, then everything that indexes or alters them.
  assert.ok(at('050_recover_untracked_tables.sql') < at('004_marketplace_schema.sql'));
  assert.ok(at('004_marketplace_schema.sql') < at('000_recovered_schema_baseline.sql'));
  assert.ok(at('004_marketplace_schema.sql') < at('023_concept_brief.sql'));
});

test('the runner creates extensions and stops on a real failure', () => {
  const sh = fs.readFileSync('scripts/migrate.sh', 'utf8');
  // uuid_generate_v4() is used by the earliest tables and is not built in.
  assert.match(sh, /CREATE EXTENSION IF NOT EXISTS "uuid-ossp"/);
  assert.match(sh, /ON_ERROR_STOP=1/);
  // A half-built schema that looks fine until something reads a missing table is the failure here.
  assert.match(sh, /do not treat this as a restore/);
});

test('the reason is written down where the next person will look', () => {
  assert.match(flat(order), /Filename order does not work and never did/i);
});
