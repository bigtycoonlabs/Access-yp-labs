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

// ---- systems self-check: what is actually connected, honestly ----
// Clay's own read of his dependencies, so staff (and Clay, by voice) can tell at a glance
// whether the brain, research, email, and payments are wired up — reading env PRESENCE only
// (never secret values) plus the real last-outcome from the log. It never claims something
// works that the record says failed.
const provider = require('./provider');
const research = require('./research');
const { CLAY_VERSION_LABEL } = require('./version');
const { glossarySize } = require('./glossary');
let stripeSvc = null; try { stripeSvc = require('../stripe'); } catch (_) { /* optional until deployed */ }

async function systemsStatus() {
  const env = process.env;

  const reasoning = {
    ok: provider.available(),
    provider: provider.providerName(),
    model: provider.available() ? provider.modelName() : null,
  };

  const researchOk = research.available();
  const researchVia = env.SEARCH_API_KEY ? 'tavily' : (reasoning.provider === 'openai' ? 'openai_web_search' : null);

  const emailConfigured = !!env.RESEND_API_KEY;
  const emailFrom = env.EMAIL_FROM || 'Clay at Access YP Labs <clay@accessyplabs.com>';
  let lastEmail = null;
  try {
    const r = await query('SELECT sent, reason, created_at FROM email_log ORDER BY created_at DESC LIMIT 1');
    if (r.rows[0]) lastEmail = { sent: r.rows[0].sent, reason: r.rows[0].reason, at: r.rows[0].created_at };
  } catch (_) { /* best-effort */ }

  const stripeConfigured = !!(stripeSvc && stripeSvc.configured && stripeSvc.configured());
  const webhookSecret = !!env.STRIPE_WEBHOOK_SECRET;
  let stripeEvents = null;
  try { const r = await query('SELECT count(*)::int AS n FROM stripe_events'); stripeEvents = r.rows[0].n; } catch (_) { /* best-effort */ }

  // Cross-session memory: prove the table is actually readable, not just assumed. If this
  // query throws (missing table, bad search_path), memory is reported down honestly rather
  // than the feature silently failing the next time a builder expects to be remembered.
  let memoryOk = false; let memoryFacts = null;
  try { const r = await query('SELECT count(*)::int AS n FROM clay_memory'); memoryFacts = r.rows[0].n; memoryOk = true; } catch (_) { memoryOk = false; }

  const status = {
    version: CLAY_VERSION_LABEL,
    reasoning,
    research: { ok: researchOk, via: researchVia },
    email: { configured: emailConfigured, from: emailFrom, last: lastEmail },
    payments: { secret_key: stripeConfigured, webhook_secret: webhookSecret, events_recorded: stripeEvents },
    memory: { ok: memoryOk, facts_stored: memoryFacts },
    knowledge: { glossary_terms: glossarySize() },
  };
  status.summary = summarizeSystems(status);
  return status;
}

function summarizeSystems(s) {
  const parts = [];
  if (s.version) parts.push(`Clay is running ${s.version}.`);
  parts.push(s.reasoning.ok
    ? `Clay's brain is connected — ${s.reasoning.provider}, model ${s.reasoning.model}.`
    : `Clay's brain is NOT connected: no AI provider key is set.`);
  parts.push(s.research.ok
    ? `Web research is on, via ${s.research.via === 'tavily' ? 'Tavily' : 'OpenAI web search'}.`
    : `Web research is off — Clay can't look things up on the web right now.`);
  if (s.email.configured) {
    if (s.email.last && s.email.last.sent === false) {
      parts.push(`Email has a key set but the last send FAILED (${s.email.last.reason || 'unknown reason'}). Sending as ${s.email.from}.`);
    } else if (s.email.last && s.email.last.sent === true) {
      parts.push(`Email is working — the last send succeeded, from ${s.email.from}.`);
    } else {
      parts.push(`Email key is set (from ${s.email.from}); no sends recorded yet.`);
    }
  } else {
    parts.push(`Email is NOT configured — no Resend key, so Clay can't send mail.`);
  }
  if (s.payments.secret_key) {
    parts.push(s.payments.webhook_secret
      ? `Payments are connected — Stripe key and webhook secret are both set.`
      : `Stripe key is set but the WEBHOOK SECRET is missing, so payments would start but confirmations won't record.`);
    if (s.payments.events_recorded === 0) parts.push(`No payment events have been recorded yet.`);
  } else {
    parts.push(`Payments are NOT connected — no Stripe secret key, so customers can't pay yet.`);
  }
  if (s.memory) {
    parts.push(s.memory.ok
      ? `Cross-session memory is reachable${s.memory.facts_stored != null ? ` — ${s.memory.facts_stored} fact${s.memory.facts_stored === 1 ? '' : 's'} stored across all builders` : ''}.`
      : `Cross-session memory is NOT reachable right now — Clay can't read what it remembered, so it may re-ask things it should know.`);
  }
  if (s.knowledge && typeof s.knowledge.glossary_terms === 'number') {
    parts.push(`Clay can define ${s.knowledge.glossary_terms} business terms in plain language.`);
  }
  return parts.join(' ');
}

module.exports = { recentStats, assess, checkAndAlert, systemsStatus, summarizeSystems };
