const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { normalizeSlug, isValidSlug, commissionDisplay } = require('../lib/movers');
const stripe = require('../services/stripe');
const router = express.Router();

// Enroll as a Affiliate, or update your promo page. Idempotent per user: the same
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
  // Payouts land in the same connected account a seller receives sale proceeds on — one
  // payout account per person. 'verified' means they can cash out.
  const acct = await query('SELECT stripe_account_id, kyc_status FROM seller_accounts WHERE user_id=$1', [req.user.id]);
  const row = acct.rows[0] || null;
  const payout = {
    onboarded: !!(row && row.stripe_account_id),
    kyc_status: row ? row.kyc_status : 'not_started',
    stripe_configured: stripe.configured(),
  };
  res.json({ enrolled: true, mover: m.rows[0], earnings: e.rows[0], payout });
}));


// A Affiliate's page is theirs to shape: a photo, a bio, and links to their own work off this
// platform. Links are normalised and limited rather than trusted: only http(s) is allowed (so a
// javascript: URL can never be stored), each gets a plain label, and the list is capped so a page
// can't become a link farm.
function cleanLinks(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const raw of input.slice(0, 8)) {
    const url = String((raw && raw.url) || '').trim();
    const label = String((raw && raw.label) || '').trim().slice(0, 60);
    if (!url) continue;
    let parsed;
    try { parsed = new URL(url); } catch (_) { continue; }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;   // no javascript:, no data:
    out.push({ url: parsed.toString().slice(0, 400), label: label || parsed.hostname });
  }
  return out;
}

// Update my page or pause/resume being a mover.
router.put('/me', authenticate, [
  body('headline').optional().isString().isLength({ max: 120 }),
  body('bio').optional().isString().isLength({ max: 600 }),
  body('status').optional().isIn(['active', 'paused']),
  body('photo_url').optional({ nullable: true }).isString().isLength({ max: 400 }),
  body('show_real_name').optional().isBoolean(),
  body('links').optional().isArray(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  // A photo must be an https image URL. http is refused rather than silently accepted: a page
  // served securely that pulls an insecure image shows a broken or warned image to visitors.
  let photo = req.body.photo_url === undefined ? null : String(req.body.photo_url || '').trim();
  if (photo) {
    let ok = false;
    try { ok = new URL(photo).protocol === 'https:'; } catch (_) { ok = false; }
    if (!ok) throw new ApiError(400, 'A photo link needs to start with https:// so it loads safely on your page.');
  }
  const links = cleanLinks(req.body.links);

  const r = await query(
    `UPDATE dream_movers SET
        headline       = COALESCE($2, headline),
        bio            = COALESCE($3, bio),
        status         = COALESCE($4, status),
        photo_url      = CASE WHEN $5::text IS NULL THEN photo_url
                              WHEN $5 = '' THEN NULL ELSE $5 END,
        links          = COALESCE($6::jsonb, links),
        show_real_name = COALESCE($7, show_real_name),
        updated_at     = now()
      WHERE user_id=$1 RETURNING *`,
    [req.user.id,
     req.body.headline === undefined ? null : req.body.headline,
     req.body.bio === undefined ? null : req.body.bio,
     req.body.status === undefined ? null : req.body.status,
     req.body.photo_url === undefined ? null : photo,
     links === null ? null : JSON.stringify(links),
     req.body.show_real_name === undefined ? null : !!req.body.show_real_name]);
  if (!r.rows.length) throw new ApiError(404, 'You are not enrolled as a Affiliate yet.');
  res.json({ mover: r.rows[0] });
}));

