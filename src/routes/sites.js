// PUBLIC serving of a creator's site by its own Host (a subdomain like x.sites.accessyplabs.com,
// or their custom domain). Resolves the Host to the concept and returns the same shape the
// slug-based /api/launch endpoints return, so launch.html renders either way.
const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const domains = require('../services/clay/domains');
const domainStore = require('../services/clay/domainStore');
const router = express.Router();

async function conceptForRequest(req) {
  const host = domains.hostOf(req);
  return domainStore.conceptForHost(host);
}

router.get('/', asyncHandler(async (req, res) => {
  const conceptId = await conceptForRequest(req);
  if (!conceptId) throw new ApiError(404, 'This page isn’t available.');
  const r = await query('SELECT id, title, launch_page FROM concepts WHERE id=$1 LIMIT 1', [conceptId]);
  const c = r.rows[0];
  const p = (c && c.launch_page) || {};
  if (!c || String(p.enabled) !== 'true') throw new ApiError(404, 'This page isn’t available.');
  const cnt = await query('SELECT COUNT(*)::int AS n FROM waitlist_signups WHERE concept_id=$1', [c.id]);
  const pages = await query('SELECT slug, title, kind FROM site_pages WHERE concept_id=$1 AND published=true ORDER BY nav_order, created_at', [c.id]);
  res.json({
    concept_id: c.id, title: c.title, slug: p.slug || null,
    headline: p.headline || c.title, subhead: p.subhead || '', blurb: p.blurb || '',
    cta_label: p.cta_label || 'Get early access', theme: p.theme || 'warm', hero_image: p.hero_image || '',
    count: cnt.rows[0].n, pages: pages.rows, host_mode: true,
  });
}));

router.get('/:page', asyncHandler(async (req, res) => {
  const conceptId = await conceptForRequest(req);
  if (!conceptId) throw new ApiError(404, 'This page isn’t available.');
  const r = await query('SELECT id, title, launch_page FROM concepts WHERE id=$1 LIMIT 1', [conceptId]);
  const c = r.rows[0];
  const p = (c && c.launch_page) || {};
  if (!c || String(p.enabled) !== 'true') throw new ApiError(404, 'This page isn’t available.');
  const pg = await query('SELECT slug, title, body, kind FROM site_pages WHERE concept_id=$1 AND slug=$2 AND published=true LIMIT 1', [conceptId, req.params.page]);
  if (!pg.rows.length) throw new ApiError(404, 'This page isn’t available.');
  const nav = await query('SELECT slug, title, kind FROM site_pages WHERE concept_id=$1 AND published=true ORDER BY nav_order, created_at', [conceptId]);
  res.json({
    concept_id: conceptId, site_slug: p.slug || null, site_title: p.headline || c.title,
    theme: p.theme || 'warm', cta_label: p.cta_label || 'Get early access',
    page: pg.rows[0], pages: nav.rows, host_mode: true,
  });
}));

module.exports = router;
