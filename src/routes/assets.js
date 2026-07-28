const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const router = express.Router();

// Assets for a concept the caller owns.
router.get('/concept/:conceptId', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2',
    [req.params.conceptId, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  const r = await query('SELECT * FROM assets WHERE concept_id=$1 ORDER BY created_at', [req.params.conceptId]);
  res.json({ assets: r.rows });
}));

// A single asset, owner-checked through its concept.
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT a.* FROM assets a JOIN concepts c ON c.id=a.concept_id
     WHERE a.id=$1 AND c.owner_id=$2`, [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Asset not found.');
  res.json({ asset: r.rows[0] });
}));

module.exports = router;
