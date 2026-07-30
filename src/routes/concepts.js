const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { CATEGORIES, MODES } = require('../services/clay/tools');
const { conceptEntitlement, paywall, isStaff, billingExempt } = require('../lib/entitlement');
const protect = require('../lib/protect');
const retrieval = require('../services/clay/retrieval');

const ASSET_TYPES = ['business_plan', 'marketing_strategy', 'customer_research', 'competitor_research',
  'regulatory_risk', 'html_demo', 'example_image', 'website_prompt', 'build_instructions', 'code_file', 'built_site'];
const router = express.Router();

const STAGES = ['concept', 'in_build', 'prepared_to_start'];

router.post('/', authenticate, [
  body('title').trim().notEmpty(),
  body('mode').isIn(MODES),
  body('category').optional().isIn(CATEGORIES),
  body('is_housing').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { title, mode, category, is_housing, parent_id } = req.body;
  const r = await query(
    `INSERT INTO concepts (owner_id, title, mode, category, is_housing, parent_id)
     VALUES ($1,$2,$3,$4,COALESCE($5,false),$6) RETURNING *`,
    [req.user.id, title, mode, category || null, is_housing, parent_id || null]);
  res.status(201).json({ concept: r.rows[0] });
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  // Include an honest per-concept "kept" flag (can the owner download it?) so the
  // dashboard can show the money state at a glance. One query: staff and active
  // Sculptor cover everything; otherwise a Maker plan for that concept, or an
  // unexpired purchased first month.
  const staff = billingExempt(req.user);
  const r = await query(
    `SELECT c.*,
       ($2::boolean
        OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=c.owner_id AND s.plan='sculptor'
                     AND s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end>now()))
        OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=c.owner_id AND s.plan='maker'
                     AND s.status='active' AND s.concept_id=c.id
                     AND (s.current_period_end IS NULL OR s.current_period_end>now()))
        OR (c.origin='purchased' AND c.access_expires_at IS NOT NULL AND c.access_expires_at>now())
       ) AS entitled
     FROM concepts c WHERE c.owner_id=$1 AND c.expired_at IS NULL ORDER BY c.updated_at DESC`,
    [req.user.id, staff]);
  res.json({ concepts: r.rows });
}));

// Manual materials upload (self-serve listing path). Owner only. Code files are
// malware-scanned; a new asset of an existing type supersedes the prior version.
router.post('/:id/assets', authenticate, [
  body('type').isIn(ASSET_TYPES),
  body('body').isString().trim().notEmpty(),
  body('title').optional().isString(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  const { type, title } = req.body;
  const assetBody = req.body.body;

  let scanStatus = 'not_required', scanDetail = null;
  if (protect.needsScan(type)) { const sc = protect.scanCode(assetBody); scanStatus = sc.status; scanDetail = sc.detail; }

  const prev = await query('SELECT COALESCE(MAX(version),0) AS maxv FROM assets WHERE concept_id=$1 AND type=$2', [req.params.id, type]);
  const nextVersion = prev.rows[0].maxv + 1;
  if (nextVersion > 1) {
    await query('UPDATE assets SET is_current=false WHERE concept_id=$1 AND type=$2 AND is_current=true', [req.params.id, type]);
  }
  const r = await query(
    `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, scan_detail, version, is_current)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id, type, title, scan_status, version`,
    [req.params.id, type, title || null, assetBody,
     ['business_plan', 'marketing_strategy'].includes(type), scanStatus, scanDetail, nextVersion]);
  const blocked = scanStatus === 'flagged';
  res.status(201).json({
    asset: r.rows[0],
    scan: { status: scanStatus, detail: scanDetail },
    message: blocked
      ? 'Uploaded, but this file was flagged by the malware scan and will be blocked from listing/download until resolved.'
      : 'Uploaded.',
  });
}));

// GET /api/concepts/related?q=...&exclude=... — the user's OWN prior concepts most
// relevant to some text, for grounding a new build in real earlier work. Scoped to
// the caller's concepts only. Declared before the /:id routes so it isn't shadowed.
router.get('/related', authenticate, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 2000);
  const exclude = /^[0-9a-f-]{36}$/i.test(String(req.query.exclude || '')) ? req.query.exclude : null;
  const related = await retrieval.relatedConcepts(req.user.id, q, { limit: 3, excludeId: exclude });
  res.json({ related });
}));

