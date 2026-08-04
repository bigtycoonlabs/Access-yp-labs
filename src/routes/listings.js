const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const describe = require('../lib/describe');
const { isAboveFloor, PRICE_FLOOR_CENTS } = require('../lib/money');
const router = express.Router();

const BUILD_PATH_TYPES = ['html_demo', 'website_prompt', 'build_instructions', 'code_file', 'built_site'];

// A creator can list a concept at ANY stage of their work with Clay — early or finished. The
// listing's honest-picture block shows buyers exactly how far along it is (what's built, what
// proof exists, what risk remains, the first step), so an early concept lists honestly rather
// than being blocked. This function no longer gates on how complete the package is; it reports
// whether the concept's materials are exclusively locked from a prior sale (which still can't be
// re-listed) and whether it carries any fresh material, plus the package flags for information.
async function meetsBaseline(conceptId) {
  const r = await query(
    'SELECT type, exclusive_locked, is_current FROM assets WHERE concept_id=$1', [conceptId]);
  const fresh = r.rows.filter((a) => a.is_current && !a.exclusive_locked);
  const types = fresh.map((x) => x.type);
  const hasPlan = types.includes('business_plan');
  const hasMarketing = types.includes('marketing_strategy');
  const hasBuildPath = types.some((t) => BUILD_PATH_TYPES.includes(t));
  return {
    ok: hasPlan && hasMarketing && hasBuildPath, hasPlan, hasMarketing, hasBuildPath,
    hasLocked: r.rows.some((a) => a.exclusive_locked),
    anyFresh: fresh.length > 0,
  };
}

// Create a draft listing from an owned concept.
router.post('/', authenticate, [
  body('concept_id').isUUID(),
  body('format').isIn(['flat', 'auction']),
  body('price_cents').optional().isInt({ min: PRICE_FLOOR_CENTS }).toInt(),
  body('starting_bid_cents').optional().isInt({ min: PRICE_FLOOR_CENTS }).toInt(),
  body('stage_label').optional().isIn(['concept', 'in_build', 'prepared_to_start']),
  body('auction_close_at').optional().isISO8601(),
  body('risk_disclosed').isBoolean(),
  body('ownership_ack').isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { concept_id, format, price_cents, starting_bid_cents, stage_label,
          completion_target, risk_disclosed, ownership_ack, auction_close_at } = req.body;

  const own = await query('SELECT id, is_operating FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  if (own.rows[0].is_operating) {
    throw new ApiError(409, 'The Dreamhold sells unlaunched ideas, not running businesses. This is marked as a business you already operate, so it can\u2019t be listed. Clay can still help you enhance it — or find a complementary dream to add to it.');
  }

  if (!risk_disclosed || !ownership_ack) {
    throw new ApiError(400, 'You must disclose risk and acknowledge that a sale transfers ownership.');
  }
  // No development-stage gate: a creator can post at any point in their work with Clay. The one
  // thing still protected is exclusivity — materials sold with a concept are locked to that buyer
  // and can't be re-listed; the seller enhances in Clay to make new ones.
  const base = await meetsBaseline(concept_id);
  if (base.hasLocked && !base.anyFresh) {
    throw new ApiError(409,
      'The materials for this concept were sold with it and are locked as exclusive, so they can\u2019t be listed again. Enhance the concept in Clay to create new materials, then list it.',
      { need_new_assets: true });
  }
  if (format === 'flat' && !isAboveFloor(price_cents)) throw new ApiError(400, 'Flat price must be at least $10.');
  if (format === 'auction' && !isAboveFloor(starting_bid_cents)) throw new ApiError(400, 'Starting bid must be at least $10.');

  const r = await query(
    `INSERT INTO listings
       (concept_id, seller_id, format, price_cents, starting_bid_cents, auction_close_at,
        completion_target, stage_label, status, risk_disclosed, ownership_ack)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'concept')::concept_stage,'draft',true,true)
     RETURNING *`,
    [concept_id, req.user.id, format, price_cents || null, starting_bid_cents || null,
     auction_close_at || null, completion_target || null, stage_label]);
  res.status(201).json({ listing: r.rows[0] });
}));

