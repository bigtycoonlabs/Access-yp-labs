// CLAY WEEKLY FOR PEOPLE WHO ARE NOT MEMBERS.
//
// The magazine is the only thing here that can reach a stranger on its own, and until now the only
// way to receive it was to register first — so the front door was locked from the inside. A
// subscriber gives a name and an email, gets the magazine, and owes us nothing else.
//
// Rules this holds to, because a lead-generation tool is exactly where they get bent:
//   * DOUBLE OPT-IN. Nobody is emailed a magazine until they have clicked to confirm. This protects
//     the person from being signed up by someone else, and protects our ability to send at all —
//     one spam complaint is worth more damage than a hundred addresses.
//   * SIGNING UP IS NOT AN ACCOUNT. A subscriber has no password and cannot sign in. Their row lives
//     in its own table so that nothing which assumes "a user can log in" is ever handed one.
//   * THE SAME ADDRESS TWICE IS NOT A NEW PERSON. Re-subscribing updates the existing row and
//     re-sends the confirmation. It never says "you are already on the list" to someone who has not
//     confirmed, because that tells a stranger whether an address is registered here.
//   * LEAVING IS ONE CLICK, no sign-in, no questions.

const crypto = require('crypto');
const { query } = require('../../config/db');
const { sendEmail } = require('../email');

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');
const token = () => crypto.randomBytes(24).toString('hex');
const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max);

// Deliberately permissive: rejecting a real address because of an unusual shape is a worse failure
// than accepting one that bounces once.
const looksLikeEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

async function subscribe({ email, firstName, lastName, source = 'homepage' } = {}) {
  const addr = clean(email, 200).toLowerCase();
  if (!looksLikeEmail(addr)) {
    return { ok: false, reason: 'bad_email', message: 'That does not look like an email address we can reach you on.' };
  }
  const first = clean(firstName, 80);
  const last = clean(lastName, 80);
  if (!first) {
    return { ok: false, reason: 'no_name', message: 'A first name, so Clay knows who he is writing to.' };
  }

  const confirm = token();
  const unsub = token();
  const r = await query(
    `INSERT INTO weekly_subscribers (email, first_name, last_name, confirm_token, unsub_token, source)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (lower(email)) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           last_name  = EXCLUDED.last_name,
           unsubscribed_at = NULL,
           -- SOMEONE WHO LEFT MUST OPT IN AGAIN. Clearing unsubscribed_at while keeping the old
           -- confirmation would put a person who deliberately left straight back on the list — and
           -- anyone could do it by typing their address into a public form. Their confirmation is
           -- dropped along with a fresh token, so they have to click again themselves.
           confirmed_at = CASE WHEN weekly_subscribers.unsubscribed_at IS NOT NULL
                               THEN NULL ELSE weekly_subscribers.confirmed_at END,
           confirm_token = CASE WHEN weekly_subscribers.unsubscribed_at IS NOT NULL
                                THEN EXCLUDED.confirm_token ELSE weekly_subscribers.confirm_token END,
           source = COALESCE(weekly_subscribers.source, EXCLUDED.source)
     RETURNING id, confirm_token, unsub_token, confirmed_at`,
    [addr, first, last || null, confirm, unsub, clean(source, 60) || 'unknown']);
  const row = r.rows[0];

  // Already confirmed: say so warmly and send nothing. Re-confirming a settled subscriber would be
  // an unnecessary email and would look like a mistake on our part.
  if (row.confirmed_at) {
    return { ok: true, status: 'already_subscribed',
      message: `You are already on the list, ${first} — the next issue will come to you.` };
  }

  const link = `${SITE()}/weekly/confirm/${row.confirm_token}`;
  const out = await sendEmail({
    to: addr,
    subject: 'Confirm you want Clay Weekly',
    text: `Hi ${first},\n\nSomeone asked for Clay Weekly to be sent to this address. If that was you, confirm here:\n\n`
      + `${link}\n\nIf it was not you, ignore this and nothing will be sent. You will not hear from us again.\n\n`
      + 'Clay Weekly is a short magazine about people building small businesses from ideas they never got around '
      + 'to starting. One issue a week. Leaving takes one click.',
    html: `<p>Hi ${first},</p><p>Someone asked for Clay Weekly to be sent to this address. If that was you:</p>`
      + `<p><a href="${link}">Yes, send me Clay Weekly</a></p>`
      + '<p>If it was not you, ignore this and nothing will be sent — you will not hear from us again.</p>'
      + '<p style="color:#666;font-size:13px">Clay Weekly is a short magazine about people building small businesses '
      + 'from ideas they never got around to starting. One issue a week. Leaving takes one click.</p>',
  }).catch((e) => ({ sent: false, reason: (e && e.message) || 'threw' }));

  // sendEmail resolves with { sent:false } rather than throwing, so the result must be READ. Telling
  // someone to check their inbox when the mail never left would leave them waiting on nothing.
  if (!out || !out.sent) {
    return { ok: false, reason: 'confirm_not_sent',
      message: 'We saved your details but could not send the confirmation email just now, so nothing has '
        + 'reached you. Please try again in a few minutes.' };
  }
  return { ok: true, status: 'confirm_sent',
    message: `Thanks ${first} — check your email and confirm, and the next issue will come to you.` };
}

async function confirm(tok) {
  const r = await query(
    `UPDATE weekly_subscribers SET confirmed_at = COALESCE(confirmed_at, now()), unsubscribed_at = NULL
      WHERE confirm_token = $1 RETURNING first_name, email`, [String(tok || '')]);
  if (!r.rows.length) return { ok: false, reason: 'unknown_token' };
  return { ok: true, first_name: r.rows[0].first_name };
}

async function unsubscribe(tok) {
  const r = await query(
    `UPDATE weekly_subscribers SET unsubscribed_at = now()
      WHERE unsub_token = $1 RETURNING email`, [String(tok || '')]);
  return { ok: r.rows.length > 0 };
}

// Everyone who should receive the next issue: confirmed, not unsubscribed.
async function recipients() {
  const r = await query(
    `SELECT email, COALESCE(NULLIF(first_name,''), 'there') AS name, unsub_token AS token
       FROM weekly_subscribers
      WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL`);
  return r.rows;
}

// For the staff dashboard: how the list is actually doing, including the unflattering half.
async function stats() {
  const r = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL)::int AS confirmed,
            COUNT(*) FILTER (WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL)::int AS awaiting_confirmation,
            COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS left_us,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS this_week
       FROM weekly_subscribers`);
  const bySource = await query(
    `SELECT COALESCE(source,'unknown') AS source, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmed
       FROM weekly_subscribers GROUP BY 1 ORDER BY n DESC`);
  return { ...r.rows[0], by_source: bySource.rows };
}

module.exports = { subscribe, confirm, unsubscribe, recipients, stats, looksLikeEmail };
