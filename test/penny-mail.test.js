'use strict';
// PENNY'S REMINDER EMAIL.
//
// The sweep wrote in-app notifications, which only reach somebody who opens the app — and the whole
// premise is reaching the person who does not.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/services/clay/pennyMail.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');
const M = require('../src/services/clay/pennyMail');

test('it sends from a domain that is actually verified', () => {
  // accessyplabs.com is verified and sending-enabled today; accesspennydesk.com is not live yet.
  // Deliberate and temporary — the retired brand is in the envelope and nowhere in the words.
  assert.match(M.FROM, /penny@accessyplabs\.com/);
  assert.match(src, /accesspennydesk\.com is not live yet/);
});

test('a reply reaches a person, and the email says so', () => {
  // Receiving is disabled on every Resend domain, so replies go to the Success Team mailbox, set by
  // the owner. The email names it, because nobody replies to an address they suspect is dead.
  assert.strictEqual(M.REPLY_TO, 'success@accessyourplace.com');
  const { text, html } = M.compose({ name: 'Sam', headline: 'x', body: 'y' });
  assert.match(text, /reaches the Success Team at success@accessyourplace\.com/);
  assert.match(html, /mailto:success@accessyourplace\.com/);
  assert.doesNotMatch(text + html, /does not take replies/);
});

test('no em-dash in what Penny sends', () => {
  const { text, html } = M.compose({ name: 'Sam', headline: 'x', body: 'y', businessName: 'Rivera' });
  assert.doesNotMatch(text + html, /\u2014|&mdash;/);
  assert.match(text, /x, for Rivera\./);
});

test('plain text is written first, not degraded out of HTML', () => {
  // Most reminder email is designed as HTML and stripped into text, which produces the
  // punctuation-less mess a screen reader actually receives.
  assert.match(src, /Plain text is written first/);
  const { text } = M.compose({ name: 'Sam Rivera', headline: 'FL annual report is due in 14 days',
    body: 'Missing it costs $400.', businessName: 'Night Rounds', dueAt: '2027-05-01T09:00:00Z' });
  assert.match(text, /^Hi Sam,/);
  assert.match(text, /FL annual report is due in 14 days, for Night Rounds\./);
  assert.match(text, /The date is 2027-05-01\./);
  assert.ok(!/<[a-z]/i.test(text), 'no markup leaked into the text part');
});

test('the link is a 44px target in the email too', () => {
  // It gets tapped in a van, not only read at a desk.
  const { html } = M.compose({ name: 'Sam', headline: 'x', body: 'y' });
  assert.match(html, /min-height:44px/);
});

test('a missing key is not treated as a successful send', () => {
  // Not configured is not the same as delivered.
  const send = M.makeSender({ apiKey: null });
  return assert.rejects(() => send({ to: 'a@b.test', headline: 'x', body: 'y' }),
    /is not set, so nothing was sent/);
});

test('a refused send throws with the reason the API gave', () => {
  // An earlier failure in this estate cost three rounds to diagnose because the 4xx body was never
  // logged. The body says why; it is included.
  const send = M.makeSender({
    apiKey: 'k',
    fetchImpl: async () => ({ ok: false, status: 422,
      json: async () => ({ message: 'domain not verified' }) }),
  });
  return assert.rejects(() => send({ to: 'a@b.test', headline: 'x', body: 'y' }),
    /Resend refused the send \(422\).*domain not verified/);
});

test('a clean send resolves, so the sweep may record it', () => {
  let sent = null;
  const send = M.makeSender({
    apiKey: 'k',
    fetchImpl: async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ id: '1' }) }; },
  });
  return send({ to: 'sam@example.test', name: 'Sam', headline: 'FL annual report is due in 14 days',
    body: 'Missing it costs $400.', obligation: { business_name: 'Night Rounds', due_at: '2027-05-01' } })
    .then(() => {
      assert.strictEqual(sent.from, M.FROM);
      assert.deepStrictEqual(sent.to, ['sam@example.test']);
      assert.strictEqual(sent.reply_to, M.REPLY_TO);
      assert.match(sent.subject, /FL annual report is due in 14 days/);
      assert.ok(sent.text && sent.html, 'both parts sent');
    });
});

test('the sweep is wired to it, and to nothing when there is no key', () => {
  // No key means the sweep records nothing rather than marking reminders as given.
  assert.match(server, /const pennySend = process\.env\.RESEND_API_KEY \? makeSender\(\) : null/);
  assert.match(server, /dueSweep\(\{ send: pennySend \}\)/);
  assert.match(server, /reminders will be in-app only/);
});
