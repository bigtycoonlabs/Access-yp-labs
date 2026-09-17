// THE REBIRTH UPDATE: the one-time email that retired Clay and introduced Penny (16 September 2026).
//
// Nothing sends without the owner's approval, and preview() sends nothing at all. Each person is
// recorded separately in email_log, so a retry never reaches anyone twice and a failure for one person
// never blocks the rest. A send counts only when the mail provider accepted it.

const { query } = require('../config/db');
const { sendEmail } = require('./email');
const { updateEmail } = require('./pennyEmails');
const { PAID_PLANS } = require('../lib/money');

const KIND = 'announce:rebirth-2026-09';
const STAFF = ['staff', 'master_staff', 'admin'];

async function recipients({ exclude = [] } = {}) {
  const r = await query(
    `SELECT u.id, u.email, u.name, u.role,
            EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' AND s.plan = ANY($1)) AS paid,
            COALESCE((SELECT array_agg(b.name ORDER BY b.created_at) FROM concepts c JOIN businesses b ON b.id=c.migrated_business_id
                       WHERE c.owner_id=u.id), '{}') AS moved,
            EXISTS (SELECT 1 FROM email_log l WHERE l.kind=$2 AND l.sent AND lower(l.to_email)=lower(u.email)) AS already
       FROM users u
      WHERE NOT (u.status = ANY($3)) AND u.email IS NOT NULL
        AND u.email NOT ILIKE '%@example.test' AND lower(u.email) <> 'clay@accessyplabs.com'
      ORDER BY u.created_at`, [PAID_PLANS, KIND, ['suspended']]);
  const skip = exclude.map((e) => String(e).toLowerCase());
  return r.rows.filter((u) => !skip.includes(u.email.toLowerCase())).map((u) => ({
    email: u.email, name: u.name, already: u.already,
    person: { name: u.name, standing: STAFF.includes(u.role) ? 'staff' : u.paid ? 'paid' : 'free', moved: u.moved || [] },
  }));
}

async function preview(opts) {
  const list = await recipients(opts);
  return list.map((r) => ({ email: r.email, standing: r.person.standing, moved: r.person.moved, already_sent: r.already }));
}

async function sendAll({ exclude = [], confirm } = {}) {
  if (confirm !== 'send the rebirth update') return { ok: false, says: 'Not confirmed, so nothing was sent.' };
  const list = await recipients({ exclude });
  const results = [];
  for (const r of list) {
    if (r.already) { results.push({ email: r.email, sent: false, why: 'already sent' }); continue; }
    const m = updateEmail(r.person);
    const out = await sendEmail({ to: r.email, subject: m.subject, html: m.html, text: m.text });
    await query(`INSERT INTO email_log (to_email, kind, sent, reason, provider_id) VALUES ($1,$2,$3,$4,$5)`,
      [r.email, KIND, !!(out && out.sent), (out && out.reason) || null, (out && out.id) || null]);
    results.push({ email: r.email, sent: !!(out && out.sent), why: out && out.reason, id: out && out.id });
  }
  const sent = results.filter((x) => x.sent).length;
  const due = results.filter((x) => x.why !== 'already sent').length;
  return { ok: sent === due && due > 0, sent, due, results,
    says: due === 0 ? 'Everybody has already received it.' : 'Sent to ' + sent + ' of ' + due + '.' };
}

module.exports = { KIND, recipients, preview, sendAll };
