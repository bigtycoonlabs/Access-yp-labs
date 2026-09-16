'use strict';
// WHY THE REMINDERS ARE NOT ON TODAY, WHICH LOOKS LIKE A GAP AND IS NOT.
//
// The sweep writes an obligation_due notification and no Penny Desk page reads it. That is the same
// shape as three real defects already found here — the rule engine nothing called, the three dead
// links, the due dates nothing acted on — so it looks like a fourth.
//
// I built it. A "Since you were last here" panel above Today, reading unread obligation_due
// notifications. It rendered correctly, was announced correctly, and was wrong:
//
//   Since you were last here
//     City licence renewal is due in 6 days
//     Missing it costs $75 and it is due in 6 days. Trading without one.
//
//   Today
//     One thing needs you. The one that costs most is City licence renewal at $75.
//     City licence renewal — Missing it costs $75 and it is due in 6 days...
//
// The same obligation, twice, on one screen. Exactly the duplication removed from "Coming up" a few
// commits earlier, recreated somewhere new.
//
// Filtering does not save it. Reminders only fire within 30 days and Today's horizon is 45, so every
// reminder is for something Today is already showing. The panel could only ever be empty or
// redundant.
//
// THE POINT OF THE NOTIFICATION IS TO REACH SOMEBODY WHO IS NOT LOOKING AT THE APP. Once they open
// it, Today IS the answer — ranked by what missing each thing costs, which is strictly better than
// the same items again in the order they happened to be warned about.
//
// So it was reverted. Recorded here because the absence looks like an oversight and would otherwise
// be "fixed" by the next person, and because a list that repeats itself is how a list stops being
// read — which is the one thing this product cannot afford.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

test('Today does not repeat what the reminder already said', () => {
  const today = fs.readFileSync('public/today.html', 'utf8');
  assert.ok(!/obligation_due/.test(today),
    'Today should not render reminders — it already shows the obligations they are about');
  assert.ok(!/Since you were last here/.test(today));
});

test('the notification is still written, because email is what it is for', () => {
  // The row exists so the sweep can dedupe and so the email has something behind it. It is not
  // dead — it is simply not a second list.
  const sweep = fs.readFileSync('src/services/clay/dueSweep.js', 'utf8');
  assert.match(sweep, /INSERT INTO notifications/);
  const server = fs.readFileSync('src/server.js', 'utf8');
  assert.match(server, /const pennySend = process\.env\.RESEND_API_KEY \? makeSender\(\) : null/);
});

test('Today remains the one ranked answer', () => {
  const today = fs.readFileSync('public/today.html', 'utf8');
  assert.match(today, /\$\('summary'\)\.textContent = d\.summary;/);
  // And Coming up still excludes what Today already showed, for the same reason.
  assert.match(today, /COMING UP MEANS WHAT IS NOT ALREADY IN TODAY/);
});