// Submit a draft for moderation.
router.post('/:id/submit', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE listings SET status='in_review', updated_at=NOW()
     WHERE id=$1 AND seller_id=$2 AND status='draft' RETURNING *`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Draft listing not found.');
  res.json({ listing: r.rows[0] });
}));

// Withdraw own listing.
router.post('/:id/withdraw', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE listings SET status='withdrawn', updated_at=NOW()
     WHERE id=$1 AND seller_id=$2 AND status IN ('draft','in_review','live') RETURNING *`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Listing not found.');
  res.json({ listing: r.rows[0] });
}));

// Edit a listing — only while it is a DRAFT. A draft is private and can carry no
// bids, so changing price/terms is safe. To change a live listing, the seller
// withdraws it (back out of public) and relists; we never rewrite the terms of a
// listing buyers may already be acting on.
router.patch('/:id', authenticate, [
  body('format').optional().isIn(['flat', 'auction']),
  body('price_cents').optional().isInt({ min: PRICE_FLOOR_CENTS }).toInt(),
  body('starting_bid_cents').optional().isInt({ min: PRICE_FLOOR_CENTS }).toInt(),
  body('stage_label').optional().isIn(['concept', 'in_build', 'prepared_to_start']),
  body('completion_target').optional().isString().isLength({ max: 200 }),
  body('auction_close_at').optional().isISO8601(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const cur = await query('SELECT * FROM listings WHERE id=$1 AND seller_id=$2', [req.params.id, req.user.id]);
  if (!cur.rows.length) throw new ApiError(404, 'Listing not found.');
  const l = cur.rows[0];
  if (l.status !== 'draft') {
    throw new ApiError(409, 'Only a draft listing can be edited. Withdraw this listing first, then edit and resubmit — that way nobody is acting on terms while they change.');
  }

  const format = req.body.format || l.format;
  const price = req.body.price_cents !== undefined ? req.body.price_cents : l.price_cents;
  const bid = req.body.starting_bid_cents !== undefined ? req.body.starting_bid_cents : l.starting_bid_cents;
  const stage = req.body.stage_label || l.stage_label;
  const target = req.body.completion_target !== undefined ? req.body.completion_target : l.completion_target;
  const closeAt = req.body.auction_close_at !== undefined ? req.body.auction_close_at : l.auction_close_at;

  if (format === 'flat' && !isAboveFloor(price)) throw new ApiError(400, 'Flat price must be at least $10.');
  if (format === 'auction' && !isAboveFloor(bid)) throw new ApiError(400, 'Starting bid must be at least $10.');

  const r = await query(
    `UPDATE listings SET format=$3, price_cents=$4, starting_bid_cents=$5, stage_label=$6,
       completion_target=$7, auction_close_at=$8, updated_at=NOW()
     WHERE id=$1 AND seller_id=$2 AND status='draft' RETURNING *`,
    [req.params.id, req.user.id, format,
     format === 'flat' ? price : null, format === 'auction' ? bid : null,
     stage, target || null, closeAt || null]);
  if (!r.rows.length) throw new ApiError(409, 'Listing could not be updated.');
  res.json({ listing: r.rows[0] });
}));

// Public marketplace browse — only live listings.
router.get('/', asyncHandler(async (req, res) => {
  const { category, stage } = req.query;
  const r = await query(
    `SELECT l.id, l.format, l.price_cents, l.starting_bid_cents, l.auction_close_at,
            l.stage_label, l.completion_target, l.created_at,
            c.title, c.category, c.risk_summary, COALESCE(u.display_name, 'A Dreamhold creator') AS seller_alias,
            c.research_grounded, c.claims_verified, c.source_count,
            (SELECT COUNT(*)::int FROM waitlist_signups w WHERE w.concept_id=l.concept_id) AS waiting
     FROM listings l
     JOIN concepts c ON c.id=l.concept_id
     JOIN users u ON u.id=l.seller_id
     WHERE l.status='live'
       AND ($1::text IS NULL OR c.category::text=$1)
       AND ($2::text IS NULL OR l.stage_label::text=$2)
     ORDER BY l.created_at DESC`,
    [category || null, stage || null]);
  res.json({ listings: r.rows });
}));

