// THE OPERATIONS CONSOLE.
//
// There were eight staff pages and no front door. Somebody running this business had to already know
// that moderation lives on one page, the Weekly on another, people on a third, and Clay's health on a
// fourth — and had to visit all of them to find out whether anything needed doing. That is a settings
// area, not a way to run a company.
//
// This returns the whole state of the business in ONE call, organised the way somebody actually
// thinks about it:
//
//   NOW      what is waiting on a human, oldest first, because a queue's age matters more than its
//            depth — three things waiting an hour is fine, one thing waiting four days is not
//   BUSINESS the numbers that say whether this is working: creators, listings, sales, money
//   GROWTH   whether anyone is arriving, and from where
//   PEOPLE   who is here, who is stuck, who just left
//   CLAY     whether the thing that does the work is actually working
//
// Design rule throughout: every number that could be zero for two different reasons distinguishes
// them. "No sales yet" and "could not read sales" must never look the same, because a dashboard that
// reports a broken query as a calm zero is worse than no dashboard.

const express = require('express');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');

const router = express.Router();
const staffOnly = [authenticate, authorize('staff', 'admin', 'master_staff')];

// The alarms the platform raises when something has gone wrong that nobody would otherwise notice.
// Kept in step with the ALWAYS_DELIVER list in staffNotify: anything that bypasses the daily cap
// because it matters should also sort to the top of the list somebody reads.
const URGENT_KINDS = [
  'seller_billing_not_stopped', 'webhook_not_recorded', 'webhook_dedupe_unavailable',
  'auction_email_failed', 'watch_delivery_failed', 'seed_failed', 'refund_failed',
  'password_reset_not_sent',
];

// Run a query and never let one broken section blank the whole console. A section that fails says so
// and the rest still renders — the alternative is an operator seeing an empty page and not knowing
// whether the business is quiet or the console is broken.
async function safe(label, fn) {
  try { return { ok: true, ...(await fn()) }; }
  catch (e) {
    console.error('console section failed:', label, '-', e && e.message);
    return { ok: false, error: 'Could not read this. ' + ((e && e.message) || 'Unknown reason.') };
  }
}

