'use strict';
// SOMEBODY ELSE'S TEAM, ON YOUR OWN ACCOUNT (17 September 2026).
//
// The owner's rule: a team member makes their own YP Labs account, is held to what the owner allowed,
// and keeps their own work separate. Anyone who already has an account can be added to a team.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const team = fs.readFileSync('src/routes/team.js', 'utf8');
const auth = fs.readFileSync('src/routes/auth.js', 'utf8');
const mail = fs.readFileSync('src/services/pennyEmails.js', 'utf8');

test('being added tells them, and says plainly when it could not', () => {
  assert.match(team, /const msg = teamInviteEmail\(/);
  assert.match(team, /invited = sent && sent\.sent \? 'told' : 'not_told'/);
  assert.match(team, /I could not email them, so nobody has been/);
  // Adding somebody was silent before: a row appeared and the person never heard.
  assert.match(team, /Adding somebody used to be silent/);
});

test('nobody is signed up by somebody else, and the seat links when they register', () => {
  const { teamInviteEmail } = require('../src/services/pennyEmails');
  const m = teamInviteEmail({ name: 'Sam Rivera', ownerName: 'Dana', businessName: 'Rivera Landscaping',
    areas: ['documents: see'], hasAccount: false });
  assert.match(m.text, /Your account is yours, not theirs/);
  assert.match(m.text, /Create your account/);
  assert.match(m.text, /only see and do what Dana allowed/);
  assert.match(m.text, /Anything you do for yourself is separate and stays with you/);
  assert.match(mail, /Nobody is signed up by somebody else/);
  // And the seat becomes real on registration rather than staying an orphan row.
  assert.match(auth, /UPDATE relationships SET user_id = \$1\s*\n\s*WHERE user_id IS NULL AND ended_on IS NULL AND lower\(email\) = lower\(\$2\)/);
  assert.match(auth, /somebody was invited, signed up,\n\s*\/\/ and found nothing there/);
});

test('someone who already has an account is told it is on their existing one', () => {
  const { teamInviteEmail } = require('../src/services/pennyEmails');
  const m = teamInviteEmail({ name: 'Sam', ownerName: 'Dana', businessName: 'Rivera Landscaping', hasAccount: true });
  assert.match(m.text, /Sign in as you normally would/);
  assert.match(m.text, /alongside your own/);
});

test('a shared business is theirs to work in, and their own stays their own', () => {
  const perms = fs.readFileSync('src/lib/permissions.js', 'utf8');
  // One query returns both, marked, so nothing of theirs is mixed up with the owner's.
  assert.match(perms, /\(b\.owner_id = \$1\) AS is_owner/);
  assert.match(perms, /EXISTS \(SELECT 1 FROM relationships r/);
  assert.match(perms, /ORDER BY \(b\.owner_id = \$1\) DESC/);
});
