// TELLING PEOPLE WHAT HAPPENED.
//
// Everything built this week works and tells nobody. A contributor offers help and the owner finds
// out only if they happen to open the project page. A collaboration platform where you have to poll
// for the collaboration is a filing cabinet.
//
// THE RULES THIS FILE EXISTS TO KEEP:
//
//   Never invent activity. If nothing happened, the report says nothing happened. A digest that
//   always finds something to celebrate is a digest nobody believes by week three.
//
//   In-app is the truth; email is an attempt. Email needs a key that may not be set and a domain
//   that may not be verified. The row is what happened; the send is recorded against it, and zero
//   delivered is never recorded as sent.
//
//   Notifying must never break the thing it is reporting. If a notification fails, the contribution
//   was still accepted. Every call here is wrapped and swallowed, and the failure is logged rather
//   than raised.
//
//   The sentence is written NOW, in full, and stored. "A contribution was accepted" is useless;
//   "Rel accepted your marketing plan at 20% of the seller side" is not. Rebuilding that later means
//   re-reading records that may have changed since.

const { query } = require('../config/db');
const { sendEmail } = require('./email');

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/$/, '');

// Does this person want the collaboration emails? Missing row means yes — somebody whose work is
// waiting on a decision needs to know, and treating an absent preference as "no" would make the
// system silent for everybody who never found the setting.
async function wantsEmail(userId) {
  try {
    const r = await query(
      'SELECT team_activity FROM user_email_prefs WHERE user_id=$1', [userId]);
    return !r.rows.length || r.rows[0].team_activity !== false;
  } catch (e) {
    return false;   // could not read the preference, so do not send. Silence beats a send we cannot justify.
  }
}

// Record the event, then try to email. In that order, always: if the send throws, the person still
// has the notification waiting for them.
async function notify({ userId, kind, headline, body, conceptId, listingId, actorId, url, dedupeKey }) {
  if (!userId || !headline || !dedupeKey) return { ok: false, reason: 'incomplete' };

  let row;
  try {
    const r = await query(
      `INSERT INTO notifications (user_id, kind, headline, body, concept_id, listing_id, actor_id, url, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING *`,
      [userId, kind, headline, body || null, conceptId || null, listingId || null,
        actorId || null, url || null, dedupeKey]);
    // Already recorded. Not an error — a retry or a double-click collapsing to one notification is
    // the dedupe key doing its job.
    if (!r.rows.length) return { ok: true, duplicate: true };
    row = r.rows[0];
  } catch (e) {
    console.error('notify: could not record', kind, e && e.message);
    return { ok: false, reason: 'not_recorded' };
  }

  try {
    if (!(await wantsEmail(userId))) {
      await mark(row.id, 'skipped', 'the person has team emails turned off');
      return { ok: true, notification: row, emailed: false };
    }
    const u = await query('SELECT email FROM users WHERE id=$1', [userId]);
    if (!u.rows.length || !u.rows[0].email) {
      await mark(row.id, 'skipped', 'no email address on file');
      return { ok: true, notification: row, emailed: false };
    }

    const link = url ? SITE() + url : SITE() + '/dashboard.html';
    const res = await sendEmail({
      to: u.rows[0].email,
      subject: headline,
      text: [headline, body || '', '', link].filter(Boolean).join('\n'),
      html: '<p>' + esc(headline) + '</p>'
        + (body ? '<p>' + esc(body) + '</p>' : '')
        + '<p><a href="' + esc(link) + '">Open it on Access YP Labs</a></p>',
    });

    // sendEmail returns { sent: false, reason } when there is no key. That is a real outcome and it
    // is recorded as one — never as a send.
    if (res && res.sent) await mark(row.id, 'sent', null);
    else await mark(row.id, 'failed', (res && res.reason) || 'unknown');

    return { ok: true, notification: row, emailed: !!(res && res.sent) };
  } catch (e) {
    await mark(row.id, 'failed', (e && e.message) || 'threw').catch(function () { });
    return { ok: true, notification: row, emailed: false };
  }
}

async function mark(id, status, reason) {
  return query('UPDATE notifications SET email_status=$2, email_reason=$3 WHERE id=$1',
    [id, status, reason]).catch(function () { });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Never let a notification break the thing it reports. Callers use this rather than notify()
// directly, so a failure to tell somebody can never undo the acceptance it was telling them about.
function safely(args) {
  return notify(args).catch(function (e) {
    console.error('notify: swallowed', args && args.kind, e && e.message);
    return { ok: false, reason: 'threw' };
  });
}

// ---------------------------------------------------------------- what happened while you were away
//
// The idle mechanic, and it is already true. A listing is live 24 hours a day, and the platform has
// never once mentioned what happened on it overnight.
//
// Some mornings this says nothing happened, and it has to be allowed to. That is what makes the
// mornings it says something worth reading.
async function sinceLastSeen(userId, since) {
  const r = await query(
    `SELECT kind, headline, body, url, created_at
       FROM notifications
      WHERE user_id=$1 AND created_at > $2
      ORDER BY created_at DESC LIMIT 20`,
    [userId, since]);
  return r.rows;
}

module.exports = { notify, safely, sinceLastSeen, wantsEmail };
