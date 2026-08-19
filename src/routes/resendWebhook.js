// DID THE EMAIL ACTUALLY ARRIVE.
//
// The platform records email_status 'accepted', which means the provider took the message. It has
// never meant delivery, and until this file existed the platform had no way to learn the difference.
// A bounce was invisible: somebody's address could be dead for months and every notification would
// still read "accepted" forever.
//
// Resend signs webhooks with Svix. The signature covers `svix-id.svix-timestamp.body`, HMAC-SHA256,
// keyed with the secret after its whsec_ prefix, base64-decoded.
//
// TWO THINGS THIS FILE MUST NOT DO:
//
//   Trust an unsigned request. Anything reaching this endpoint can mark somebody's email delivered
//   or bounced, which means it can hide a real bounce. Unverified requests are refused, and if no
//   secret is configured the endpoint refuses EVERYTHING rather than accepting on trust — an
//   unconfigured webhook that silently believes whatever it is told is worse than none.
//
//   Report success it did not achieve. An event for an email this platform has no record of is
//   answered honestly and recorded nowhere.

const crypto = require('crypto');
const { query } = require('../config/db');

// What each Resend event means for a notification we sent.
//
// 'delivered' is the only one that means it arrived. 'sent' from Resend is the provider's own
// hand-off event and deliberately does NOT upgrade our status — that is the exact conflation this
// whole change exists to remove.
const OUTCOME = {
  'email.delivered': { status: 'delivered', reason: null },
  'email.bounced': { status: 'bounced', reason: 'the address bounced' },
  'email.complained': { status: 'complained', reason: 'marked as spam by the recipient' },
  'email.delivery_delayed': { status: 'delayed', reason: 'the provider is still trying' },
  'email.failed': { status: 'failed', reason: 'the provider could not deliver it' },
};

// Constant-time compare over a list of candidate signatures. Svix sends space-separated versioned
// signatures and any one matching is valid.
function signatureMatches(header, expected) {
  const want = Buffer.from(expected);
  return String(header || '').split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    const got = Buffer.from(sig || '');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  });
}

function verify(req, raw) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // No secret means refuse everything. An endpoint that accepts on trust when unconfigured is a
  // hole that opens quietly the moment somebody forgets an environment variable.
  if (!secret) return { ok: false, reason: 'no_secret_configured' };

  const id = req.get('svix-id');
  const ts = req.get('svix-timestamp');
  const sig = req.get('svix-signature');
  if (!id || !ts || !sig) return { ok: false, reason: 'unsigned' };

  // Reject anything older than five minutes, so a captured request cannot be replayed later.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: 'stale_timestamp' };

  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key)
    .update(id + '.' + ts + '.' + raw).digest('base64');

  return signatureMatches(sig, expected)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}

async function resendWebhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');

  const v = verify(req, raw);
  if (!v.ok) {
    console.error('resend webhook refused:', v.reason);
    return res.status(401).json({ ok: false, error: 'Not verified.' });
  }

  let event;
  try { event = JSON.parse(raw); } catch (e) {
    return res.status(400).json({ ok: false, error: 'Body was not readable JSON.' });
  }

  const outcome = OUTCOME[event && event.type];
  // An event we do not act on is still a valid event. 200 so the provider stops retrying, and no
  // record written, because we did nothing.
  if (!outcome) return res.json({ ok: true, ignored: event && event.type });

  const providerId = event && event.data && event.data.email_id;
  if (!providerId) return res.json({ ok: true, ignored: 'no email id on the event' });

  try {
    const r = await query(
      `UPDATE notifications
          SET email_status=$2, email_reason=COALESCE($3, email_reason)
        WHERE email_provider_id=$1
        RETURNING id, user_id`,
      [providerId, outcome.status, outcome.reason]);

    // An event for an email this platform has no record of. Answered honestly and recorded nowhere,
    // rather than inventing a row to make the numbers look complete.
    if (!r.rows.length) return res.json({ ok: true, matched: false });

    // A bounce or a complaint is worth knowing about beyond one row, because it means this person
    // is not receiving anything from us and every future notification will silently miss them.
    if (outcome.status === 'bounced' || outcome.status === 'complained') {
      console.error('resend webhook: %s for user %s (%s)',
        outcome.status, r.rows[0].user_id, providerId);
    }
    return res.json({ ok: true, matched: true, status: outcome.status });
  } catch (e) {
    // 500 so the provider retries. Swallowing this would lose a bounce permanently.
    console.error('resend webhook: could not record', e && e.message);
    return res.status(500).json({ ok: false, error: 'Could not record that.' });
  }
}

module.exports = { resendWebhook, OUTCOME, verify };