// Dreams leaping for you — live listings tuned to the user's interests and
// budget from onboarding, so the right ones surface first without overwhelm.
router.get('/leaping', authenticate, asyncHandler(async (req, res) => {
  const pr = await query('SELECT interests, launch_budget FROM user_preferences WHERE user_id=$1', [req.user.id]);
  const prefs = pr.rows[0] || { interests: [], launch_budget: '' };
  const BUDGET_MAX = { under_150: 15000, under_500: 50000, under_1000: 100000, under_5000: 500000, under_10000: 1000000, under_50000: 5000000 };
  const maxc = BUDGET_MAX[prefs.launch_budget] || null;
  const interests = prefs.interests || [];
  const r = await query(
    `SELECT l.id, l.format, l.price_cents, l.starting_bid_cents, l.auction_close_at,
            l.stage_label, l.completion_target, l.created_at,
            c.title, c.category, c.risk_summary, COALESCE(u.display_name, 'A Dreamhold creator') AS seller_alias,
            c.research_grounded, c.claims_verified, c.source_count,
            (SELECT COUNT(*)::int FROM waitlist_signups w WHERE w.concept_id=l.concept_id) AS waiting
     FROM listings l JOIN concepts c ON c.id=l.concept_id JOIN users u ON u.id=l.seller_id
     WHERE l.status='live'
       AND ($1::text[] IS NULL OR array_length($1::text[],1) IS NULL OR c.category::text = ANY($1::text[]))
       AND ($2::int IS NULL OR COALESCE(l.price_cents, l.starting_bid_cents, 0) <= $2)
     ORDER BY l.created_at DESC LIMIT 8`,
    [interests.length ? interests : null, maxc]);
  res.json({ listings: r.rows, tuned: { interests, budget: prefs.launch_budget } });
}));

// Today's Dreams — the daily reason to come back. Fresh live Dreams (listed in the last
// week) tuned to the creator's interests and budget, newest first, never their own. Ships
// with a short digest so a returning creator hears what's new in a single spoken line. If
// nothing matches their interests yet, we broaden to all fresh Dreams rather than show an
// empty feed — the marketplace should always feel alive.
router.get('/today', authenticate, asyncHandler(async (req, res) => {
  const pr = await query('SELECT interests, launch_budget FROM user_preferences WHERE user_id=$1', [req.user.id]);
  const prefs = pr.rows[0] || { interests: [], launch_budget: '' };
  const BUDGET_MAX = { under_150: 15000, under_500: 50000, under_1000: 100000, under_5000: 500000, under_10000: 1000000, under_50000: 5000000 };
  const maxc = BUDGET_MAX[prefs.launch_budget] || null;
  const interests = prefs.interests || [];
  const FRESH_DAYS = 7;

  async function fetchDreams(useInterests) {
    const r = await query(
      `SELECT l.id, l.format, l.price_cents, l.starting_bid_cents, l.auction_close_at,
              l.stage_label, l.created_at,
              c.title, c.category, c.risk_summary, COALESCE(u.display_name, 'A Dreamhold creator') AS seller_alias,
              c.research_grounded, c.claims_verified, c.source_count,
              (l.created_at >= now() - interval '24 hours') AS is_new_today,
              (SELECT COUNT(*)::int FROM waitlist_signups w WHERE w.concept_id=l.concept_id) AS waiting
       FROM listings l JOIN concepts c ON c.id=l.concept_id JOIN users u ON u.id=l.seller_id
       WHERE l.status='live'
         AND l.created_at >= now() - ($3::int * interval '1 day')
         AND l.seller_id <> $4
         AND ( $1::text[] IS NULL OR NOT $5::boolean OR c.category::text = ANY($1::text[]) )
         AND ( $2::int IS NULL OR COALESCE(l.price_cents, l.starting_bid_cents, 0) <= $2 )
       ORDER BY l.created_at DESC LIMIT 12`,
      [interests.length ? interests : null, maxc, FRESH_DAYS, req.user.id, useInterests]);
    return r.rows;
  }

  let dreams = await fetchDreams(interests.length > 0);
  let broadened = false;
  if (!dreams.length && interests.length) { dreams = await fetchDreams(false); broadened = true; }

  const newToday = dreams.filter((d) => d.is_new_today).length;
  const categories = [...new Set(dreams.map((d) => String(d.category || '').replace(/_/g, ' ')).filter(Boolean))].slice(0, 3);
  res.json({
    dreams,
    digest: { count: dreams.length, new_today: newToday, categories, broadened, fresh_days: FRESH_DAYS },
    tuned: { interests, budget: prefs.launch_budget },
  });
}));

