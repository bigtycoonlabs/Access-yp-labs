'use strict';
// EVERY EMAIL THIS PLATFORM SENDS CAN BE REPLIED TO BY A PERSON.
//
// Receiving is disabled on every domain on the Resend account, so a reply to any from-address here
// vanishes. The owner set the destination on 16 Sept 2026: success@accessyourplace.com. These drive
// the actual senders with a captured fetch, rather than reading the source, so a sender that forgets
// the field fails here.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../src/services/email');

function capture() {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => (url.endsWith('/batch') ? { data: [{ id: 'a' }, { id: 'b' }] } : { id: 'x' }) };
  };
  return calls;
}

test('the reply address is the Success Team', () => {
  assert.strictEqual(E.REPLY_TO, 'success@accessyourplace.com');
});

test('a single send carries it', async () => {
  const saved = [global.fetch, process.env.RESEND_API_KEY];
  process.env.RESEND_API_KEY = 'test';
  const calls = capture();
  try {
    const r = await E.sendEmail({ to: 'a@example.test', subject: 's', html: '<p>h</p>', text: 't' });
    assert.strictEqual(r.sent, true);
    assert.strictEqual(calls[0].body.reply_to, 'success@accessyourplace.com');
  } finally { global.fetch = saved[0]; process.env.RESEND_API_KEY = saved[1]; }
});

test('every email in a batch carries it', async () => {
  const saved = [global.fetch, process.env.RESEND_API_KEY];
  process.env.RESEND_API_KEY = 'test';
  const calls = capture();
  try {
    await E.sendBatch([{ to: 'a@example.test', subject: 's', text: 't' },
      { to: 'b@example.test', subject: 's', text: 't' }]);
    assert.strictEqual(calls[0].body.length, 2);
    calls[0].body.forEach((m) => assert.strictEqual(m.reply_to, 'success@accessyourplace.com'));
  } finally { global.fetch = saved[0]; process.env.RESEND_API_KEY = saved[1]; }
});
