const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { conceptEntitlement, paywall } = require('../lib/entitlement');
const protect = require('../lib/protect');
const describe = require('../lib/describe');
const router = express.Router();

// Current assets for a concept the caller owns (in-laboratory VIEW — free).
router.get('/concept/:conceptId', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2',
    [req.params.conceptId, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  const r = await query(
    'SELECT * FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at', [req.params.conceptId]);
  res.json({ assets: r.rows });
}));

// Version history (superseded assets) for a concept the caller owns.
router.get('/concept/:conceptId/history', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2',
    [req.params.conceptId, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  const r = await query(
    `SELECT id, type, title, version, is_current, created_at FROM assets
     WHERE concept_id=$1 ORDER BY type, version DESC`, [req.params.conceptId]);
  res.json({ history: r.rows });
}));

// Current interactive HTML demo for a concept the caller owns (free — viewing
// your own work-in-progress in the live sandbox is part of building; only
// export/download is plan-gated).
router.get('/concept/:conceptId/demo', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2',
    [req.params.conceptId, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  const r = await query(
    `SELECT id, title, body FROM assets WHERE concept_id=$1 AND is_current=true
     AND type IN ('html_demo','built_site') ORDER BY created_at DESC LIMIT 1`, [req.params.conceptId]);
  if (!r.rows.length) throw new ApiError(404, 'This concept has no demo yet. Ask Clay to build an HTML demo.');
  const demo = r.rows[0];
  res.json({ demo, description: describe.outline(demo.body) });
}));

// A single asset (owner view — free).
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT a.* FROM assets a JOIN concepts c ON c.id=a.concept_id
     WHERE a.id=$1 AND c.owner_id=$2`, [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Asset not found.');
  res.json({ asset: r.rows[0] });
}));

// GATED download of the clean asset. Requires an active plan (or staff, or a
// purchased concept's included first month) and, for code, a clean scan.
router.get('/:id/download', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT a.*, c.owner_id FROM assets a JOIN concepts c ON c.id=a.concept_id WHERE a.id=$1`,
    [req.params.id]);
  if (!r.rows.length) throw new ApiError(404, 'Asset not found.');
  const asset = r.rows[0];

  const ent = await conceptEntitlement(req.user, asset.concept_id);
  if (!ent.entitled) {
    if (ent.reason === 'not_found') throw new ApiError(404, 'Asset not found.');
    if (ent.reason === 'not_owner') throw new ApiError(403, 'This is not your concept.');
    return res.status(402).json(paywall(asset.concept_id));
  }
  if (protect.needsScan(asset.type)) {
    if (asset.scan_status === 'pending') return res.status(409).json({ error: 'scan_in_progress', message: 'This file is still being scanned for malware. Try again shortly.' });
    if (asset.scan_status === 'flagged') return res.status(403).json({ error: 'blocked_by_scan', message: 'This file was flagged by the malware scan and cannot be downloaded: ' + (asset.scan_detail || 'flagged') });
  }
  res.json({ asset: { id: asset.id, type: asset.type, title: asset.title, body: asset.body, file_url: asset.file_url } });
}));

// Watermarked, obfuscated PREVIEW for marketplace browsing (never the clean file).
router.get('/:id/preview', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT a.*, c.owner_id,
       (SELECT 1 FROM listings l WHERE l.concept_id=a.concept_id AND l.status='live' LIMIT 1) AS listed
     FROM assets a JOIN concepts c ON c.id=a.concept_id WHERE a.id=$1`, [req.params.id]);
  if (!r.rows.length) throw new ApiError(404, 'Asset not found.');
  const a = r.rows[0];
  if (a.owner_id !== req.user.id && !a.listed) throw new ApiError(403, 'No preview available.');

  const label = a.title || a.type;
  const isHtml = ['html_demo', 'built_site'].includes(a.type);
  const preview = isHtml ? protect.watermarkHtml(a.body, label) : protect.watermarkText(a.body, label);
  res.json({
    preview: { id: a.id, type: a.type, title: a.title, watermarked: true,
      format: isHtml ? 'html' : 'text', content_b64: protect.obfuscate(preview) },
  });
}));

module.exports = router;