// ---- NOW: what is waiting, and how long it has waited ------------------------------------------
async function nowSection() {
  const q = await query(`
    SELECT 'Listings to review' AS queue, 'market-control.html' AS page, count(*)::int AS n,
           MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::int AS oldest_hours
      FROM listings WHERE status='in_review'
    UNION ALL
    SELECT 'Reports to resolve', 'market-control.html', count(*)::int,
           MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::int
      FROM reports WHERE status='open'
    UNION ALL
    SELECT 'Desk drafts', 'desk-admin.html', count(*)::int,
           MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::int
      FROM desk_articles WHERE status='draft'
    UNION ALL
    SELECT 'Weekly issues waiting', 'weekly-admin.html', count(*)::int,
           MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::int
      FROM weekly_issues WHERE status='draft'
    -- Partner requests are deliberately NOT here. An open one is a creator waiting for another
    -- creator, and there is no staff route that can action it — no accept, no decline, nothing.
    -- Leaving it in "what needs me" put a permanently unclearable item at the top of the list,
    -- ageing forever, which is exactly how somebody learns to ignore the whole list. It is counted
    -- under Growth instead, where it belongs: a sign of whether the board is alive.
    UNION ALL
    -- Framed as reaching a person rather than clearing a queue, because verification is STRIPE'S
    -- decision and nobody here can grant it. What staff can actually do is notice somebody stuck
    -- and contact them, so the label says that instead of implying an approve button exists.
    SELECT 'Sellers stuck unverified — worth reaching out', 'people.html', count(*)::int, NULL
      FROM seller_accounts WHERE kyc_status <> 'verified'
    UNION ALL
    -- Pointed at people.html, which does not show orders at all, so following it left somebody
    -- looking for money on a page about accounts. Nothing on the platform lists escrow yet, so it
    -- points at the console's own business section, which does show the held total.
    SELECT 'Orders holding money', 'console.html#business', count(*)::int,
           MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 3600)::int
      FROM orders_transfers WHERE status='in_escrow'
  `);

  // Ordered by who has waited longest, not by count. An operator with limited time should work down
  // this list from the top and be right to.
  const queues = q.rows
    .map((r) => ({ ...r, oldest_hours: r.oldest_hours == null ? null : Number(r.oldest_hours) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => (b.oldest_hours || 0) - (a.oldest_hours || 0));

  // OPEN alerts only, and the urgent ones first.
  //
  // This used to show everything raised in the last seven days regardless of whether anybody had
  // dealt with it, so within a week it was nine items — mostly noise — with the genuinely urgent
  // ones buried among them. An alert list that only grows is one people scroll past, which is how
  // an alerting system dies: not switched off, just ignored.
  //
  // Operational alarms sort above routine notes because they mean something already went wrong and
  // somebody is affected who does not know it. A new creator signing up is worth telling you; it is
  // not worth telling you FIRST.
  // GROUPED, because the same problem repeating is ONE thing to deal with, not twenty.
  //
  // Seen on screen: four identical "Seller B still billed" cards, each ~240 pixels tall, filling the
  // section entirely. A recurring fault floods the one list that has to stay readable, and the
  // genuinely different alert underneath it never gets seen. Counting the repeats says more than
  // listing them anyway — "four times, most recently at 2:07" is the useful fact.
  //
  // The id kept is the OLDEST in the group, so resolving works on the one that has been waiting
  // longest, and the count tells you how many others share its cause.
  const alerts = await query(`
    SELECT (array_agg(id ORDER BY created_at ASC))[1] AS id,
           kind, subject,
           (array_agg(body ORDER BY created_at DESC))[1] AS body,
           max(created_at) AS created_at,
           min(created_at) AS first_seen,
           count(*)::int AS times,
           bool_or(acknowledged_at IS NOT NULL) AS acknowledged_at,
           (kind = ANY($1::text[])) AS urgent
      FROM clay_staff_notes
     WHERE resolved_at IS NULL
     GROUP BY kind, subject, (kind = ANY($1::text[]))
     ORDER BY (kind = ANY($1::text[])) DESC, max(created_at) DESC
     LIMIT 25`, [URGENT_KINDS]);

  return {
    queues,
    total_waiting: queues.reduce((n, q2) => n + q2.n, 0),
    // Anything the platform raised itself. These outrank every queue: a queue means somebody is
    // waiting, an alert means something already went wrong and nobody has been told.
    alerts: alerts.rows,
    urgent_alerts: alerts.rows.filter((a) => a.urgent).length,
  };
}

// ---- BUSINESS: is this working ------------------------------------------------------------------
async function businessSection() {
  const r = await query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE email <> 'clay@accessyplabs.com') AS creators,
      (SELECT count(*)::int FROM users WHERE email <> 'clay@accessyplabs.com'
         AND created_at > now() - interval '7 days') AS creators_this_week,
      (SELECT count(*)::int FROM concepts c JOIN users u ON u.id=c.owner_id
         WHERE u.email <> 'clay@accessyplabs.com') AS projects,
      (SELECT count(*)::int FROM listings WHERE status='live') AS listings_live,
      (SELECT count(*)::int FROM orders_transfers WHERE status='released') AS sales_completed,
      (SELECT COALESCE(SUM(amount_cents),0)::int FROM orders_transfers WHERE status='released') AS gross_cents,
      (SELECT COALESCE(SUM(platform_fee_cents),0)::int FROM orders_transfers WHERE status='released') AS our_cut_cents,
      (SELECT COALESCE(SUM(amount_cents),0)::int FROM orders_transfers WHERE status='in_escrow') AS held_in_escrow_cents,
      (SELECT count(*)::int FROM subscriptions WHERE status='active') AS paying_subscribers,
      (SELECT COALESCE(SUM(price_cents),0)::int FROM subscriptions WHERE status='active') AS mrr_cents
  `);
  const row = r.rows[0];
  return {
    ...row,
    // Stated rather than left for the reader to work out, because this is the number the whole
    // business rests on and it should be impossible to misread as anything else.
    verdict: row.sales_completed === 0
      ? 'No sale has completed yet. The loop has not closed end to end with a real buyer.'
      : `${row.sales_completed} sale${row.sales_completed === 1 ? '' : 's'} completed.`,
  };
}

// ---- GROWTH: is anyone arriving, and from where --------------------------------------------------
async function growthSection() {
  const subs = await query(`
    SELECT COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL)::int AS confirmed,
           COUNT(*) FILTER (WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL)::int AS awaiting,
           COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS left_us,
           COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS this_week
      FROM weekly_subscribers`);
  const bySource = await query(`
    SELECT COALESCE(source,'unknown') AS source, count(*)::int AS n
      FROM weekly_subscribers GROUP BY 1 ORDER BY n DESC LIMIT 8`);
  const desk = await query(`
    SELECT count(*) FILTER (WHERE status='published')::int AS published,
           count(*) FILTER (WHERE status='published' AND published_at > now() - interval '7 days')::int AS this_week
      FROM desk_articles`);
  const movers = await query(`SELECT count(*)::int AS n FROM dream_movers WHERE status='active'`);
  // Watched, not actioned. Nobody on staff can accept or decline one of these — it tells you
  // whether people are asking each other for help, which is a health signal rather than a queue.
  const partners = await query(`
    SELECT count(*) FILTER (WHERE status='open')::int AS open,
           count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS this_month
      FROM partner_requests`);

  // Which live listings have never been promoted. This is the marketing worklist, and its absence is
  // how a creator's project sits untouched while the easy ones get posted about repeatedly.
  const unpromoted = await query(`
    SELECT l.id, c.title
      FROM listings l JOIN concepts c ON c.id=l.concept_id
     WHERE l.status='live'
       AND NOT EXISTS (SELECT 1 FROM listing_events e WHERE e.listing_id=l.id AND e.kind='value_added')
     ORDER BY l.created_at ASC LIMIT 10`);

  return {
    weekly: subs.rows[0],
    weekly_by_source: bySource.rows,
    desk: desk.rows[0],
    active_movers: movers.rows[0].n,
    partner_requests: partners.rows[0],
    never_promoted: unpromoted.rows,
  };
}

// ---- PEOPLE: who is here, who is stuck -----------------------------------------------------------
async function peopleSection() {
  const recent = await query(`
    SELECT COALESCE(NULLIF(display_name,''), 'no tag yet') AS tag, created_at,
           (SELECT count(*)::int FROM concepts c WHERE c.owner_id=u.id) AS projects
      FROM users u WHERE email <> 'clay@accessyplabs.com'
     ORDER BY created_at DESC LIMIT 8`);
  // Somebody who built something and then stopped. The most actionable list on the platform.
  const stalled = await query(`
    SELECT c.id, c.title, c.movement_state,
           (EXTRACT(EPOCH FROM (now() - c.updated_at)) / 86400)::int AS days_quiet,
           (c.nudged_at IS NOT NULL) AS already_nudged
      FROM concepts c JOIN users u ON u.id=c.owner_id
     WHERE u.email <> 'clay@accessyplabs.com'
       AND c.updated_at < now() - interval '3 days'
       AND EXISTS (SELECT 1 FROM assets a WHERE a.concept_id=c.id AND a.is_current)
     ORDER BY c.updated_at ASC LIMIT 10`);
  return { recent_signups: recent.rows, stalled: stalled.rows };
}

// ---- CLAY: is the thing that does the work actually working --------------------------------------
async function claySection() {
  const runs = await query(`
    SELECT result_status, count(*)::int AS n
      FROM clay_runs WHERE created_at > now() - interval '7 days'
     GROUP BY 1 ORDER BY n DESC`);
  const total = runs.rows.reduce((n, r) => n + r.n, 0);
  const failed = runs.rows.filter((r) => r.result_status !== 'answered').reduce((n, r) => n + r.n, 0);

  const seed = await query(`
    SELECT count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS seeded_this_week,
           max(created_at) AS last_seed
      FROM concepts WHERE origin='clay_seed'`);

  const conversations = await query(`
    SELECT count(*)::int AS sessions,
           count(*) FILTER (WHERE turns = 1)::int AS single_turn,
           count(*) FILTER (WHERE last_status <> 'answered')::int AS ended_badly
      FROM clay_sessions WHERE started_at > now() - interval '7 days'`);

  return {
    runs_this_week: total,
    failures_this_week: failed,
    // A rate, because 3 failures out of 5 and 3 out of 500 are different problems entirely.
    failure_rate: total ? Math.round((failed / total) * 100) : null,
    by_status: runs.rows,
    seeding: seed.rows[0],
    conversations: conversations.rows[0],
  };
}

// GET /api/console — the whole business, one call.
router.get('/', staffOnly, asyncHandler(async (req, res) => {
  const [now, business, growth, people, clay] = await Promise.all([
    safe('now', nowSection),
    safe('business', businessSection),
    safe('growth', growthSection),
    safe('people', peopleSection),
    safe('clay', claySection),
  ]);
  res.json({ ok: true, generated_at: new Date().toISOString(), now, business, growth, people, clay });
}));


// GET /api/console/marketing — the promotion rotation and what each channel produced.
router.get('/marketing', staffOnly, asyncHandler(async (req, res) => {
  const attribution = require('../services/clay/attribution');
  const [channels, rot] = await Promise.all([
    attribution.channelReport({ days: Number(req.query.days) || 30 }),
    attribution.rotation({ limit: 25 }),
  ]);
  res.json({ ok: true, channels, rotation: rot });
}));

// GET /api/console/listing/:id/marketing — one listing: what we posted, what arrived, share links.
router.get('/listing/:id/marketing', staffOnly, asyncHandler(async (req, res) => {
  const attribution = require('../services/clay/attribution');
  res.json({ ok: true, ...(await attribution.listingReport(req.params.id)) });
}));

// POST /api/console/listing/:id/promoted — log a post after making it.
//
// Written by a person rather than detected, because nothing here can see a post go out, and a log
// that guesses is worse than one somebody keeps.
router.post('/listing/:id/promoted', staffOnly, asyncHandler(async (req, res) => {
  const attribution = require('../services/clay/attribution');
  const out = await attribution.recordPromotion({
    listingId: req.params.id, channel: req.body.channel, note: req.body.note, staffId: req.user.id,
  });
  if (!out.ok) return res.status(400).json(out);
  res.json({ ok: true, message: 'Logged. It moves to the back of the rotation.' });
}));


// POST /api/console/alerts/:id/ack — somebody is on it.
//
// Separate from resolving on purpose. SEEN is not FIXED, and without the middle state an alert
// somebody is actively working on looks identical to one nobody has touched.
router.post('/alerts/:id/ack', staffOnly, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE clay_staff_notes SET acknowledged_at = now(), acknowledged_by = $2
      WHERE id = $1 AND resolved_at IS NULL RETURNING id, subject`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) {
    return res.status(404).json({ ok: false, message: 'That alert is not open — it may already be resolved.' });
  }
  res.json({ ok: true, message: 'Marked as being handled. It stays on the list until it is resolved.' });
}));