// Add a live Dream to my promo page (a concept I believe in and want to help sell).
router.post('/promote', authenticate, [
  body('listing_id').isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const me = await query('SELECT 1 FROM dream_movers WHERE user_id=$1', [req.user.id]);
  if (!me.rows.length) throw new ApiError(403, 'Enroll as a Affiliate first.');
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

// Cash out. A mover sends their pending earnings to their own connected account. Each
// earning becomes its own Stripe transfer, keyed by the earning id, so a retry (or a
// double-tap, or two concurrent calls) can never pay the same earning twice. The transfer
// is made outside any DB transaction — we never hold a lock across a Stripe call — and the
// ledger row flips to 'paid' only if it was still 'pending', which also guards concurrency.
router.post('/payout', authenticate, asyncHandler(async (req, res) => {
  const me = await query('SELECT 1 FROM dream_movers WHERE user_id=$1', [req.user.id]);
  if (!me.rows.length) throw new ApiError(403, 'Enroll as a Affiliate first.');
  if (!stripe.configured()) {
    return res.json({ ok: false, reason: 'stripe_not_configured', message: 'Payouts are not enabled on the platform yet.' });
  }
  const acct = (await query('SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1', [req.user.id])).rows[0];
  if (!acct || !acct.stripe_account_id) {
    return res.json({ ok: false, reason: 'no_account', message: 'Set up your payout account first, then you can cash out.' });
  }
  // Source of truth for readiness is Stripe, not our cached status.
  const a = await stripe.retrieveAccount(acct.stripe_account_id);
  if (!a.ok || !a.payouts_enabled) {
    return res.json({ ok: false, reason: 'payouts_disabled', message: 'Your payout account is not ready yet. Finish setting it up, then try again.' });
  }

  const pend = await query(
    "SELECT id, amount_cents FROM mover_earnings WHERE mover_id=$1 AND status='pending' ORDER BY created_at ASC",
    [req.user.id]);
  if (!pend.rows.length) {
    return res.json({ ok: true, paid_count: 0, paid_cents: 0, failed: 0, message: 'No earnings to pay out yet.' });
  }

  let paidCount = 0, paidCents = 0, failed = 0;
  for (const e of pend.rows) {
    const t = await stripe.createTransfer({
      amountCents: e.amount_cents,
      destinationAccountId: acct.stripe_account_id,
      idempotencyKey: 'mover_earn_' + e.id,
      metadata: { kind: 'mover_commission', earning_id: e.id, mover_id: req.user.id },
    });
    if (!t.ok) { failed++; continue; }
    const upd = await query(
      "UPDATE mover_earnings SET status='paid', paid_at=now(), stripe_transfer_id=$2 WHERE id=$1 AND status='pending'",
      [e.id, t.transferId]);
    if (upd.rowCount) { paidCount++; paidCents += e.amount_cents; }
  }
  res.json({ ok: true, paid_count: paidCount, paid_cents: paidCents, failed });
}));

// PUBLIC promo page data — a mover's shopfront. Their headline, the Projects they're
// selling (their own), and the Projects they're championing (others'). Each carries the
// dollar commission and a promo link that credits this mover on a sale.
router.get('/:slug', asyncHandler(async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  // The display name carries here too. It is ONE identity across the platform — listings, the
  // partner board, and this promo page — so a person is known by the same name everywhere and their
  // real name stays private. Changing the tag changes it here as well, by design.
  // The displayed name is the mover's own choice. It defaults to the display name — showing a real
  // name has to be something a person deliberately turns on, never something that happens to them.
  const m = await query(
    `SELECT dm.user_id, dm.slug, dm.headline, dm.bio, dm.status,
            dm.photo_url, dm.links, dm.show_real_name,
            COALESCE(NULLIF(u.display_name,''), 'A Affiliate') AS builder_tag,
            CASE WHEN dm.show_real_name THEN COALESCE(NULLIF(u.name,''), NULLIF(u.display_name,''), 'A Affiliate')
                 ELSE COALESCE(NULLIF(u.display_name,''), 'A Affiliate') END AS shown_name
       FROM dream_movers dm JOIN users u ON u.id = dm.user_id
      WHERE dm.slug=$1`, [slug]);
  if (!m.rows.length || m.rows[0].status !== 'active') throw new ApiError(404, 'No Affiliate here.');
  const mover = m.rows[0];

  const rows = await query(
    `SELECT l.id, l.price_cents, l.format, l.starting_bid_cents,
            c.title, c.category, c.risk_summary,
            (l.seller_id = $1) AS own
       FROM listings l
       JOIN concepts c ON c.id = l.concept_id
      WHERE l.status='live'
        AND ( l.seller_id = $1
              OR l.id IN (SELECT listing_id FROM mover_promotions WHERE mover_id=$1) )
      ORDER BY (l.seller_id = $1) DESC, l.created_at DESC`, [mover.user_id]);

  const projects = rows.rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    risk_summary: r.risk_summary,
    // format and the starting bid travel with the price. Without them the mover page cannot tell an
    // auction from a free listing, and it was rendering both as "$0.00".
    format: r.format,
    price_cents: r.price_cents,
    starting_bid_cents: r.starting_bid_cents,
    own: r.own,
    // A mover earns the commission only on OTHER creators' Projects; on their own they are
    // the seller and keep the full 80%, so no mover figure is shown there.
    commission: r.own ? null : commissionDisplay(r.price_cents),
    promo_url: '/listing.html?id=' + r.id + '&m=' + encodeURIComponent(slug),
  }));

  res.json({ mover: { slug: mover.slug, headline: mover.headline, bio: mover.bio }, projects });
}));

module.exports = router;
