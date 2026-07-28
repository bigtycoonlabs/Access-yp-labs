const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { CATEGORIES, MODES } = require('../services/clay/tools');
const { conceptEntitlement, paywall } = require('../lib/entitlement');
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
  const r = await query('SELECT * FROM concepts WHERE owner_id=$1 ORDER BY updated_at DESC', [req.user.id]);
  res.json({ concepts: r.rows });
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
  const a = await query('SELECT * FROM assets WHERE concept_id=$1 ORDER BY created_at', [req.params.id]);
  res.json({ concept: c.rows[0], assets: a.rows });
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
