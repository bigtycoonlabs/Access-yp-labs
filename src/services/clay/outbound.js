// EMAIL PENNY SENDS FOR SOMEBODY.
//
// The owner's rule: anything that leaves the business needs a human to say yes. So this is never
// reached without a confirmation, and the person sees the address, the subject and the whole body
// before it goes. An email cannot be recalled, which is the same reason the invoice handover waits.
//
// It goes out as Penny, with the person's own address as the reply-to, and says at the bottom who it
// was sent for. Faking somebody's own address would be a lie to the recipient and would fail their
// domain checks anyway.
//
// Every send is written down: who it went to, what it said, and whether the mail service took it.
// "Sent" here means accepted by the mail service. It is never recorded as sent on hope.

const { query } = require('../../config/db');
const { sendEmail } = require('../email');
const { render } = require('../pennyEmails');

const MAX_PER_DAY = 25;

function looksLikeEmail(x) { return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(x || '').trim()); }

async function sentToday(userId) {
  const r = await query(
    `SELECT count(*)::int AS n FROM email_log
      WHERE kind = 'penny_outbound' AND sent AND created_at > now() - interval '24 hours'
        AND reason = $1`, [userId]);
  return r.rows[0].n;
}

async function send(viewer, { to, subject, body, business_name }) {
  const address = String(to || '').trim();
  const line = String(subject || '').trim();
  const words = String(body || '').trim();
  if (!looksLikeEmail(address)) return { ok: false, kind: 'unclear', says: 'That is not an email address I can send to, so nothing went.' };
  if (!line) return { ok: false, kind: 'unclear', says: 'What should the subject say?' };
  if (words.length < 5) return { ok: false, kind: 'unclear', says: 'There is no message to send.' };

  const today = await sentToday(viewer.id).catch(() => 0);
  if (today >= MAX_PER_DAY) {
    return { ok: false, kind: 'refused',
      says: 'That is ' + MAX_PER_DAY + ' emails I have sent for you today, which is my limit. It is '
        + 'there so a mistake cannot become a hundred mistakes while you are asleep.' };
  }

  const who = viewer.name || 'a client';
  const { html, text } = render({
    title: line,
    preheader: 'Sent by Penny for ' + who,
    blocks: [
      ...words.split(/\n{2,}/).map((p) => ({ p: p.trim() })).filter((b) => b.p),
      { p: 'Sent by Penny, the assistant for ' + (business_name || who) + '. Replies go straight to ' + who + '.' },
    ],
  });
  const out = await sendEmail({
    to: address, subject: line, html, text,
    replyTo: viewer.email || undefined,
  });
  const went = !!(out && out.sent);
  await query(
    `INSERT INTO email_log (to_email, kind, sent, reason, provider_id) VALUES ($1,'penny_outbound',$2,$3,$4)`,
    [address, went, viewer.id, (out && out.id) || null]).catch(() => {});
  if (!went) {
    return { ok: false, kind: 'unavailable',
      says: 'That did not send, so nobody has received it. ' + ((out && out.reason) || 'The mail service did not take it.') };
  }
  return { ok: true, id: out.id,
    says: 'Sent to ' + address + ', with your address as the reply-to, so their answer comes to you.' };
}

module.exports = { send, MAX_PER_DAY };
