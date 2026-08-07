'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

// EVERY TABLE THE CODE QUERIES MUST BE CREATED BY A MIGRATION.
//
// Thirteen tables existed in production and nowhere in version control — including `users`,
// `site_pages`, `store_products` and `stripe_events`. Restoring this platform from the repository
// would have produced a system with no user table: not degraded, unable to start.
//
// It survived because every test ran against a database built up by hand over time rather than from
// these files, so the missing pieces were always already there. The homepage was ALREADY calling a
// 500ing endpoint in production for exactly this reason, and no test noticed.

const migrations = fs.readdirSync('docs/migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync('docs/migrations/' + f, 'utf8'))
  .join('\n');

const created = new Set(
  [...migrations.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:yp_labs\.)?([a-z_]+)/gi)]
    .map((m) => m[1].toLowerCase()));

function sourceFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = dir + '/' + e.name;
    if (e.isDirectory()) sourceFiles(full, acc);
    else if (e.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

test('every table the code reads or writes is created by a migration', () => {
  // Only look inside actual SQL — backtick strings containing a SQL verb — and strip comments
  // first. Scanning raw source matches English prose: "from another", "into building", "update the
  // list" all look like table references and drown the real signal.
  const referenced = new Set();
  for (const file of sourceFiles('src')) {
    const raw = fs.readFileSync(file, 'utf8')
      .replace(/\/\/[^\n]*/g, ' ')           // line comments
      .replace(/\/\*[\s\S]*?\*\//g, ' ');    // block comments
    for (const q of raw.matchAll(/[`'"]([^`'"]*(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)[^`'"]*)[`'"]/gis)) {
      for (const m of q[1].matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+(?:yp_labs\.)?([a-z_]{3,})\b/gi)) {
        referenced.add(m[1].toLowerCase());
      }
    }
  }
  // Postgres internals and SQL keywords that follow FROM/JOIN but are not our tables.
  const notOurs = new Set(['information_schema', 'pg_catalog', 'pg_constraint', 'pg_class',
    'pg_namespace', 'pg_indexes', 'pg_db_role_setting', 'select', 'unnest', 'generate_series',
    'lateral', 'values', 'json_array_elements', 'jsonb_array_elements', 'set', 'columns', 'tables',
    'pg_enum', 'pg_type', 'false', 'true', 'real', 'this', 'what', 'null']);

  const missing = [...referenced].filter((t) => !created.has(t) && !notOurs.has(t)).sort();
  assert.deepStrictEqual(missing, [],
    'the code uses these tables but no migration creates them:\n  ' + missing.join('\n  '));
});

test('the tables that were missing are now tracked', () => {
  // Named explicitly, so removing the recovery migration fails loudly rather than silently.
  ['users', 'visitors', 'stripe_events', 'site_pages', 'site_domains', 'store_products',
   'store_orders', 'image_generations', 'concept_image_credits', 'login_activity',
   'staff_invites', 'discount_codes', 'service_catalog'].forEach((t) => {
    assert.ok(created.has(t), t + ' must be created by a migration');
  });
});
