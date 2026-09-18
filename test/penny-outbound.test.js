'use strict';
// EMAIL SENT FOR SOMEBODY (17 September 2026). The owner's rule: anything leaving the business needs
// a human to say yes.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const W = require('../src/services/clay/workspace');
const S = require('../src/services/clay/standing');
const out = fs.readFileSync('src/services/clay/outbound.js', 'utf8').replace(/\/\//g, ' ').replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');

test('nothing leaves the business without a yes, and never on a schedule', () => {
  assert.strictEqual(W.TOOLS.send_email.requires_confirmation, true);
  assert.strictEqual(W.TOOLS.send_email.irreversible, true);
  assert.ok(W.TOOLS.send_email.ask.includes('cannot be taken back'));
  assert.ok(!S.UNATTENDED_TOOLS().includes('send_email'), 'a standing job must never email anybody');
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(penny, /only ever after they have read the exact words and said yes/);
  assert.match(penny, /never send one on your own initiative, and never on a schedule/);
});

test('it goes out as Penny with their address to reply to, and says who it is for', () => {
  assert.match(out, /replyTo: viewer\.email/);
  assert.match(out, /Sent by Penny, the assistant for/);
  assert.match(out, /Faking somebody's own address would be a lie to the recipient/);
});

test('sent means the mail service took it, and a failure says nobody received it', () => {
  assert.match(out, /const went = !!\(out && out\.sent\)/);
  assert.match(out, /That did not send, so nobody has received it/);
  assert.match(out, /It is never recorded as sent on hope/);
  assert.match(out, /INSERT INTO email_log/);
});

test('a mistake cannot become a hundred while they sleep', () => {
  assert.match(out, /const MAX_PER_DAY = 25/);
  assert.match(out, /so a mistake cannot become a hundred mistakes while you are asleep/);
  assert.match(out, /That is not an email address I can send to, so nothing went/);
});

test('paperwork with dates in it becomes things they owe', () => {
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(penny, /read it and pull out what it commits them to/);
  assert.match(penny, /Record each one so it appears in what they owe/);
  assert.match(penny, /If the document does not say when something is due, say that rather than choosing a date/);
});
