const express = require('express');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const health = require('../services/clay/health');
const image = require('../services/image');
const storage = require('../services/storage');

const router = express.Router();

// GET /api/admin/overview — one honest, at-a-glance read on the whole platform for
// staff: the real counts and Clay's recent + all-time health, on a single screen.
// Every number is a live COUNT; nothing here is estimated or fabricated.
router.get('/overview', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const counts = await query(`
      SELECT
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM concepts)::int AS concepts,
        (SELECT COUNT(*) FROM listings WHERE status='live')::int AS live_listings,
        (SELECT COUNT(*) FROM waitlist_signups)::int AS waitlist,
        (SELECT COUNT(*) FROM subscriptions WHERE status='active' AND plan='maker')::int AS maker_subs,
        (SELECT COUNT(*) FROM subscriptions WHERE status='active' AND plan='sculptor')::int AS sculptor_subs`);
    const clayAll = await query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE result_status='answered')::int AS answered,
        COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last_24h,
        COUNT(*) FILTER (WHERE provider_available IS FALSE)::int AS provider_down
      FROM clay_runs`);
    let clayRecent = null;
    try { clayRecent = await health.recentStats(); } catch (_) { clayRecent = null; }
    // Payments diagnostic: env PRESENCE only (never the secret itself) plus the real Stripe
    // reason from the most recent failed checkouts — so staff can see exactly why a subscribe
    // failed without reading server logs.
    let checkoutErrors = [];
    try {
      const ce = await query(
        `SELECT created_at, plan, stripe_type, stripe_code, stripe_param, message
           FROM checkout_errors ORDER BY created_at DESC LIMIT 5`);
      checkoutErrors = ce.rows;
    } catch (_) { checkoutErrors = []; }
    const payments = {
      secret_key_present: !!process.env.STRIPE_SECRET_KEY,
      secret_key_kind: (function (k) {
        if (!k) return 'missing';
        if (k.startsWith('sk_live_')) return 'sk_live (standard, live)';
        if (k.startsWith('sk_test_')) return 'sk_test (standard, test)';
        if (k.startsWith('rk_')) return 'rk (restricted — may lack permissions)';
        if (k.startsWith('pk_')) return 'pk (PUBLISHABLE — wrong key type)';
        if (k.startsWith('whsec_')) return 'whsec (WEBHOOK SECRET — wrong key type)';
        return 'unrecognized prefix';
      })(process.env.STRIPE_SECRET_KEY || ''),
      webhook_secret_present: !!process.env.STRIPE_WEBHOOK_SECRET,
      recent_errors: checkoutErrors,
    };
    // Image economy: usage this month + Extras pack revenue, plus whether generation/storage are
    // switched on. Every figure is a live count; revenue is the real sum of purchases.
    let imagesBlock = { configured: false };
    try {
      const im = await query(`
        SELECT
          (SELECT COUNT(*) FROM image_generations WHERE created_at >= date_trunc('month', now()))::int AS month,
          (SELECT COUNT(*) FROM image_generations WHERE created_at >= date_trunc('month', now()) AND source='auto')::int AS month_auto,
          (SELECT COUNT(*) FROM image_generations WHERE created_at >= date_trunc('month', now()) AND billed='paid')::int AS month_paid,
          (SELECT COUNT(*) FROM image_generations)::int AS total,
          (SELECT COALESCE(SUM(balance),0) FROM concept_image_credits)::int AS credits_outstanding,
          (SELECT COUNT(*) FROM image_pack_purchases WHERE created_at >= date_trunc('month', now()))::int AS packs_month,
          (SELECT COALESCE(SUM(price_cents),0) FROM image_pack_purchases WHERE created_at >= date_trunc('month', now()))::int AS pack_rev_month,
          (SELECT COALESCE(SUM(price_cents),0) FROM image_pack_purchases)::int AS pack_rev_total`);
      const r = im.rows[0];
      imagesBlock = {
        configured: image.configured(),          // image generation switched on?
        storage_configured: storage.configured(), // bucket uploads on? (else inline data URLs)
        generated_this_month: r.month,
        auto_this_month: r.month_auto,
        paid_this_month: r.month_paid,
        generated_all_time: r.total,
        credits_outstanding: r.credits_outstanding,
        packs_sold_this_month: r.packs_month,
        pack_revenue_this_month_cents: r.pack_rev_month,
        pack_revenue_all_time_cents: r.pack_rev_total,
      };
    } catch (_) { imagesBlock = { configured: image.configured(), error: true }; }

    res.json({ counts: counts.rows[0], clay_all: clayAll.rows[0], clay_recent: clayRecent, payments, images: imagesBlock });
  }));

// Testing mode — a staff member's own switch between two ways of experiencing the platform:
//   OFF (billing_test=false): full staff access, no paywalls — for testing building, publishing,
//     and browsing the Dreamhold without money getting in the way.
//   ON  (billing_test=true):  go through the REAL subscribe / paywall / pay flow, to test money
//     end to end as a normal user would.
// It only ever changes the CALLER'S OWN account, so it can't touch anyone else — and authenticate
// re-reads the flag on every request, so a flip takes effect on the very next action.
router.get('/testing-mode', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query('SELECT billing_test FROM users WHERE id=$1', [req.user.id]);
    res.json({ billing_test: !!(r.rows[0] && r.rows[0].billing_test) });
  }));

router.post('/testing-mode', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const enabled = req.body && req.body.enabled === true;
    const r = await query(
      'UPDATE users SET billing_test=$2, updated_at=now() WHERE id=$1 RETURNING billing_test',
      [req.user.id, enabled]);
    res.json({ billing_test: !!r.rows[0].billing_test });
  }));

module.exports = router;
