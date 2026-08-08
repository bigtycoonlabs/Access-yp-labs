// Clay reaching the team. When Clay has something the owners and staff should see — a concern about
// the platform, an idea to improve it, or his weekly review — he sends it through here. It emails
// the team and records EVERY outreach in clay_staff_notes (truth over silence: logged whether or
// not the email delivered, so nothing Clay "told the team" is invisible).
//
// Anti-spam by construction, so Clay can hold this power without ever flooding an inbox:
//   - a dedupe key suppresses a repeat of the same note within a window, and
//   - a global daily cap means there is a hard ceiling on notes per day.
// Best-effort: it never throws. Callers get a small result they can speak to honestly.

const { query } = require('../../config/db');
const { sendEmail } = require('../email');

const DAILY_CAP = 6;      // Most DISCRETIONARY team notes Clay can send in one day.
const DEDUPE_HOURS = 20;  // Same dedupe_key won't resend within this window.

// OPERATIONAL ALERTS ARE NOT SUBJECT TO THE DAILY CAP.
//
// The cap exists so Clay's own observations can never flood an inbox, and for that it is right. But
// it was applied to EVERYTHING, so six chatty notes in a morning would silently swallow an alert
// saying a seller is still being charged for a project they sold, or that a payment may have been
// processed twice. Worse, a capped note was not even RECORDED — so the one thing that must never be
// lost was the one thing that vanished without trace.
//
// These kinds are raised by the platform when something has actually gone wrong, not by Clay
// deciding he has something to say. They are always delivered and always logged. There is no volume
// of them that would be better suppressed: if fifty arrive in a day, fifty things are broken and
// somebody needs to know that.
const ALWAYS_DELIVER = new Set([
  'seller_billing_not_stopped',   // someone is being charged for what they no longer own
  'webhook_not_recorded',         // a payment may be applied twice
  'webhook_dedupe_unavailable',   // we cannot tell whether a payment is a repeat
  'auction_email_failed',         // a winner and a seller are waiting on news that already happened
  'watch_delivery_failed',        // people who asked to be told are not being told
  'seed_failed',                  // the platform stopped producing supply
  'refund_failed',                // money owed to somebody has not gone back
]);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function notifyStaff({ kind = 'note', subject, body, dedupeKey = null } = {}) {
  const out = { sent: false, recipients: 0, skipped: null };
  try {
    if (!subject || !body) { out.skipped = 'empty'; return out; }

    if (dedupeKey) {
      const dup = await query(
        `SELECT 1 FROM clay_staff_notes WHERE dedupe_key=$1
           AND created_at > now() - ($2 || ' hours')::interval LIMIT 1`,
        [dedupeKey, String(DEDUPE_HOURS)]);
      if (dup.rows.length) { out.skipped = 'deduped'; return out; }
    }
    // The cap counts and limits DISCRETIONARY notes only. An operational alert is never counted
    // against it and never blocked by it — a broken payment does not become less broken because
    // Clay had a talkative morning.
    const urgent = ALWAYS_DELIVER.has(kind);
    if (!urgent) {
      const today = await query(
        `SELECT count(*)::int AS n FROM clay_staff_notes
          WHERE created_at >= date_trunc('day', now()) AND kind NOT IN (${
            [...ALWAYS_DELIVER].map((_, i) => '$' + (i + 1)).join(',')})`,
        [...ALWAYS_DELIVER]);
      if (today.rows[0].n >= DAILY_CAP) { out.skipped = 'daily_cap'; return out; }
    }

    const staff = (await query(
      "SELECT email FROM users WHERE role IN ('staff','admin','master_staff') AND status='active' AND email IS NOT NULL"))
      .rows.map((r) => r.email).filter(Boolean);
    out.recipients = staff.length;

    let emailed = false;
    if (staff.length) {
      const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.6;color:#191630">`
        + `<p style="color:#585272;margin:0 0 12px">A note from Clay about Access YP Labs.</p>`
        + `<div style="white-space:pre-wrap">${esc(body)}</div></div>`;
      const text = 'A note from Clay about Access YP Labs.\n\n' + String(body);
      try {
        const r = await sendEmail({ to: staff, subject: 'Clay: ' + subject, html, text });
        emailed = !!(r && r.sent);
      } catch (_) { emailed = false; }
    }
    out.sent = emailed;

    await query(
      `INSERT INTO clay_staff_notes (kind, subject, body, dedupe_key, recipients, emailed)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [String(kind).slice(0, 40), String(subject).slice(0, 200), String(body).slice(0, 20000),
        dedupeKey, out.recipients, emailed]);
    return out;
  } catch (e) {
    out.skipped = 'error:' + (e && e.message);
    return out;
  }
}

async function recentNotes(limit = 20) {
  try {
    const r = await query(
      `SELECT id, kind, subject, recipients, emailed, created_at
         FROM clay_staff_notes ORDER BY created_at DESC LIMIT $1`,
      [Math.min(Math.max(Number(limit) || 20, 1), 50)]);
    return r.rows;
  } catch (_) { return []; }
}

module.exports = { notifyStaff, recentNotes, DAILY_CAP };
