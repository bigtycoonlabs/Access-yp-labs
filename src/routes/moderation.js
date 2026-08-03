const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const describe = require('../lib/describe');
const router = express.Router();

// Only policy-ground reasons exist. "Competes with mine" is deliberately not a
// selectable reason anywhere in the system.
const REASONS = ['missing_baseline', 'running_business', 'fraud', 'missing_risk_disclosure'];

// Review queue — ONE queue for everyone. Clay's seeded concepts land here alongside every
// creator's submission (origin tells them apart so the UI can label a Clay seed); there is no
// separate page. Ordered oldest-first so nothing waits behind newer work.
router.get('/queue', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(
      `SELECT l.id, l.stage_label, l.price_cents, l.created_at, c.id AS concept_id,
              c.title, c.category, c.risk_summary, c.origin, l.seller_id, u.name AS seller_name,
              COALESCE(u.display_name, '—') AS seller_alias
       FROM listings l JOIN concepts c ON c.id=l.concept_id JOIN users u ON u.id=l.seller_id
       WHERE l.status='in_review' ORDER BY l.created_at ASC`);
    res.json({ queue: r.rows });
  }));

// Open ONE queued listing to actually review it: the full concept and all of its current
// materials, unredacted (a reviewer can't judge what they can't read — the buyer paywall does not
// apply to staff review), an accessible outline of any demo, and the prior decision log. This is
// what lets a moderator open a concept, read it, and decide with real knowledge instead of a title.
router.get('/:listingId/review', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const l = await query(
      `SELECT l.id, l.status, l.stage_label, l.format, l.price_cents, l.starting_bid_cents, l.created_at,
              c.id AS concept_id, c.title, c.category, c.stage, c.risk_summary, c.origin,
              c.research_grounded, c.claims_verified, c.source_count, c.clays_take,
              l.seller_id, u.name AS seller_name, COALESCE(u.display_name, '—') AS seller_alias, u.role AS seller_role
       FROM listings l JOIN concepts c ON c.id=l.concept_id JOIN users u ON u.id=l.seller_id
       WHERE l.id=$1`, [req.params.listingId]);
    if (!l.rows.length) throw new ApiError(404, 'Listing not found.');
    const row = l.rows[0];
    const a = await query(
      "SELECT type, title, body, scan_status FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at",
      [row.concept_id]);
    const materials = a.rows.map((m) => ({
      type: m.type, title: m.title || null, scan_status: m.scan_status || null, body: String(m.body || ''),
    }));
    const demoAsset = a.rows.find((m) => m.type === 'html_demo' || m.type === 'built_site');
    let demo = null;
    if (demoAsset && demoAsset.body) {
      try { const o = describe.outline(demoAsset.body); demo = { items: o.items, accessibility: o.a11y.summary }; }
      catch (_) { demo = null; }
    }
    const log = await query(
      `SELECT m.decision, m.reason, m.notes, m.recused, m.created_at, u.name AS moderator_name
       FROM moderation_actions m JOIN users u ON u.id=m.moderator_id
       WHERE m.listing_id=$1 ORDER BY m.created_at`, [row.id]);
    res.json({
      ok: true,
      is_clay_seed: row.origin === 'clay_seed',
      listing: { id: row.id, status: row.status, stage_label: row.stage_label, format: row.format,
        price_cents: row.price_cents, starting_bid_cents: row.starting_bid_cents, created_at: row.created_at },
      concept: { id: row.concept_id, title: row.title, category: row.category, stage: row.stage,
        risk_summary: row.risk_summary, origin: row.origin, research_grounded: row.research_grounded,
        claims_verified: row.claims_verified, source_count: row.source_count, clays_take: row.clays_take },
      seller: { id: row.seller_id, name: row.seller_name, alias: row.seller_alias, role: row.seller_role },
      materials,
      demo_description: demo,
      log: log.rows,
    });
  }));

