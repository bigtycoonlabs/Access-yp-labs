'use strict';
// WHERE FORWARDED MAIL ARRIVES.
//
// Called by the mail provider, not by a person, so it authenticates with a shared secret rather than
// a session. Without INBOUND_SECRET set it refuses everything: an open endpoint that writes into
// people's business records is worse than a feature that is switched off.
//
// What arrives is a stranger's text landing inside somebody's records. It is stored as data and
// never treated as instruction, by this route or by Penny when she reads it back.

const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../lib/http');
const Inbox = require('../services/clay/inbox');

const router = express.Router();

// TWO WAYS IN, BOTH PROVING THE SENDER.
//
// A shared secret for anything that can set a header, and a signed payload for providers that sign
// instead — Resend signs in the Svix scheme and cannot be told to add a header, so a shared secret
// alone would have meant either an open endpoint or a feature that never receives anything.
function sameSecret(got, want) {
  if (!want || !got) return false;
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(want));
  // Constant time, so the secret cannot be found one character at a time.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The signature covers the id, the timestamp and the exact bytes received, which is why the body is
// read raw: re-serialising parsed JSON changes the bytes and every signature would fail.
function signedByProvider(req, raw) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret || !raw) return false;
  const id = req.get('svix-id') || req.get('webhook-id');
  const ts = req.get('svix-timestamp') || req.get('webhook-timestamp');
  const sigHeader = req.get('svix-signature') || req.get('webhook-signature');
  if (!id || !ts || !sigHeader) return false;
  // An old payload replayed is not a new message. Five minutes either way, as the scheme specifies.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key)
    .update(id + '.' + ts + '.' + raw.toString('utf8')).digest('base64');
  // The header can carry several versioned signatures; any one matching is enough.
  return String(sigHeader).split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    return sameSecret(sig, expected);
  });
}

function authorised(req, raw) {
  return sameSecret(req.get('x-inbound-secret') || req.query.secret, process.env.INBOUND_SECRET)
    || signedByProvider(req, raw);
}

// Providers disagree about field names, so take the common shapes rather than one vendor's.
function pick(body, names) {
  for (const n of names) {
    const v = n.split('.').reduce((o, k) => (o == null ? o : o[k]), body);
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) {
      const first = v[0];
      if (typeof first === 'string') return first.trim();
      if (first && typeof first.address === 'string') return first.address.trim();
      if (first && typeof first.email === 'string') return first.email.trim();
    }
  }
  return null;
}

// Raw, then parsed here, because a signature is over bytes rather than over an object.
router.post('/email', express.raw({ type: '*/*', limit: '2mb' }), asyncHandler(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : null;
  if (!authorised(req, raw)) {
    // Says nothing about why: an endpoint that explains its own auth to a stranger is a hint.
    return res.status(401).json({ ok: false });
  }
  let b;
  try { b = raw ? JSON.parse(raw.toString('utf8')) : (req.body || {}); } catch (_) {
    return res.status(400).json({ ok: false, error: 'That payload was not JSON, so nothing was stored.' });
  }
  // Providers wrap the message in their own envelope; ours is whichever of these is present.
  if (b && b.data && typeof b.data === 'object') b = Object.assign({}, b, b.data);
  const to = pick(b, ['to', 'To', 'recipient', 'envelope.to', 'data.to']);
  const from = pick(b, ['from', 'From', 'sender', 'envelope.from', 'data.from']);
  const subject = pick(b, ['subject', 'Subject', 'data.subject']) || '';
  const text = pick(b, ['text', 'plain', 'body-plain', 'data.text', 'html', 'data.html']) || '';
  const messageId = pick(b, ['message_id', 'messageId', 'Message-Id', 'data.message_id']);
  if (!to) return res.status(400).json({ ok: false, error: 'No recipient address in that payload, so nothing was stored.' });

  const out = await Inbox.receive({ to, from, from_name: pick(b, ['from_name', 'data.from_name']),
    subject, text, message_id: messageId });
  if (!out.ok) {
    // An address nobody owns is not an error worth retrying, so it is accepted and dropped.
    return res.json({ ok: true, stored: false, reason: 'no_such_address' });
  }
  res.json({ ok: true, stored: !out.duplicate, duplicate: !!out.duplicate });
}));

module.exports = router;