// POST /api/console/alerts/:id/resolve — it is done, and here is what was done.
router.post('/alerts/:id/resolve', staffOnly, asyncHandler(async (req, res) => {
  const note = String(req.body.note || '').trim();
  if (!note) {
    // Required rather than optional. An alert resolved with "restarted the worker" teaches the next
    // person something; one resolved silently teaches nothing, and six months later nobody can tell
    // whether it was fixed or dismissed.
    return res.status(400).json({
      ok: false,
      message: 'Say what was done about it, even briefly. An alert resolved with no note cannot be '
        + 'told apart later from one that was simply dismissed.',
    });
  }
  // Resolve the WHOLE group. The list groups identical alerts, so clearing only the one row somebody
  // clicked would drop the count by one and leave the same entry sitting there — which reads as the
  // button not working.
  const r = await query(
    `UPDATE clay_staff_notes
        SET resolved_at = now(), resolved_by = $2, resolution_note = $3,
            acknowledged_at = COALESCE(acknowledged_at, now()),
            acknowledged_by = COALESCE(acknowledged_by, $2)
      WHERE resolved_at IS NULL
        AND (kind, subject) = (SELECT kind, subject FROM clay_staff_notes WHERE id = $1)
      RETURNING id`,
    [req.params.id, req.user.id, note.slice(0, 1000)]);
  if (!r.rows.length) {
    return res.status(404).json({ ok: false, message: 'That alert is not open — it may already be resolved.' });
  }
  res.json({ ok: true, message: 'Resolved, with your note kept against it.' });
}));

