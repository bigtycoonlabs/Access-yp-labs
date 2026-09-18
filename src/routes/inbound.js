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

function authorised(req) {
  const want = process.env.INBOUND_SECRET;
  if (!want) return false;
  const got = String(req.get('x-inbound-secret') || req.query.secret || '');
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  // Constant time, so the secret cannot be found one character at a time.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

router.post('/email', express.json({ limit: '2mb' }), asyncHandler(async (req, res) => {
  if (!authorised(req)) {
    // Says nothing about why: an endpoint that explains its own auth to a stranger is a hint.
    return res.status(401).json({ ok: false });
  }
  const b = req.body || {};
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
