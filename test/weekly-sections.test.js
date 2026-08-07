'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const sections = require('../src/services/clay/weeklySections');
const weekly = fs.readFileSync(require.resolve('../src/services/clay/weekly.js'), 'utf8');
const pages = fs.readFileSync(require.resolve('../src/routes/weeklyPages.js'), 'utf8');

test('the magazine prints dreamer tags, never real names', () => {
  // It read u.name, so a publication that goes to every account and is posted publicly was printing
  // people's actual first and last names. The worst possible place for that rule to break.
  assert.match(weekly, /COALESCE\(NULLIF\(u\.display_name,''\), 'A creator'\)/);
  assert.match(weekly, /COALESCE\(NULLIF\(u\.display_name,''\), 'A Dream Mover'\)/);
  assert.match(flat(weekly), /THE DREAMER TAG, NEVER THE REAL NAME/i);
});

test('the top dreamer is measured on turning up, not on achieving', () => {
  // Someone with no sale, no listing and no audience can be the most active person here, and saying
  // so is the point. It must never say what they are building.
  const src = fs.readFileSync(require.resolve('../src/services/clay/weeklySections.js'), 'utf8');
  assert.match(src, /days_here/);
  assert.match(src, /display_name/);
  assert.ok(!/c\.title/.test(src.split('async function topDreamer')[1].split('}')[0] || ''),
    'the dreamer section never names a project');
});

test('the term of the week is stable for a given week', () => {
  // An issue rebuilt for the same week must produce the same term, not a different one each time.
  assert.strictEqual(sections.termForWeek('2026-08-03').term, sections.termForWeek('2026-08-03').term);
  assert.notStrictEqual(sections.termForWeek('2026-08-03').term, sections.termForWeek('2026-08-10').term);
  assert.ok(sections.TERMS.length >= 10);
});

test('outside news is sourced or absent — never invented', () => {
  // A magazine that invents a regulatory change is worse than a short one: a reader might act on it.
  const src = fs.readFileSync(require.resolve('../src/services/clay/weeklySections.js'), 'utf8');
  assert.match(src, /filter\(\(r\) => r && r\.url/);
  assert.match(flat(src), /if the search finds nothing usable, this section does not appear/i);
  assert.match(src, /reason: 'nothing_sourced'/);
});

test('the editorial stance is pointed at institutions, never at people', () => {
  assert.match(weekly, /failure of imagination/i);
  assert.match(weekly, /NOT allowed to be smug/i);
  assert.match(flat(weekly), /mockery that needs our own numbers inflated is just a lie with a joke on top/i);
});

test('what a reader sees is what was approved', () => {
  // Sections are stored WITH the issue rather than recomputed at render, when the week's numbers
  // would already have moved on.
  assert.match(weekly, /best_reads: best\.map/);
  assert.match(pages, /Array\.isArray\(h\.best_reads\)/);
  assert.match(pages, /Five worth your time/);
});

test('an issue can be sent back, rewritten, or deleted', () => {
  // The workflow only went forwards — compose, approve, publish, send — so a draft you disliked sat
  // there permanently and the only way onward was publishing it.
  assert.match(weekly, /async function reject/);
  assert.match(weekly, /async function recompose/);
  assert.match(weekly, /async function remove/);
  const routes = fs.readFileSync(require.resolve('../src/routes/weekly.js'), 'utf8');
  assert.match(routes, /router\.post\('\/:id\/reject'/);
  assert.match(routes, /router\.post\('\/:id\/recompose'/);
  assert.match(routes, /router\.delete\('\/:id'/);
});

test('a SENT issue cannot be unsent, rewritten away, or deleted', () => {
  // You cannot unsend a magazine, and erasing one people received would leave the archive lying.
  // Each of the three functions must carry its own guard. Counting occurrences file-wide would also
  // catch the pre-existing send guard, so check inside each function body instead.
  ['reject', 'recompose', 'remove'].forEach((fn) => {
    const start = weekly.indexOf('async function ' + fn + '(');
    assert.ok(start > -1, fn + ' exists');
    const body = weekly.slice(start, start + 1400);
    assert.match(body, /already_sent/, fn + ' must refuse a sent issue');
  });
  assert.match(weekly, /they have it/i);
  assert.match(flat(weekly), /erasing it would leave the archive lying/i);
});

test('the magazine does not sign off with anyone name', () => {
  // It closed '— Clay', and the lines above printed real names, so an issue ended with a signature
  // and somebody's actual name under it. A magazine is not a letter.
  const issueEmail = weekly.slice(weekly.indexOf('Read this week\'s issue: ${url}'), weekly.indexOf('List-Unsubscribe'));
  assert.ok(!/— Clay/.test(issueEmail), 'no sign-off in the issue email');
  assert.match(flat(weekly), /A magazine is not a letter/i);
});