// GET /api/console/alerts/history — what has been dealt with, and what was done.
router.get('/alerts/history', staffOnly, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT n.kind, n.subject, n.created_at, n.resolved_at, n.resolution_note,
            COALESCE(u.display_name, u.name, 'someone') AS resolved_by
       FROM clay_staff_notes n
       LEFT JOIN users u ON u.id = n.resolved_by
      WHERE n.resolved_at IS NOT NULL
      ORDER BY n.resolved_at DESC LIMIT 50`);
  res.json({ ok: true, resolved: r.rows });
}));


// ---- The end-of-shift handover ------------------------------------------------------------------
//
// Written by whoever worked the shift, read by owners who were asleep while it happened. It is the
// cheapest thing in the operations plan and the one that does the most: it makes the work visible
// without anybody having to check, and it is what makes a second hire take a week rather than a
// month.

// GET /api/console/handover — today's note (yours to edit) and the last two weeks (everyone's).
router.get('/handover', staffOnly, asyncHandler(async (req, res) => {
  const mine = await query(
    `SELECT * FROM handover_notes
      WHERE staff_id = $1 AND shift_date = (now() AT TIME ZONE 'UTC')::date`, [req.user.id]);
  const recent = await query(
    `SELECT h.shift_date, h.cleared, h.escalated, h.promoted, h.odd, h.still_waiting, h.created_at,
            COALESCE(u.display_name, u.name, 'someone') AS who
       FROM handover_notes h
       LEFT JOIN users u ON u.id = h.staff_id
      ORDER BY h.shift_date DESC, h.created_at DESC LIMIT 14`);

  // Which of the last seven days has no note at all. A missed handover is a real signal rather than
  // an administrative slip — it usually means the shift was rushed or did not happen — so it is
  // surfaced rather than left for somebody to notice by scrolling.
  const gaps = await query(
    `SELECT d::date AS day
       FROM generate_series((now() AT TIME ZONE 'UTC')::date - 6, (now() AT TIME ZONE 'UTC')::date - 1, interval '1 day') d
      WHERE NOT EXISTS (SELECT 1 FROM handover_notes h WHERE h.shift_date = d::date)
      ORDER BY day DESC`);

  res.json({
    ok: true,
    today: mine.rows[0] || null,
    recent: recent.rows,
    days_with_no_note: gaps.rows.map((r) => r.day),
  });
}));

// POST /api/console/handover — save today's note. Saving again updates rather than duplicating.
router.post('/handover', staffOnly, asyncHandler(async (req, res) => {
  const f = ['cleared', 'escalated', 'promoted', 'odd', 'still_waiting'];
  const vals = f.map((k) => {
    const v = String(req.body[k] == null ? '' : req.body[k]).trim();
    return v ? v.slice(0, 4000) : null;
  });

  // An entirely empty note is refused. A note that says nothing is worse than no note, because it
  // makes the record look kept while telling the next person nothing — and "all good" every day is
  // exactly what this format exists to prevent.
  if (!vals.some(Boolean)) {
    return res.status(400).json({
      ok: false,
      message: 'Fill in at least one part. An empty note makes the record look kept while telling '
        + 'the next person nothing — if the shift really was quiet, say that in "what I cleared".',
    });
  }

  await query(
    `INSERT INTO handover_notes (staff_id, shift_date, cleared, escalated, promoted, odd, still_waiting)
     VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2,$3,$4,$5,$6)
     ON CONFLICT (staff_id, shift_date) DO UPDATE
       SET cleared=EXCLUDED.cleared, escalated=EXCLUDED.escalated, promoted=EXCLUDED.promoted,
           odd=EXCLUDED.odd, still_waiting=EXCLUDED.still_waiting`,
    [req.user.id, ...vals]);

  res.json({ ok: true, message: 'Handover saved. The owners can read it whenever they wake up.' });
}));

module.exports = router;
