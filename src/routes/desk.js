// THE DESK — Access YP Labs' public window.
//
// A live, honest pulse of the platform: how many ideas have taken shape, how many are live in the
// Dreamhold, and a gentle feed of ideas being shaped and arriving for sale. It exists to show the
// world, truthfully, that here the ideas of the future get built, proven, and sold.
//
// PRIVACY-SAFE BY CONSTRUCTION (the same discipline Arbo's public desk holds — aggregate only, no
// per-person rows a viewer could tie to someone):
//   - The pulse is counts only.
//   - "Arrived" feed items come ONLY from LIVE listings, which are already public in the
//     marketplace — so their title and category are already out in the open.
//   - "Shaped" feed items come from concept creation but are stripped to a pure, anonymous momentum
//     signal: no title, no owner, no category, and delayed a couple of minutes so nothing is
//     instantaneous. A private, unlisted idea reveals nothing here but that an idea took shape.
// No authentication; nothing on this endpoint can identify a creator or expose an unlisted idea.

const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler } = require('../lib/http');
const { authenticate, authorize } = require('../middleware/auth');
const deskCompose = require('../services/clay/deskCompose');

// Friendly labels for the category enum tokens. Only ever shown for PUBLIC live listings.
const CATEGORY_LABELS = {
  digital_product_saas: 'Digital product or SaaS',
  online_service_agency: 'Online service or agency',
  content_creator: 'Content creator',
  ecommerce_pod: 'E-commerce or print-on-demand',
  ai_product_service: 'AI product or service',
  remote_hybrid_physical: 'Remote or hybrid business',
  micro_solo: 'Micro or solo business',
};
function catLabel(c) { return CATEGORY_LABELS[c] || 'a new venture'; }

// GET /api/desk — the live pulse + privacy-safe feed. Best-effort: on any error it returns an empty
// but well-formed shape so the page degrades gracefully rather than breaking.
router.get('/', asyncHandler(async (req, res) => {
  let pulse = { ideas_shaped: 0, ideas_shaped_7d: 0, in_dreamhold: 0 };
  let feed = [];
  try {
    pulse = (await query(`
      SELECT
        (SELECT count(*) FROM concepts)::int AS ideas_shaped,
        (SELECT count(*) FROM concepts WHERE created_at >= now() - interval '7 days')::int AS ideas_shaped_7d,
        (SELECT count(*) FROM listings WHERE status='live')::int AS in_dreamhold
    `)).rows[0] || pulse;

    // Public marketplace arrivals — title + category are already public for a live listing.
    const arrivals = (await query(`
      SELECT c.title, c.category::text AS category, l.created_at AS at
        FROM listings l JOIN concepts c ON c.id = l.concept_id
       WHERE l.status = 'live'
       ORDER BY l.created_at DESC
       LIMIT 8
    `)).rows.map((r) => ({
      kind: 'arrived',
      title: r.title,
      category: catLabel(r.category),
      at: r.at,
    }));

    // Anonymous shaping pulses — pure momentum, no attribute of the idea or its owner, delayed a
    // couple of minutes so nothing on the public desk is instantaneous.
    const shaped = (await query(`
      SELECT created_at AS at
        FROM concepts
       WHERE created_at < now() - interval '2 minutes'
       ORDER BY created_at DESC
       LIMIT 10
    `)).rows.map((r) => ({ kind: 'shaped', at: r.at }));

    feed = [...arrivals, ...shaped]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 14);
  } catch (e) {
    // Degrade gracefully — the page can still render its framing and invite people in.
    console.error('desk endpoint error:', e && e.message);
  }

  res.set('Cache-Control', 'public, max-age=10');
  res.json({ pulse, feed, generated_at: new Date().toISOString() });
}));

// GET /api/desk/articles — PUBLISHED Desk pieces only (public). Fetched once on page load, not
// polled, so it can carry full bodies. Draft/archived pieces never appear here.
router.get('/articles', asyncHandler(async (req, res) => {
  let articles = [];
  try { articles = await deskCompose.publishedArticles(12); }
  catch (e) { console.error('desk articles error:', e && e.message); }
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ articles });
}));

// GET /api/desk/drafts — pending Desk pieces awaiting a human's decision (staff).
router.get('/drafts', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  res.json({ drafts: await deskCompose.listDrafts(20) });
}));

// POST /api/desk/compose — have Clay draft a new Desk piece on demand (owner). Body: { kind, topic? }.
// It only ever creates a DRAFT; publishing is a separate, deliberate step.
router.post('/compose', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const kind = req.body && req.body.kind === 'story' ? 'story' : 'help';
  const topic = req.body && typeof req.body.topic === 'string' ? req.body.topic.slice(0, 120) : null;
  const out = await deskCompose.composePiece({ kind, topic, source: 'manual' });
  res.json(out);
}));

// POST /api/desk/:id/publish — an owner approves a draft, making it public on the Desk.
router.post('/:id/publish', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const row = await deskCompose.publish(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'No such draft (it may already be published or archived).' });
  res.json({ ok: true, published: row });
}));

// POST /api/desk/:id/archive — take a piece down / discard a draft (owner).
router.post('/:id/archive', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const row = await deskCompose.archive(req.params.id);
  if (!row) return res.status(404).json({ error: 'No such piece.' });
  res.json({ ok: true, archived: row });
}));

module.exports = router;
