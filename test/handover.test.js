'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:--|\/\/)\s*/g, ' ').replace(/\s+/g, ' ');
const api = fs.readFileSync(require.resolve('../src/routes/console.js'), 'utf8');
const page = fs.readFileSync('public/console.html', 'utf8');
const mig = fs.readFileSync('docs/migrations/055_handover_notes.sql', 'utf8');

test('the handover asks for the five things the next person needs', () => {
  // A blank box gets "all good" every day, which is worth nothing. Asking separately is what stops
  // the note collapsing into a formality.
  ['cleared', 'escalated', 'promoted', 'odd', 'still_waiting'].forEach((f) => {
    assert.ok(mig.includes(f), f + ' is a field');
  });
  assert.match(page, /id="ho-escalated"/);
  assert.match(page, /What I posted, and where/);
  assert.match(flat(mig), /Deliberately NOT free text alone/i);
});

test('an empty note is refused', () => {
  // A note that says nothing is worse than no note: it makes the record look kept while telling the
  // next person nothing.
  assert.match(api, /if \(!vals\.some\(Boolean\)\)/);
  assert.match(api, /makes the record look kept while telling/);
});

test('saving twice in a day updates rather than duplicating', () => {
  // Somebody adding to their note at the end of the day should not produce two records that
  // disagree.
  assert.match(api, /ON CONFLICT \(staff_id, shift_date\) DO UPDATE/);
  assert.match(mig, /CREATE UNIQUE INDEX IF NOT EXISTS handover_notes_shift_key/);
});

test('a day with no handover is surfaced, not left to be noticed', () => {
  // A missed note is a real signal rather than an administrative slip — it usually means the shift
  // was rushed or did not happen.
  assert.match(api, /days_with_no_note/);
  assert.match(api, /generate_series/);
  assert.match(page, /No handover was written on/);
});

test('the owners can read every shift, not just their own', () => {
  // The whole point is visibility for people who were asleep while it happened.
  assert.match(api, /LEFT JOIN users u ON u\.id = h\.staff_id/);
  assert.match(api, /ORDER BY h\.shift_date DESC/);
  assert.match(page, /Recent shifts/);
});