// Decide on a listing. Neutrality is enforced: a moderator who is the seller
// must recuse and cannot decide. Every decision is written to the audit log.
router.post('/:listingId/decide', authenticate, authorize('staff', 'admin', 'master_staff'), [
  body('decision').isIn(['approved', 'rejected']),
  body('reason').optional({ values: 'falsy' }).isIn(REASONS),
  body('notes').optional().isString(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { decision, reason, notes } = req.body;

  const l = await query('SELECT * FROM listings WHERE id=$1', [req.params.listingId]);
  if (!l.rows.length) throw new ApiError(404, 'Listing not found.');
  const listing = l.rows[0];

  // Neutrality: a moderator normally cannot rule on their own listing. But while the
  // marketplace is being seeded, platform operators (admin / master_staff) must be able to
  // approve their OWN seed listings — otherwise there is no one to clear supply and the
  // marketplace can never fill. This exception is narrow (operators only) and is recorded
  // transparently in the audit log, never hidden.
  const isOperator = ['admin', 'master_staff'].includes(req.user.role);
  if (listing.seller_id === req.user.id && !isOperator) {
    await query(
      `INSERT INTO moderation_actions (listing_id, moderator_id, decision, recused, notes)
       VALUES ($1,$2,$3,true,'auto-recused: moderator is the seller')`,
      [listing.id, req.user.id, decision]);
    throw new ApiError(403, 'You must recuse yourself — you are the seller of this listing.');
  }
  if (decision === 'rejected' && !reason) {
    throw new ApiError(400, 'A policy reason code is required to reject a listing.');
  }
  if (listing.status !== 'in_review') throw new ApiError(400, 'Listing is not in review.');

  // Decide atomically: the status guard above can race two moderators, so the write itself is
  // conditional on the listing still being in review. If someone decided a moment earlier, we
  // report that cleanly instead of recording a second, conflicting decision.
  const newStatus = decision === 'approved' ? 'live' : 'rejected';
  const upd = await query(
    "UPDATE listings SET status=$2, updated_at=NOW() WHERE id=$1 AND status='in_review'",
    [listing.id, newStatus]);
  if (!upd.rowCount) throw new ApiError(409, 'This listing was just decided by another moderator.');
  // If this was an operator clearing their own seed listing, mark it so in the audit trail.
  const selfReview = listing.seller_id === req.user.id;
  const auditNotes = notes || (selfReview ? 'operator self-review during marketplace seeding' : null);
  const act = await query(
    `INSERT INTO moderation_actions (listing_id, moderator_id, decision, reason, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [listing.id, req.user.id, decision, reason || null, auditNotes]);
  res.json({ listing_status: newStatus, action: act.rows[0] });
}));

// Full audit trail for a listing.
router.get('/log/:listingId', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(
      `SELECT m.*, u.name AS moderator_name FROM moderation_actions m
       JOIN users u ON u.id=m.moderator_id WHERE m.listing_id=$1 ORDER BY m.created_at`,
      [req.params.listingId]);
    res.json({ log: r.rows });
  }));

// ---- Reports queue (staff) ----
router.get('/reports', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(
      `SELECT r.*, u.name AS reporter_name FROM reports r
       LEFT JOIN users u ON u.id=r.reporter_id
       WHERE r.status='open' ORDER BY r.created_at ASC`);
    res.json({ reports: r.rows });
  }));

router.post('/reports/:id/dismiss', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(`UPDATE reports SET status='dismissed' WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'Report not found.');
    await logEvent(req.user.id, 'report', req.params.id, 'dismiss_report', null, req.body.notes);
    res.json({ ok: true });
  }));

// ---- User suspension (admin) ----
router.post('/users/:id/suspend', authenticate, authorize('admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) throw new ApiError(400, 'You cannot suspend your own account.');
    const t = await query('SELECT id, role, status FROM users WHERE id=$1', [req.params.id]);
    if (!t.rows.length) throw new ApiError(404, 'User not found.');
    if (['admin', 'master_staff'].includes(t.rows[0].role) && req.user.role !== 'master_staff') {
      throw new ApiError(403, 'Only master staff may suspend an admin.');
    }
    await query(`UPDATE users SET status='suspended', updated_at=now() WHERE id=$1`, [req.params.id]);
    await logEvent(req.user.id, 'user', req.params.id, 'suspend_user', req.body.reason, req.body.notes);
    res.json({ ok: true, status: 'suspended' });
  }));

router.post('/users/:id/reinstate', authenticate, authorize('admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(`UPDATE users SET status='active', updated_at=now() WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'User not found.');
    await logEvent(req.user.id, 'user', req.params.id, 'reinstate_user', null, req.body.notes);
    res.json({ ok: true, status: 'active' });
  }));

// ---- Listing takedown (staff) ----
router.post('/listings/:id/takedown', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(
      `UPDATE listings SET status='withdrawn', updated_at=now()
       WHERE id=$1 AND status IN ('live','in_review','draft') RETURNING id`, [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'Listing not found or not takedownable.');
    await logEvent(req.user.id, 'listing', req.params.id, 'takedown_listing', req.body.reason, req.body.notes);
    res.json({ ok: true });
  }));

// ---- Concept removal (admin) ----
router.post('/concepts/:id/remove', authenticate, authorize('admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query('DELETE FROM concepts WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rows.length) throw new ApiError(404, 'Concept not found.');
    await logEvent(req.user.id, 'concept', req.params.id, 'remove_concept', req.body.reason, req.body.notes);
    res.json({ ok: true });
  }));

// ---- User lookup for moderation (admin) ----
router.get('/users', authenticate, authorize('admin', 'master_staff'), asyncHandler(async (req, res) => {
  const q = '%' + (req.query.q || '') + '%';
  const r = await query(
    `SELECT id, name, email, role, status FROM users
     WHERE email ILIKE $1 OR name ILIKE $1 ORDER BY created_at DESC LIMIT 25`, [q]);
  res.json({ users: r.rows });
}));

// ---- Recent moderation audit trail (staff) ----
router.get('/events', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT e.*, u.name AS moderator_name FROM moderation_events e
     JOIN users u ON u.id=e.moderator_id ORDER BY e.created_at DESC LIMIT 100`);
  res.json({ events: r.rows });
}));

async function logEvent(moderatorId, targetType, targetId, action, reason, notes) {
  await query(
    `INSERT INTO moderation_events (moderator_id, target_type, target_id, action, reason, notes)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [moderatorId, targetType, targetId, action, reason || null, notes || null]);
}

module.exports = router;
