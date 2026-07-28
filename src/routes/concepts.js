const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { CATEGORIES, MODES } = require('../services/clay/tools');
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
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { title, stage, category, risk_summary } = req.body;
  const r = await query(
    `UPDATE concepts SET
       title=COALESCE($3,title), stage=COALESCE($4,stage),
       category=COALESCE($5,category), risk_summary=COALESCE($6,risk_summary),
       updated_at=NOW()
     WHERE id=$1 AND owner_id=$2 RETURNING *`,
    [req.params.id, req.user.id, title, stage, category, risk_summary]);
  if (!r.rows.length) throw new ApiError(404, 'Concept not found.');
  res.json({ concept: r.rows[0] });
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const r = await query('DELETE FROM concepts WHERE id=$1 AND owner_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Concept not found.');
  res.json({ ok: true });
}));

module.exports = router;
