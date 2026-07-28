const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { MODES, CATEGORIES } = require('../services/clay/tools');
const clay = require('../services/clay');
const router = express.Router();

// Persist a full Clay result: concept (create) or new assets (enhance) + a
// generations row recording the honest result_status. Uses a transaction so a
// partial/failed generation never leaves half-written data.
async function persistResult(ownerId, result, { conceptId = null, mode, category, prompt }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    let concept;
    if (conceptId) {
      const c = await client.query('SELECT * FROM concepts WHERE id=$1 AND owner_id=$2', [conceptId, ownerId]);
      if (!c.rows.length) throw new ApiError(404, 'Concept not found.');
      concept = c.rows[0];
      if (result.risk_summary) {
        await client.query('UPDATE concepts SET risk_summary=$2, updated_at=NOW() WHERE id=$1',
          [concept.id, result.risk_summary]);
      }
    } else {
      const c = await client.query(
        `INSERT INTO concepts (owner_id, title, mode, category, risk_summary)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [ownerId, result.title || 'Untitled concept', mode,
         result.inferred_category || category || null, result.risk_summary || null]);
      concept = c.rows[0];
    }
    for (const a of (result.assets || [])) {
      await client.query(
        `INSERT INTO assets (concept_id, type, title, body, is_baseline)
         VALUES ($1,$2,$3,$4,$5)`,
        [concept.id, a.type, a.label, a.body,
         ['business_plan', 'marketing_strategy'].includes(a.type)]);
    }
    await client.query(
      `INSERT INTO generations (concept_id, prompt, result_status) VALUES ($1,$2,$3)`,
      [concept.id, prompt || null, result.result_status]);
    await client.query('COMMIT');
    return concept;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// POST /api/clay/generate  { mode, category?, prompt, concept_id? }
router.post('/generate', authenticate, [
  body('mode').isIn(MODES),
  body('category').optional().isIn(CATEGORIES),
  body('prompt').isString().isLength({ min: 3 }),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { mode, category, prompt, concept_id } = req.body;

  const result = await clay.generate({ mode, category, prompt });

  // Honest non-answers: record the run against a concept if we have one, and
  // return the status + message WITHOUT inventing a package.
  if (result.result_status !== 'answered') {
    if (concept_id) {
      await query('INSERT INTO generations (concept_id, prompt, result_status) VALUES ($1,$2,$3)',
        [concept_id, prompt, result.result_status]).catch(() => {});
    }
    return res.status(200).json({
      status: result.result_status,
      redirect: result.redirect || null,
      message: result.message,
      inferred_category: result.inferred_category || null,
    });
  }

  const concept = await persistResult(req.user.id, result, { conceptId: concept_id, mode, category, prompt });
  const assets = await query('SELECT id,type,title,is_baseline FROM assets WHERE concept_id=$1 ORDER BY created_at', [concept.id]);
  res.status(201).json({
    status: 'answered',
    concept,
    assets: assets.rows,
    coverage: result.coverage,
    message: result.message,
  });
}));

// GET /api/clay/status — is generation actually available right now? (honest)
router.get('/status', authenticate, (req, res) => {
  const available = !!process.env.ANTHROPIC_API_KEY;
  res.json({ available, model: clay.MODEL,
    message: available ? 'Clay is ready.' : 'Clay generation is not configured yet.' });
});

module.exports = router;
