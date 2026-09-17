// THE STAFF PORTAL, redesigned 17 September 2026 for the platform as it is now.
//
// The old portal was eight screens built around the marketplace and Clay. This is six, each answering
// one question a staff member actually has, read from live data:
//   today     what needs a person right now
//   members   who is here, on what plan, using how much
//   money     what comes in, and what Penny costs us to run
//   penny     is she working: model calls, compliance research, builds, launches
//   email     what went out and what did not
// (The Desk page reuses /api/desk.) Everything here is read-only; actions reuse the existing
// endpoints with their own permission checks. Every number is a live count, never an estimate.

const express = require('express');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const { PAID_PLANS, PLANS, BUNDLES } = require('../lib/money');

const router = express.Router();
const staffOnly = [authenticate, authorize('staff', 'admin', 'master_staff')];

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

router.get('/today', staffOnly, asyncHandler(async (req, res) => {
  const [alerts, builds, research, email, payments, joined, topups] = await Promise.all([
    query(`SELECT (array_agg(id ORDER BY created_at ASC))[1] AS id, kind, subject,
                  (array_agg(body ORDER BY created_at DESC))[1] AS body, max(created_at) AS last_seen,
                  count(*)::int AS times, bool_or(acknowledged_at IS NOT NULL) AS acknowledged
             FROM clay_staff_notes WHERE resolved_at IS NULL
            GROUP BY kind, subject ORDER BY max(created_at) DESC LIMIT 25`),
    query(`SELECT b.id, b.asked_for, b.status, b.says, b.updated_at, bz.name AS business
             FROM builds b JOIN businesses bz ON bz.id = b.business_id
            WHERE (b.status = 'failed' AND b.updated_at > now() - interval '7 days')
               OR (b.status = 'building' AND b.started_at < now() - interval '30 minutes')
            ORDER BY b.updated_at DESC LIMIT 20`),
    query(`SELECT r.id, r.status, r.says, r.created_at, bz.name AS business
             FROM compliance_runs r JOIN businesses bz ON bz.id = r.business_id
            WHERE (r.status = 'failed' AND r.created_at > now() - interval '7 days')
               OR (r.status IN ('queued','running') AND r.created_at < now() - interval '30 minutes')
            ORDER BY r.created_at DESC LIMIT 20`),
    query(`SELECT to_email, kind, reason, created_at FROM email_log
            WHERE sent = false AND created_at > now() - interval '7 days'
            ORDER BY created_at DESC LIMIT 20`),
    query(`SELECT s.plan, s.bundle, s.status, u.email, u.name FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE s.status = 'past_due' ORDER BY s.created_at DESC`),
    query(`SELECT name, email, created_at FROM users WHERE created_at > now() - interval '7 days'
              AND email NOT ILIKE '%@example.test' ORDER BY created_at DESC`),
    query(`SELECT t.kind, t.units, t.created_at, u.email FROM topup_purchases t JOIN users u ON u.id = t.user_id
            WHERE t.created_at > now() - interval '7 days' ORDER BY t.created_at DESC`),
  ]);
  const needs = alerts.rows.length + builds.rows.length + research.rows.length + email.rows.length + payments.rows.length;
  res.json({
    says: needs === 0 ? 'Nothing needs a person right now.'
      : needs + (needs === 1 ? ' thing needs' : ' things need') + ' a person.',
    alerts: alerts.rows, builds: builds.rows, research: research.rows, email_failures: email.rows,
    past_due: payments.rows, joined: joined.rows, topups: topups.rows,
  });
}));

