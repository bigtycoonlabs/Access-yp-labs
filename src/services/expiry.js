// Concept expiry — gentle by design.
//
// A free, unkept concept the person hasn't returned to in a while gently lapses so the
// Laboratory stays about live work. But it never happens silently, and it never happens to
// something they've paid for or claimed:
//   - Only free, self-built, unkept concepts can ever expire. Kept (Maker/Sculptor),
//     purchased, and staff-owned concepts are excluded by the same predicate everywhere.
//   - We always send ONE warm reminder first, and a concept can only expire AFTER it was
//     reminded (with a short grace period), so a dream never dies without a warning.
//   - Expiry is SOFT: we set expired_at and hide the concept; the row and all its work are
//     preserved and recoverable. Nothing is hard-deleted here.
//   - If our email is down, we never mark a concept reminded, so nothing can expire at all.
//     A dream stays alive rather than dying with no warning.
const { query } = require('../config/db');
const { sendEmail } = require('./email');

const REMIND_AFTER_DAYS = 25;          // warn once the concept has sat this long
const EXPIRE_AFTER_DAYS = 30;          // lapse once it's sat this long AND was warned
const GRACE_AFTER_REMINDER_DAYS = 2;   // never expire within this window of the warning

// Protected-from-expiry predicate. `c` = concepts, `u` = users in the surrounding query.
// A concept survives if it's already expired-handled, was purchased, its owner is staff,
// its owner has an active Sculptor plan, or there's active Maker for THIS concept.
const UNKEPT_PREDICATE = `
      c.expired_at IS NULL
      AND (c.origin IS DISTINCT FROM 'purchased')
      AND u.role NOT IN ('staff','admin','master_staff')
      -- Never expire a project someone already paid for, or their free first project.
      AND c.free_forever = false
      AND c.id <> (SELECT id FROM concepts c2 WHERE c2.owner_id=c.owner_id ORDER BY c2.created_at ASC, c2.id ASC LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=c.owner_id AND s.plan IN ('builder','sculptor')
                        AND s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end > now()))
      AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=c.owner_id AND s.plan='maker'
                        AND s.status='active' AND s.concept_id=c.id
                        AND (s.current_period_end IS NULL OR s.current_period_end > now()))`;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function reminderEmail(title, conceptId, name) {
  const t = escapeHtml(title || 'your concept');
  const hi = name ? ('Hi ' + escapeHtml(String(name).split(' ')[0]) + ',') : 'Hi,';
  const link = 'https://accessyplabs.com/app.html?concept=' + encodeURIComponent(conceptId);
  return '<div style="max-width:600px;margin:0 auto;font-family:system-ui,sans-serif;font-size:16px;line-height:1.55;color:#1c1917">' +
    '<p>' + hi + '</p>' +
    '<p>Your dream <strong>“' + t + '”</strong> has been quiet for a little while, and I didn’t want it to slip away without telling you. If you don’t come back to it, it’ll fade from your Laboratory in a few days — and honestly, we hate to see a dream die.</p>' +
    '<p>Coming back is free. Open it, keep building, change anything you like — it stays yours.</p>' +
    '<p><a href="' + link + '" style="display:inline-block;background:#7c2d12;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-size:16px">Open “' + t + '” and keep building</a></p>' +
    '<p style="color:#57534e;font-size:14px">Want to keep it for good and unlock every piece? That’s Maker — $2.99 for this concept. But you don’t need to pay a thing just to come back and build.</p>' +
    '<p>— Clay, at Access YP Labs</p>' +
    '</div>';
}

function reminderText(title, conceptId) {
  const link = 'https://accessyplabs.com/app.html?concept=' + conceptId;
  return 'Your dream “' + (title || 'your concept') + '” has been quiet for a while and will fade from your Laboratory in a few days if you don’t return. ' +
    'Coming back is free — open it and keep building: ' + link + '  ' +
    '(Keeping it for good is Maker, $2.99, but you don’t need to pay to come back.) — Clay, Access YP Labs';
}

async function logReminder(toEmail, result) {
  try {
    const sent = !!(result && result.sent);
    await query('INSERT INTO email_log (to_email, kind, sent, reason, provider_id) VALUES ($1,$2,$3,$4,$5)',
      [toEmail, 'expiry_reminder', sent, sent ? null : ((result && result.reason) || 'unknown'), sent ? (result.id || null) : null]);
  } catch (_) { /* logging must never break the sweep */ }
}

// Warn owners whose free concept has gone quiet — once. We only mark it reminded when the
// email actually SENT, so a broken/unconfigured mailbox can never let a concept slip toward
// expiry without a real warning; it's simply retried next sweep.
async function sendExpiryReminders() {
  const due = (await query(
    `SELECT c.id, c.title, u.email, u.name
       FROM concepts c JOIN users u ON u.id=c.owner_id
      WHERE ${UNKEPT_PREDICATE}
        AND c.expiry_reminded_at IS NULL
        AND c.last_opened_at < now() - interval '${REMIND_AFTER_DAYS} days'
        AND u.email IS NOT NULL AND u.status='active'
      ORDER BY c.last_opened_at ASC
      LIMIT 200`)).rows;
  let emailed = 0;
  for (const c of due) {
    let result = { sent: false, reason: 'unknown' };
    try {
      result = await sendEmail({
        to: c.email,
        subject: 'Your dream “' + (c.title || 'concept') + '” is about to fade',
        html: reminderEmail(c.title, c.id, c.name),
        text: reminderText(c.title, c.id),
      });
    } catch (e) { result = { sent: false, reason: (e && e.message) || 'error' }; }
    await logReminder(c.email, result);
    if (result.sent) {
      await query('UPDATE concepts SET expiry_reminded_at=now() WHERE id=$1', [c.id]);
      emailed++;
    }
  }
  return { reminders_due: due.length, reminders_sent: emailed };
}

// Soft-expire concepts that stayed quiet past the window AND were already warned (with a
// short grace period). Kept/purchased/staff concepts can never be caught by the predicate.
async function expireLapsed() {
  const r = await query(
    `UPDATE concepts c SET expired_at=now()
       FROM users u
      WHERE u.id=c.owner_id
        AND ${UNKEPT_PREDICATE}
        AND c.expiry_reminded_at IS NOT NULL
        AND c.expiry_reminded_at < now() - interval '${GRACE_AFTER_REMINDER_DAYS} days'
        AND c.last_opened_at < now() - interval '${EXPIRE_AFTER_DAYS} days'
      RETURNING c.id`);
  return { expired: r.rowCount || 0 };
}

async function runExpirySweep() {
  const out = { reminders_due: 0, reminders_sent: 0, expired: 0 };
  try { Object.assign(out, await sendExpiryReminders()); }
  catch (e) { console.error('expiry reminders failed:', e && e.message); }
  try { Object.assign(out, await expireLapsed()); }
  catch (e) { console.error('expiry sweep failed:', e && e.message); }
  return out;
}

module.exports = {
  runExpirySweep, sendExpiryReminders, expireLapsed,
  reminderEmail, reminderText,
  REMIND_AFTER_DAYS, EXPIRE_AFTER_DAYS, GRACE_AFTER_REMINDER_DAYS,
};
