const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { MODES, CATEGORIES } = require('../services/clay/tools');
const clay = require('../services/clay');
const { sendEmail } = require('../services/email');
const protect = require('../lib/protect');
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
      let scanStatus = 'not_required', scanDetail = null;
      if (protect.needsScan(a.type)) {
        const sc = protect.scanCode(a.body);
        scanStatus = sc.status; scanDetail = sc.detail;
      }
      // Versioning: a new asset of an existing type supersedes the prior current
      // one (kept as history: is_current=false) and increments the version.
      const prev = await client.query(
        'SELECT COALESCE(MAX(version),0) AS maxv FROM assets WHERE concept_id=$1 AND type=$2',
        [concept.id, a.type]);
      const nextVersion = prev.rows[0].maxv + 1;
      if (nextVersion > 1) {
        await client.query(
          'UPDATE assets SET is_current=false WHERE concept_id=$1 AND type=$2 AND is_current=true',
          [concept.id, a.type]);
      }
      await client.query(
        `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, scan_detail, version, is_current)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [concept.id, a.type, a.label, a.body,
         ['business_plan', 'marketing_strategy'].includes(a.type), scanStatus, scanDetail, nextVersion]);
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

  // Dual-channel delivery: email the package too. Best-effort; if it doesn't
  // send, we say so honestly rather than claiming a delivery that didn't happen.
  let emailed = { sent: false };
  try {
    emailed = await sendEmail({
      to: req.user.email,
      subject: 'Your concept from Clay: ' + (result.title || 'new concept'),
      html: buildPackageEmail(result.title || concept.title, result.coverage, result.assets),
    });
  } catch (e) { emailed = { sent: false, reason: e.message }; }

  res.status(201).json({
    status: 'answered',
    concept,
    assets: assets.rows,
    coverage: result.coverage,
    emailed: emailed.sent,
    message: result.message + (emailed.sent ? ' A copy was emailed to you.' : ''),
  });
}));

// GET /api/clay/status — is generation actually available right now? (honest)
router.get('/status', authenticate, (req, res) => {
  const available = !!process.env.ANTHROPIC_API_KEY;
  res.json({ available, model: clay.MODEL,
    message: available ? 'Clay is ready.' : 'Clay generation is not configured yet.' });
});


function escapeHtml(t){return String(t==null?'':t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function buildPackageEmail(title, coverage, assets){
  const parts = (assets||[]).map(a =>
    '<h2 style="color:#7c2d12;font-family:system-ui,sans-serif">'+escapeHtml(a.label||a.type)+'</h2>'+
    '<div style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">'+escapeHtml(a.body)+'</div>');
  const gap = coverage && !coverage.complete ? '<p style="color:#57534e">'+escapeHtml(coverage.gap_description)+'</p>' : '';
  return '<div style="max-width:640px;margin:0 auto">'+
    '<h1 style="font-family:system-ui,sans-serif;color:#1c1917">'+escapeHtml(title)+'</h1>'+
    '<p style="font-family:system-ui,sans-serif">Your concept package from Clay at Access YP Labs. You also have it in your workspace.</p>'+
    gap + parts.join('') +
    '<hr/><p style="color:#57534e;font-size:13px;font-family:system-ui,sans-serif">The Kiln is a neutral marketplace. Concepts are pre-proven starting points, not guarantees of income.</p></div>';
}

module.exports = router;
