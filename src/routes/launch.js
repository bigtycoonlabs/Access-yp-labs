const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const store = require('../services/clay/store');
const router = express.Router();

function checkoutBase() {
  return (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
}
async function activeProducts(conceptId) {
  const r = await query(
    'SELECT id, name, price_cents, currency, description, image_url, kind FROM store_products WHERE concept_id=$1 AND active=true ORDER BY sort_order, created_at',
    [conceptId]);
  return r.rows.map((p) => ({
    id: p.id, name: p.name, price_display: store.formatPrice(p.price_cents, p.currency),
    description: p.description || '', image_url: p.image_url || '', kind: p.kind,
  }));
}

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
  const pages = await query(
    'SELECT slug, title, kind FROM site_pages WHERE concept_id=$1 AND published=true ORDER BY nav_order, created_at',
    [c.id]);
  const products = await activeProducts(c.id);
  res.json({
    concept_id: c.id,
    title: c.title,
    slug: p.slug || null,
    headline: p.headline || c.title,
    subhead: p.subhead || '',
    blurb: p.blurb || '',
    cta_label: p.cta_label || 'Get early access',
    theme: p.theme || 'warm',
    hero_image: p.hero_image || '',
    count: cnt.rows[0].n,
    pages: pages.rows,
    products,
    checkout_action: checkoutBase() + '/api/store/' + c.id + '/checkout',
  });
}));

// GET /api/launch/:slug/:page — PUBLIC. A published sub-page of a published site: its content
// plus the site's nav, so the whole thing reads as one real resource site / blog.
router.get('/:slug/:page', asyncHandler(async (req, res) => {
  const r = await query(
    "SELECT id, title, launch_page FROM concepts WHERE launch_page->>'slug'=$1 AND (launch_page->>'enabled')='true' LIMIT 1",
    [req.params.slug]);
  if (!r.rows.length) throw new ApiError(404, 'This page isn’t available.');
  const c = r.rows[0];
  const p = c.launch_page || {};
  const pg = await query(
    'SELECT slug, title, body, kind FROM site_pages WHERE concept_id=$1 AND slug=$2 AND published=true LIMIT 1',
    [c.id, req.params.page]);
  if (!pg.rows.length) throw new ApiError(404, 'This page isn’t available.');
  const nav = await query(
    'SELECT slug, title, kind FROM site_pages WHERE concept_id=$1 AND published=true ORDER BY nav_order, created_at',
    [c.id]);
  res.json({
    concept_id: c.id,
    site_slug: p.slug || null,
    site_title: p.headline || c.title,
    theme: p.theme || 'warm',
    cta_label: p.cta_label || 'Get early access',
    page: pg.rows[0],
    pages: nav.rows,
  });
}));

module.exports = router;
