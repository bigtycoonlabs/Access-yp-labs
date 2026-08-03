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

const DAILY_CAP = 6;      // Most team notes Clay can send in one day.
const DEDUPE_HOURS = 20;  // Same dedupe_key won't resend within this window.

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
    const today = await query(
      "SELECT count(*)::int AS n FROM clay_staff_notes WHERE created_at >= date_trunc('day', now())");
    if (today.rows[0].n >= DAILY_CAP) { out.skipped = 'daily_cap'; return out; }

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