router.get('/members', staffOnly, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at,
            s.plan, s.bundle, s.billing, s.status AS plan_status,
            (SELECT count(*) FROM businesses b WHERE b.owner_id = u.id)::int AS businesses,
            (SELECT count(*) FROM usage_events e WHERE e.user_id = u.id AND e.kind = 'penny_message' AND e.created_at >= $2)::int AS messages,
            (SELECT count(*) FROM usage_events e WHERE e.user_id = u.id AND e.kind = 'build' AND e.created_at >= $2)::int AS builds,
            (SELECT count(*) FROM usage_events e WHERE e.user_id = u.id AND e.kind IN ('compliance_review','compliance_question') AND e.created_at >= $2)::int AS research,
            (SELECT COALESCE(sum(cost_micros), 0) FROM model_usage m WHERE m.user_id = u.id AND m.created_at >= $2)::bigint AS cost_micros,
            (SELECT max(created_at) FROM model_usage m WHERE m.user_id = u.id) AS last_active
       FROM users u
       LEFT JOIN LATERAL (SELECT plan, bundle, billing, status FROM subscriptions x
                           WHERE x.user_id = u.id AND x.status IN ('active','past_due') AND x.plan = ANY($1)
                           ORDER BY (x.plan = 'office') DESC, x.created_at DESC LIMIT 1) s ON true
      WHERE u.email NOT ILIKE '%@example.test'
      ORDER BY u.created_at DESC LIMIT 500`, [PAID_PLANS, monthStart()]);
  res.json({ members: r.rows.map((m) => Object.assign(m, {
    plan_name: m.bundle ? BUNDLES[m.bundle].name : m.plan ? (PLANS[m.plan] ? PLANS[m.plan].name : 'Retired ' + m.plan + ' plan') : 'Free',
    cost_cents: Math.round(Number(m.cost_micros) / 10000),
  })) });
}));

router.get('/money', staffOnly, asyncHandler(async (req, res) => {
  const since = monthStart();
  const [subs, topups, cost, unpriced] = await Promise.all([
    query(`SELECT plan, bundle, billing, count(*)::int AS n, sum(price_cents)::bigint AS cents
             FROM subscriptions WHERE status = 'active' GROUP BY plan, bundle, billing ORDER BY sum(price_cents) DESC`),
    query(`SELECT kind, count(*)::int AS n, sum(price_cents)::bigint AS cents FROM topup_purchases
            WHERE created_at >= $1 GROUP BY kind`, [since]),
    query(`SELECT purpose, count(*)::int AS calls, sum(cost_micros)::bigint AS micros FROM model_usage
            WHERE created_at >= $1 GROUP BY purpose ORDER BY sum(cost_micros) DESC NULLS LAST`, [since]),
    query(`SELECT count(*)::int AS n FROM model_usage WHERE created_at >= $1 AND cost_micros IS NULL`, [since]),
  ]);
  const monthly = (row) => Number(row.cents) / (row.billing === 'yearly' ? 12 : 1);
  const recurring = Math.round(subs.rows.reduce((n, r) => n + monthly(r), 0));
  const topupCents = topups.rows.reduce((n, r) => n + Number(r.cents), 0);
  const costCents = Math.round(cost.rows.reduce((n, r) => n + Number(r.micros || 0), 0) / 10000);
  res.json({
    recurring_cents: recurring, topup_cents: topupCents, model_cost_cents: costCents,
    unpriced_calls: unpriced.rows[0].n,
    plans: subs.rows.map((r) => Object.assign(r, {
      name: r.bundle ? BUNDLES[r.bundle].name : PLANS[r.plan] ? PLANS[r.plan].name : 'Retired ' + r.plan + ' plan',
      monthly_cents: Math.round(monthly(r)) })),
    topups: topups.rows,
    cost_by_purpose: cost.rows.map((r) => ({ purpose: r.purpose, calls: r.calls, cents: Math.round(Number(r.micros || 0) / 10000) })),
  });
}));

router.get('/penny', staffOnly, asyncHandler(async (req, res) => {
  const [calls, research, builds, launches] = await Promise.all([
    query(`SELECT purpose, count(*)::int AS calls, sum(input_tokens)::bigint AS input, sum(output_tokens)::bigint AS output,
                  sum(cost_micros)::bigint AS micros
             FROM model_usage WHERE created_at > now() - interval '7 days' GROUP BY purpose ORDER BY count(*) DESC`),
    query(`SELECT status, count(*)::int AS n,
                  round(avg(date_part('epoch', finished_at - started_at))::numeric / 60.0, 1) AS avg_minutes
             FROM compliance_runs WHERE created_at > now() - interval '7 days' GROUP BY status`),
    query(`SELECT status, count(*)::int AS n FROM builds WHERE created_at > now() - interval '7 days' GROUP BY status`),
    query(`SELECT step, status, count(*)::int AS n FROM launch_steps WHERE created_at > now() - interval '30 days' GROUP BY step, status`),
  ]);
  const findings = await query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE official)::int AS official
                                  FROM compliance_research WHERE searched_at > now() - interval '30 days'`);
  res.json({
    model: process.env.OPENAI_MODEL || 'gpt-5.5',
    calls: calls.rows.map((r) => ({ purpose: r.purpose, calls: r.calls, input: Number(r.input), output: Number(r.output),
      cents: Math.round(Number(r.micros || 0) / 10000) })),
    research: research.rows, builds: builds.rows, launches: launches.rows, findings: findings.rows[0],
  });
}));

router.get('/email', staffOnly, asyncHandler(async (req, res) => {
  const [recent, byKind] = await Promise.all([
    query(`SELECT to_email, kind, sent, reason, created_at FROM email_log ORDER BY created_at DESC LIMIT 60`),
    query(`SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE NOT sent)::int AS failed
             FROM email_log WHERE created_at > now() - interval '30 days' GROUP BY kind ORDER BY count(*) DESC`),
  ]);
  res.json({ recent: recent.rows, by_kind: byKind.rows });
}));

module.exports = router;
