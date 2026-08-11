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

test('every migration runs with the schema on its search path', () => {
  // Each file runs in its own psql process, and only 004 contains `SET search_path`. A SET lasts for
  // one session, so the other 53 files ran with the default path. Thirteen of them do not qualify
  // their table names, so on a genuine restore twelve failed outright — `concepts.brief`,
  // `concepts.launch_page`, `movement_state`, site_pages, site_domains, the enterprise tables and
  // the store tables were all absent — and `stripe_events` was created in `public` instead.
  //
  // The table count still came to 68, which is why this passed inspection: the number the restore
  // was checked against was right while the schema was wrong. Counting tables is not checking a
  // restore, and "I registered a user against it" only exercises the part that happened to work.
  const sh = fs.readFileSync('scripts/migrate.sh', 'utf8');
  assert.match(sh, /PGOPTIONS="--search_path=yp_labs,public"/,
    'the runner must put yp_labs on the search path for every migration, not just the one that sets it');
});

test('the reason is written down where the next person will look', () => {
  assert.match(flat(order), /Filename order does not work and never did/i);
});
