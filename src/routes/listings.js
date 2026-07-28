const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { isAboveFloor, PRICE_FLOOR_CENTS } = require('../lib/money');
const router = express.Router();

const BUILD_PATH_TYPES = ['html_demo', 'website_prompt', 'build_instructions', 'code_file', 'built_site'];

// Baseline gate: a concept can only be listed if it carries a real package —
// a business plan, a marketing strategy, and at least one build path — made of
// CURRENT, UNLOCKED assets. Assets locked by a prior sale can't be resold; the
// seller must create new materials (enhance in Clay) before listing again.
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
  body('price_cents').optional().isInt({ min: PRICE_FLOOR_CENTS }),
  body('starting_bid_cents').optional().isInt({ min: PRICE_FLOOR_CENTS }),
  body('stage_label').optional().isIn(['concept', 'in_build', 'prepared_to_start']),
  body('risk_disclosed').isBoolean(),
  body('ownership_ack').isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { concept_id, format, price_cents, starting_bid_cents, stage_label,
          completion_target, risk_disclosed, ownership_ack, auction_close_at } = req.body;

  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');

  if (!risk_disclosed || !ownership_ack) {
    throw new ApiError(400, 'You must disclose risk and acknowledge that a sale transfers ownership.');
  }
  const base = await meetsBaseline(concept_id);
  if (!base.ok) {
    if (base.hasLocked && !base.anyFresh) {
      throw new ApiError(409,
        'The materials for this concept were sold with it and are locked as exclusive, so they can\u2019t be listed again. Enhance the concept in Clay to create new materials, then list it.',
        { need_new_assets: true });
    }
    throw new ApiError(422, 'Concept does not meet the baseline to be listed.', {
      needs: { business_plan: base.hasPlan, marketing_strategy: base.hasMarketing, build_path: base.hasBuildPath },
    });
  }
  if (format === 'flat' && !isAboveFloor(price_cents)) throw new ApiError(400, 'Flat price must be at least $50.');
  if (format === 'auction' && !isAboveFloor(starting_bid_cents)) throw new ApiError(400, 'Starting bid must be at least $50.');

  const r = await query(
    `INSERT INTO listings
       (concept_id, seller_id, format, price_cents, starting_bid_cents, auction_close_at,
        completion_target, stage_label, status, risk_disclosed, ownership_ack)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'concept'),'draft',true,true)
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

// Public marketplace browse — only live listings.
router.get('/', asyncHandler(async (req, res) => {
  const { category, stage } = req.query;
  const r = await query(
    `SELECT l.id, l.format, l.price_cents, l.starting_bid_cents, l.auction_close_at,
            l.stage_label, l.completion_target, l.created_at,
            c.title, c.category, c.risk_summary, u.name AS seller_name
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

// A seller's own listings, in any status. Must precede /:id.
router.get('/mine', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT l.*, c.title, c.category FROM listings l JOIN concepts c ON c.id=l.concept_id
     WHERE l.seller_id=$1 ORDER BY l.updated_at DESC`, [req.user.id]);
  res.json({ listings: r.rows });
}));

// Single listing (public if live; owner may view any state).
router.get('/:id', asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT l.*, c.title, c.category, c.risk_summary, u.name AS seller_name
     FROM listings l JOIN concepts c ON c.id=l.concept_id JOIN users u ON u.id=l.seller_id
     WHERE l.id=$1`, [req.params.id]);
  if (!r.rows.length) throw new ApiError(404, 'Listing not found.');
  const listing = r.rows[0];
  if (listing.status !== 'live') return res.status(404).json({ error: 'Listing not available.' });
  res.json({ listing });
}));

module.exports = router;
