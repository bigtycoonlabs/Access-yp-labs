const { query } = require('../../config/db');
const { sendEmail } = require('../email');

// Health monitor over Clay's append-only audit trail. It turns the record of what
// Clay actually did into an early warning: if the generation provider drops, or the
// share of runs that produce a real package falls, staff get told — once per hour,
// so a bad stretch surfaces without a flood of mail. Every alert reports only the
// truth from the journal; it never invents a problem or claims a send that failed.

const MIN_RUNS = 3;            // don't alarm on a trickle of activity
const LOW_ANSWER_RATE = 0.5;   // fewer than half producing a package is a problem

async function recentStats() {
  const r = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE result_status='answered')::int AS answered,
      COUNT(*) FILTER (WHERE provider_available IS FALSE)::int AS provider_down,
      COUNT(*) FILTER (WHERE result_status <> 'answered')::int AS failed
    FROM clay_runs WHERE created_at > now() - interval '1 hour'`);
  return r.rows[0];
}

function assess(s) {
  if (!s || s.total < MIN_RUNS) return { alert: false, stats: s };
  const providerOutage = s.provider_down > 0;
  const answerRate = s.total ? s.answered / s.total : 1;
  const lowAnswer = answerRate < LOW_ANSWER_RATE;
  if (!providerOutage && !lowAnswer) return { alert: false, stats: s };
  const reasons = [];
  if (providerOutage) reasons.push(`the generation provider was unavailable on ${s.provider_down} of ${s.total} runs`);
  if (lowAnswer) reasons.push(`only ${s.answered} of ${s.total} runs produced a package (${Math.round(answerRate * 100)}%)`);
  return { alert: true, reasons, stats: s };
}

async function checkAndAlert() {
  let s;
  try { s = await recentStats(); } catch (_) { return { sent: false, reason: 'stats_failed' }; }
  const a = assess(s);
  if (!a.alert) return { sent: false, reason: 'healthy', stats: s };

  // Dedup: at most one health alert per hour.
  try {
    const recent = await query(
      `SELECT 1 FROM email_log WHERE kind='clay_health_alert' AND created_at > now() - interval '1 hour' LIMIT 1`);
    if (recent.rows.length) return { sent: false, reason: 'already_alerted', stats: s };
  } catch (_) { /* if the check fails, fall through and try to alert */ }

  let staff = [];
  try {
    staff = (await query(
      `SELECT email FROM users WHERE role IN ('admin','master_staff') AND status='active'`)).rows
      .map((r) => r.email).filter(Boolean);
  } catch (_) { staff = []; }
  if (!staff.length) return { sent: false, reason: 'no_recipients', stats: s };

  const summary = 'Clay health alert. In the last hour, ' + a.reasons.join(', and ')
    + '. This is an automated, honest signal from Clay’s audit trail — open the Clay health screen to see the recent runs.';

  let anySent = false;
  for (const email of staff) {
    let sent = { sent: false };
    try { sent = await sendEmail({ to: email, subject: 'Clay health alert', text: summary }); }
    catch (e) { sent = { sent: false, reason: e.message }; }
    anySent = anySent || !!(sent && sent.sent);
    // Record the TRUTH of each send (a failed send is logged as failed).
    try {
      await query(
        `INSERT INTO email_log (to_email, kind, sent, reason, provider_id) VALUES ($1,'clay_health_alert',$2,$3,$4)`,
        [email, !!(sent && sent.sent), (sent && sent.reason) || null, (sent && sent.id) || null]);
    } catch (_) { /* best-effort */ }
  }
  return { sent: anySent, stats: s, reasons: a.reasons, recipients: staff.length };
}

module.exports = { recentStats, assess, checkAndAlert };
