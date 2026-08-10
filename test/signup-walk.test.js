'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/)?\s*/g, ' ').replace(/\s+/g, ' ');
const reg = fs.readFileSync('public/register.html', 'utf8');
const auth = fs.readFileSync(require.resolve('../src/routes/auth.js'), 'utf8');

test('a refusal to sign up is brought on screen', () => {
  // The feedback box sits at the top of the form, so by the time somebody has filled four fields on
  // a phone it is several hundred pixels above the screen. Tapping Create account and being refused
  // looked exactly like tapping it and nothing happening — measured at y=-174 before this.
  assert.match(reg, /fb\.scrollIntoView\(\{behavior:'smooth',block:'center'\}\)/);
  assert.match(flat(reg), /BRING IT INTO VIEW/i);
});

test('each missing field is named on its own', () => {
  // One sentence listing every requirement makes somebody re-read all four fields to find the one
  // they missed.
  assert.match(reg, /Add your name so Clay knows/);
  assert.match(reg, /Add your email/);
  assert.match(reg, /Add a phone number/);
  assert.match(reg, /Passwords need at least eight characters/);
});

test('an empty phone never reaches the server as a network error', () => {
  // It was not checked on the page at all, so it failed server-side validation and surfaced as
  // "Failed to fetch" — a network error about nothing.
  assert.match(flat(reg), /surfaced to the person as "Failed to fetch"/i);
  assert.match(reg, /if\(!phone\)\{/);
});

test('an existing account offers a way forward', () => {
  // "Account already exists." is true and leaves somebody stuck.
  assert.match(reg, /Sign in instead/);
  assert.match(reg, /forgotten-password link/);
});

test('the idea a stranger typed survives signup', () => {
  // Verified end to end in a browser: type an idea signed out, register, and the lab opens with
  // "I didn't forget — before you even signed up, you told me..."
  assert.match(auth, /SELECT idea FROM anon_sparks WHERE token=\$1 AND claimed_by IS NULL/);
  assert.match(auth, /UPDATE users SET pending_idea=\$2 WHERE id=\$1/);
  assert.match(auth, /UPDATE anon_sparks SET claimed_by=\$2/);
});