// A seller's own listings, in any status. Must precede /:id.
router.get('/mine', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT l.*, c.title, c.category FROM listings l JOIN concepts c ON c.id=l.concept_id
     WHERE l.seller_id=$1 ORDER BY l.updated_at DESC`, [req.user.id]);
  res.json({ listings: r.rows });
}));

// Previewable asset metadata for a live/sold listing (no bodies; previews are
// fetched per-asset through the watermarked preview endpoint).
router.get('/:id/assets', asyncHandler(async (req, res) => {
  const l = await query(`SELECT concept_id FROM listings WHERE id=$1 AND status IN ('live','sold')`, [req.params.id]);
  if (!l.rows.length) throw new ApiError(404, 'Listing not found.');
  const a = await query(
    `SELECT id, type, title FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at`,
    [l.rows[0].concept_id]);
  res.json({ assets: a.rows });
}));

// Accessible description of a listing's demo for buyers — structure + a11y
// audit only, never the clean HTML. Lets blind buyers understand the demo
// before purchase without exposing the deliverable.
router.get('/:id/demo-description', asyncHandler(async (req, res) => {
  const l = await query(`SELECT concept_id FROM listings WHERE id=$1 AND status IN ('live','sold')`, [req.params.id]);
  if (!l.rows.length) throw new ApiError(404, 'Listing not found.');
  const a = await query(
    `SELECT body FROM assets WHERE concept_id=$1 AND is_current=true
     AND type IN ('html_demo','built_site') ORDER BY created_at DESC LIMIT 1`, [l.rows[0].concept_id]);
  if (!a.rows.length) return res.json({ description: null });
  res.json({ description: describe.outline(a.rows[0].body) });
}));

// Single listing (public if live; owner may view any state).
router.get('/:id', asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT l.*, c.title, c.category, c.risk_summary, COALESCE(u.display_name, 'A Dreamhold creator') AS seller_alias,
            c.research_grounded, c.claims_verified, c.source_count, c.next_steps,
            (SELECT COUNT(*)::int FROM waitlist_signups w WHERE w.concept_id=l.concept_id) AS waiting,
            CASE WHEN c.show_working_since THEN c.working_since ELSE NULL END AS working_since
     FROM listings l JOIN concepts c ON c.id=l.concept_id JOIN users u ON u.id=l.seller_id
     WHERE l.id=$1`, [req.params.id]);
  if (!r.rows.length) throw new ApiError(404, 'Listing not found.');
  const listing = r.rows[0];
  if (listing.status !== 'live') return res.status(404).json({ error: 'Listing not available.' });
  // Never expose the seller's user id publicly — the alias is the public identity,
  // and a raw seller_id could be cross-referenced to de-anonymize a creator.
  delete listing.seller_id;
  res.json({ listing });
}));

module.exports = router;
