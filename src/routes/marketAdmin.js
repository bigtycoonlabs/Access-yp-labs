// THE DREAM MARKET CONTROL CENTRE — one place, everything.
//
// Before this, running the market meant three screens that did not agree with each other: a review
// queue that only showed things awaiting review and could not edit them, a console section that
// listed Clay's seeded projects and linked back to the review queue, and the public listing page for
// actually seeing anything. Clicking a Clay listing sent you to the review queue where you could not
// add a thing. That is not a workflow; it is a maze somebody has to hold in their head.
//
// This returns every listing that matters with the filters a person actually thinks in — what is
// waiting on me, what is live, whose is it — and enough detail on each to decide without opening
// another page. The actions live on the same screen: approve, reject, edit, generate the brief.

const express = require('express');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');

const router = express.Router();
const staffOnly = [authenticate, authorize('staff', 'admin', 'master_staff')];

const CLAY_EMAIL = 'clay@accessyplabs.com';

// GET /api/market-admin — the whole market, filtered.
//
//   status : waiting | live | all      (default waiting, because that is what needs a person)
//   owner  : clay | creators | all     (default all)
//
// One query rather than one per tab: the counts have to agree with the list, and computing them
// separately is how a badge says 3 while the list shows 2.
router.get('/', staffOnly, asyncHandler(async (req, res) => {
  const status = ['waiting', 'live', 'all'].includes(req.query.status) ? req.query.status : 'waiting';
  const owner = ['clay', 'creators', 'all'].includes(req.query.owner) ? req.query.owner : 'all';

  const r = await query(`
    SELECT l.id, l.status, l.price_cents, l.starting_bid_cents, l.stage_label, l.format, l.created_at,
           c.id AS concept_id, c.title, c.category, c.risk_summary, c.brief, c.clays_take,
           (c.launch_page IS NOT NULL) AS has_page,
           u.email = $1 AS is_clays,
           COALESCE(u.display_name, 'no tag') AS seller_tag,
           (SELECT count(*)::int FROM assets a WHERE a.concept_id = c.id AND a.is_current) AS materials,
           EXISTS (SELECT 1 FROM assets a WHERE a.concept_id = c.id AND a.type='html_demo' AND a.is_current) AS has_demo,
           (SELECT count(*)::int FROM listing_visits v WHERE v.listing_id = l.id) AS visits
      FROM listings l
      JOIN concepts c ON c.id = l.concept_id
      JOIN users u ON u.id = l.seller_id
     WHERE l.status IN ('in_review','live','withdrawn','sold')
     ORDER BY
       CASE l.status WHEN 'in_review' THEN 0 WHEN 'live' THEN 1 ELSE 2 END,
       l.created_at DESC
     LIMIT 300`, [CLAY_EMAIL]);

  const all = r.rows.map((x) => {
    const b = x.brief && typeof x.brief === 'object' ? x.brief : null;
    return {
      ...x,
      brief: b,
      // Named here rather than worked out in the page, so the list and the warnings cannot drift.
      needs_brief: !b || !(b.problem || b.customer),
      needs_materials: x.materials === 0,
    };
  });

  const matches = (x) => {
    if (status === 'waiting' && x.status !== 'in_review') return false;
    if (status === 'live' && x.status !== 'live') return false;
    if (owner === 'clay' && !x.is_clays) return false;
    if (owner === 'creators' && x.is_clays) return false;
    return true;
  };

  // Counts computed from the SAME rows the list comes from.
  const counts = {
    waiting: all.filter((x) => x.status === 'in_review').length,
    live: all.filter((x) => x.status === 'live').length,
    clays: all.filter((x) => x.is_clays).length,
    creators: all.filter((x) => !x.is_clays).length,
    needs_brief: all.filter((x) => x.status === 'live' && x.needs_brief).length,
  };

  res.json({ ok: true, counts, listings: all.filter(matches) });
}));

// POST /api/market-admin/:id/brief — write the four lines a buyer reads.
//
// Here rather than on the concepts route because this is where somebody is looking at the listing
// and noticing it is missing. Works for ANY listing: a creator's own words are theirs, but an
// opportunity brief generated from their materials is the thing that makes their listing legible,
// and leaving a creator's listing unexplainable to protect a boundary would serve nobody.
router.post('/:id/brief', staffOnly, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT l.id, c.id AS concept_id, c.title FROM listings l
       JOIN concepts c ON c.id = l.concept_id WHERE l.id = $1`, [req.params.id]);
  if (!r.rows.length) throw new ApiError(404, 'That listing could not be found.');

  const { ensureBriefFor } = require('../services/clay/brief');
  let out;
  try { out = await ensureBriefFor(r.rows[0].concept_id); }
  catch (e) { out = { ok: false, reason: (e && e.message) || 'threw' }; }

  if (!out || out.ok === false) {
    return res.status(502).json({
      ok: false,
      message: 'Clay could not write the brief just now, so nothing was changed and nothing was '
        + 'invented. Reason: ' + ((out && out.reason) || 'unknown') + '.',
    });
  }
  const after = await query('SELECT brief FROM concepts WHERE id=$1', [r.rows[0].concept_id]);
  res.json({ ok: true, brief: after.rows[0].brief,
    message: 'Brief written. It is what a buyer reads at the top of the listing.' });
}));

module.exports = router;
