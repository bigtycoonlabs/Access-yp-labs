const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { normalizeSlug, isValidSlug, commissionDisplay } = require('../lib/movers');
const router = express.Router();

// Enroll as a Dream Mover, or update your promo page. Idempotent per user: the same
// creator re-enrolling just updates their handle/headline/bio.
router.post('/enroll', authenticate, [
  body('slug').isString(),
  body('headline').optional().isString().isLength({ max: 120 }),
  body('bio').optional().isString().isLength({ max: 600 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const slug = normalizeSlug(req.body.slug);
  if (!isValidSlug(slug)) {
    throw new ApiError(400, 'Choose a promo handle of 3 to 32 letters, numbers, or hyphens.');
  }
  const taken = await query('SELECT user_id FROM dream_movers WHERE slug=$1 AND user_id<>$2', [slug, req.user.id]);
  if (taken.rows.length) throw new ApiError(409, 'That promo handle is taken. Try another.');

  const r = await query(
    `INSERT INTO dream_movers (user_id, slug, headline, bio)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE
        SET slug=EXCLUDED.slug, headline=EXCLUDED.headline, bio=EXCLUDED.bio, updated_at=now()
     RETURNING *`,
    [req.user.id, slug, req.body.headline || null, req.body.bio || null]);
  res.status(201).json({ mover: r.rows[0] });
}));

// My mover profile + a clean earnings summary (what I've earned, what's still pending).
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const m = await query('SELECT * FROM dream_movers WHERE user_id=$1', [req.user.id]);
  if (!m.rows.length) return res.json({ enrolled: false });
  const e = await query(
    `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='pending'), 0)::int AS pending_cents,
            COALESCE(SUM(amount_cents) FILTER (WHERE status='paid'), 0)::int    AS paid_cents,
            COUNT(*)::int AS sales
       FROM mover_earnings WHERE mover_id=$1`, [req.user.id]);
  res.json({ enrolled: true, mover: m.rows[0], earnings: e.rows[0] });
}));

// Update my page or pause/resume being a mover.
router.put('/me', authenticate, [
  body('headline').optional().isString().isLength({ max: 120 }),
  body('bio').optional().isString().isLength({ max: 600 }),
  body('status').optional().isIn(['active', 'paused']),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const r = await query(
    `UPDATE dream_movers SET
        headline   = COALESCE($2, headline),
        bio        = COALESCE($3, bio),
        status     = COALESCE($4, status),
        updated_at = now()
      WHERE user_id=$1 RETURNING *`,
    [req.user.id,
     req.body.headline === undefined ? null : req.body.headline,
     req.body.bio === undefined ? null : req.body.bio,
     req.body.status === undefined ? null : req.body.status]);
  if (!r.rows.length) throw new ApiError(404, 'You are not enrolled as a Dream Mover yet.');
  res.json({ mover: r.rows[0] });
}));

// Add a live Dream to my promo page (a concept I believe in and want to help sell).
router.post('/promote', authenticate, [
  body('listing_id').isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const me = await query('SELECT 1 FROM dream_movers WHERE user_id=$1', [req.user.id]);
  if (!me.rows.length) throw new ApiError(403, 'Enroll as a Dream Mover first.');
  const l = await query('SELECT id, status FROM listings WHERE id=$1', [req.body.listing_id]);
  if (!l.rows.length || l.rows[0].status !== 'live') throw new ApiError(404, 'That Dream is not available to promote.');
  await query(
    'INSERT INTO mover_promotions (mover_id, listing_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.user.id, req.body.listing_id]);
  res.status(201).json({ ok: true });
}));

// Remove a Dream from my promo page.
router.delete('/promote/:listingId', authenticate, asyncHandler(async (req, res) => {
  await query('DELETE FROM mover_promotions WHERE mover_id=$1 AND listing_id=$2',
    [req.user.id, req.params.listingId]);
  res.json({ ok: true });
}));

// PUBLIC promo page data — a mover's shopfront. Their headline, the Dreams they're
// selling (their own), and the Dreams they're championing (others'). Each carries the
// dollar commission and a promo link that credits this mover on a sale.
router.get('/:slug', asyncHandler(async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const m = await query(
    'SELECT user_id, slug, headline, bio, status FROM dream_movers WHERE slug=$1', [slug]);
  if (!m.rows.length || m.rows[0].status !== 'active') throw new ApiError(404, 'No Dream Mover here.');
  const mover = m.rows[0];

  const rows = await query(
    `SELECT l.id, l.price_cents, c.title, c.category, c.risk_summary,
            (l.seller_id = $1) AS own
       FROM listings l
       JOIN concepts c ON c.id = l.concept_id
      WHERE l.status='live'
        AND ( l.seller_id = $1
              OR l.id IN (SELECT listing_id FROM mover_promotions WHERE mover_id=$1) )
      ORDER BY (l.seller_id = $1) DESC, l.created_at DESC`, [mover.user_id]);

  const dreams = rows.rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    risk_summary: r.risk_summary,
    price_cents: r.price_cents,
    own: r.own,
    // A mover earns the commission only on OTHER creators' Dreams; on their own they are
    // the seller and keep the full 80%, so no mover figure is shown there.
    commission: r.own ? null : commissionDisplay(r.price_cents),
    promo_url: '/listing.html?id=' + r.id + '&m=' + encodeURIComponent(slug),
  }));

  res.json({ mover: { slug: mover.slug, headline: mover.headline, bio: mover.bio }, dreams });
}));

module.exports = router;
