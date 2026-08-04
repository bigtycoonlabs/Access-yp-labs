const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const router = express.Router();

// GET /api/launch/:slug — PUBLIC. Resolve a published launch page by its slug, returning the copy
// and the concept id the coming-soon page needs to send signups to. Only published pages resolve.
router.get('/:slug', asyncHandler(async (req, res) => {
  const r = await query(
    "SELECT id, title, launch_page FROM concepts WHERE launch_page->>'slug'=$1 AND (launch_page->>'enabled')='true' LIMIT 1",
    [req.params.slug]);
  if (!r.rows.length) throw new ApiError(404, 'This page isn’t available.');
  const c = r.rows[0];
  const p = c.launch_page || {};
  const cnt = await query('SELECT COUNT(*)::int AS n FROM waitlist_signups WHERE concept_id=$1', [c.id]);
  res.json({
    concept_id: c.id,
    title: c.title,
    headline: p.headline || c.title,
    subhead: p.subhead || '',
    blurb: p.blurb || '',
    cta_label: p.cta_label || 'Get early access',
    count: cnt.rows[0].n,
  });
}));

module.exports = router;