// GET /api/concepts/unkept-summary — how many concepts the user has built but
// can't yet download (no active plan covers them). Powers a gentle, mutable
// reminder. Honest by construction: staff and Sculptor cover everything, so their
// count is 0 and they're never nudged. Declared before the /:id routes so the
// static path is never shadowed by the concept-id param.
router.get('/unkept-summary', authenticate, asyncHandler(async (req, res) => {
  const prefs = await query('SELECT reminders_muted FROM user_preferences WHERE user_id=$1', [req.user.id]);
  const muted = !!(prefs.rows[0] && prefs.rows[0].reminders_muted);
  if (billingExempt(req.user)) return res.json({ count: 0, sample: [], muted });
  const sculptor = await query(
    `SELECT 1 FROM subscriptions WHERE user_id=$1 AND plan='sculptor' AND status='active'
       AND (current_period_end IS NULL OR current_period_end > now()) LIMIT 1`, [req.user.id]);
  if (sculptor.rows.length) return res.json({ count: 0, sample: [], muted });
  const rows = await query(
    `SELECT c.id, c.title FROM concepts c
      WHERE c.owner_id=$1 AND c.expired_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s WHERE s.user_id=$1 AND s.plan='maker' AND s.status='active'
            AND s.concept_id=c.id AND (s.current_period_end IS NULL OR s.current_period_end > now()))
        AND NOT (c.origin='purchased' AND c.access_expires_at IS NOT NULL AND c.access_expires_at > now())
      ORDER BY c.created_at DESC`, [req.user.id]);
  res.json({ count: rows.rows.length, sample: rows.rows.slice(0, 3), muted });
}));

// GATED export: bundle of current assets for download. Building is free; pulling
// the materials out requires an active plan (or staff, or an included first month).
router.get('/:id/export', authenticate, asyncHandler(async (req, res) => {
  const ent = await conceptEntitlement(req.user, req.params.id);
  if (!ent.entitled) {
    if (ent.reason === 'not_found') throw new ApiError(404, 'Concept not found.');
    if (ent.reason === 'not_owner') throw new ApiError(403, 'This is not your concept.');
    return res.status(402).json(paywall(req.params.id));
  }
  const a = await query(
    `SELECT id, type, title, body, file_url, scan_status FROM assets
     WHERE concept_id=$1 AND is_current=true ORDER BY created_at`, [req.params.id]);
  if (a.rows.some((x) => x.scan_status === 'flagged')) {
    return res.status(403).json({ error: 'blocked_by_scan',
      message: 'A file in this concept was flagged by the malware scan and cannot be exported.' });
  }
  res.json({ entitled_via: ent.reason, assets: a.rows });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const c = await query('SELECT * FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!c.rows.length) throw new ApiError(404, 'Concept not found.');
  if (c.rows[0].expired_at) throw new ApiError(410, 'This concept has faded — it sat unopened past its window and was cleared. You can start a fresh one anytime.');
  // Returning to a concept resets its expiry clock and clears any pending fade-reminder.
  await query('UPDATE concepts SET last_opened_at=now(), expiry_reminded_at=NULL WHERE id=$1', [req.params.id]);
  const a = await query('SELECT * FROM assets WHERE concept_id=$1 ORDER BY created_at', [req.params.id]);
  const ent = await conceptEntitlement(req.user, req.params.id);
  res.json({ concept: c.rows[0], assets: a.rows, entitled: !!ent.entitled });
}));

router.patch('/:id', authenticate, [
  body('title').optional().trim().notEmpty(),
  body('stage').optional().isIn(STAGES),
  body('category').optional().isIn(CATEGORIES),
  body('risk_summary').optional().isString(),
  body('working_since').optional({ nullable: true }).isISO8601(),
  body('show_working_since').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { title, stage, category, risk_summary, working_since, show_working_since } = req.body;
  const r = await query(
    `UPDATE concepts SET
       title=COALESCE($3,title), stage=COALESCE($4,stage),
       category=COALESCE($5,category), risk_summary=COALESCE($6,risk_summary),
       working_since=COALESCE($7,working_since),
       show_working_since=COALESCE($8,show_working_since),
       updated_at=NOW()
     WHERE id=$1 AND owner_id=$2 RETURNING *`,
    [req.params.id, req.user.id, title, stage, category, risk_summary,
     working_since || null, typeof show_working_since === 'boolean' ? show_working_since : null]);
  if (!r.rows.length) throw new ApiError(404, 'Concept not found.');
  res.json({ concept: r.rows[0] });
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const r = await query('DELETE FROM concepts WHERE id=$1 AND owner_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Concept not found.');
  res.json({ ok: true });
}));

module.exports = router;
