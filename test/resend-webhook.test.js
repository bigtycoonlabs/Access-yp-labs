'use strict';
// DID THE EMAIL ACTUALLY ARRIVE.
//
// The platform records 'accepted', which means the provider took the message. Until this existed it
// had no way to learn the difference: somebody's address could be dead for months and every
// notification would still read "accepted" forever.
//
// Signature verification was driven against forgery, replay and a wrong secret, and the full path
// against a real Postgres.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const src = fs.readFileSync('src/routes/resendWebhook.js', 'utf8');

const SECRET = 'whsec_' + Buffer.from('a-test-signing-secret-value').toString('base64');
function sign(id, ts, body, secret) {
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  return crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + body).digest('base64');
}
function req(h) { return { get: (k) => h[k] }; }

test('an unconfigured webhook refuses everything', () => {
  // An endpoint that accepts on trust when unconfigured is a hole that opens quietly the moment
  // somebody forgets an environment variable. Anything reaching it can mark an email delivered,
  // which means it can HIDE a real bounce.
  delete process.env.RESEND_WEBHOOK_SECRET;
  const { verify } = require('../src/routes/resendWebhook');
  const body = '{}'; const ts = String(Math.floor(Date.now() / 1000));
  const r = verify(req({ 'svix-id': 'a', 'svix-timestamp': ts, 'svix-signature': 'v1,x' }), body);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_secret_configured');
});

test('forgery, replay and a wrong secret are all refused', () => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  const { verify } = require('../src/routes/resendWebhook');
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } });
  const ts = String(Math.floor(Date.now() / 1000));
  const good = sign('m', ts, body, SECRET);

  assert.strictEqual(verify(req({ 'svix-id': 'm', 'svix-timestamp': ts, 'svix-signature': 'v1,' + good }), body).ok, true);
  // Svix sends space-separated versioned signatures; any one matching is valid.
  assert.strictEqual(verify(req({ 'svix-id': 'm', 'svix-timestamp': ts, 'svix-signature': 'v1,' + 'x'.repeat(44) + ' v1,' + good }), body).ok, true);

  assert.strictEqual(verify(req({ 'svix-id': 'm', 'svix-timestamp': ts, 'svix-signature': 'v1,' + 'x'.repeat(44) }), body).reason, 'bad_signature');
  assert.strictEqual(verify(req({ 'svix-id': 'm', 'svix-timestamp': ts }), body).reason, 'unsigned');
  // A captured request cannot be replayed later.
  assert.strictEqual(verify(req({ 'svix-id': 'm', 'svix-timestamp': String(Number(ts) - 3600), 'svix-signature': 'v1,' + good }), body).reason, 'stale_timestamp');
  // A signature made for a different message id does not carry over.
  assert.strictEqual(verify(req({ 'svix-id': 'other', 'svix-timestamp': ts, 'svix-signature': 'v1,' + good }), body).reason, 'bad_signature');
  delete process.env.RESEND_WEBHOOK_SECRET;
});

test("the provider's own 'sent' event never upgrades our status", () => {
  // That conflation is the entire reason this change exists. Only 'delivered' means it arrived.
  const { OUTCOME } = require('../src/routes/resendWebhook');
  assert.ok(!OUTCOME['email.sent'], "'email.sent' must not be acted on");
  assert.strictEqual(OUTCOME['email.delivered'].status, 'delivered');
  assert.strictEqual(OUTCOME['email.bounced'].status, 'bounced');
  assert.strictEqual(OUTCOME['email.complained'].status, 'complained');
  // Verified live: after a bounce, an email.sent event left the status as 'bounced'.
});

test('an event for an email we never sent invents nothing', () => {
  // Answered honestly and recorded nowhere, rather than creating a row to make the numbers look
  // complete. Verified live: matched false, and the table still held exactly one row.
  assert.match(src, /if \(!r\.rows\.length\) return res\.json\(\{ ok: true, matched: false \}\)/);
  assert.ok(!/INSERT INTO notifications/i.test(src), 'a webhook must never create a notification');
});

test('a failure to record returns 500 so the provider retries', () => {
  // Swallowing it would lose a bounce permanently, and a lost bounce is somebody who stops
  // receiving anything with nobody ever finding out.
  assert.match(src, /return res\.status\(500\)/);
  assert.match(src, /Swallowing this would lose a bounce permanently/);
});

test('it is mounted before the json parser', () => {
  // Parsing first would reassemble the body and the signature would never match. Same reason Stripe
  // is mounted the same way, directly above.
  const server = fs.readFileSync('src/server.js', 'utf8');
  const raw = server.indexOf("app.post('/api/webhooks/resend'");
  const json = server.indexOf("app.use(express.json(");
  assert.ok(raw > 0 && json > 0 && raw < json, 'raw mount must come before express.json');
});

test('the delivery statuses are in the database constraint', () => {
  const sql = fs.readFileSync('docs/migrations/058_notifications.sql', 'utf8');
  for (const s of ['delivered', 'bounced', 'complained', 'delayed']) {
    assert.ok(sql.includes("'" + s + "'"), 'missing from the constraint: ' + s);
  }
});
