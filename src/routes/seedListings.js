// STAFF EDITING OF CLAY'S OWN LISTINGS.
//
// Clay seeds the market so it is not empty, and those projects are owned by his account. That meant
// nobody could touch them: the listing edit route requires seller_id = the person asking, and no
// human IS Clay. So a seeded listing with a weak title, a wrong price or a thin blurb was frozen —
// the only options were approve it as-is or reject it, and rejecting throws away the whole build.
//
// THE BOUNDARY THAT MATTERS, and it is the reason this is a separate file rather than a loosened
// permission on the existing route: staff may edit CLAY'S listings and nobody else's. A creator's
// listing is their work and their words. Staff can approve it, reject it with a reason, or take it
// down on policy grounds — they cannot rewrite it. Editing someone's sales copy on their behalf,
// silently, under their own dreamer tag, would be a serious breach of what this platform promises.
//
// Every edit here is recorded in the audit log with the editor's name, because "the platform owner
// changed the price on platform-owned inventory" should be a fact somebody can look up later.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { PRICE_FLOOR_CENTS } = require('../lib/money');

const router = express.Router();
const staffOnly = [authenticate, authorize('staff', 'admin', 'master_staff')];

// Confirm the listing belongs to Clay before ANY change is considered.
async function clayListing(id) {
  const r = await query(
    `SELECT l.id, l.status, l.price_cents, l.format, l.concept_id,
            c.title, c.origin, c.owner_id, u.email AS owner_email
       FROM listings l
       JOIN concepts c ON c.id = l.concept_id
       JOIN users u ON u.id = c.owner_id
      WHERE l.id = $1`, [id]);
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  const row = r.rows[0];
  // Two independent checks rather than one. origin could in principle be edited; the owning account
  // cannot be. Requiring both means a mislabelled row still cannot open a door to someone's work.
  const isClays = row.origin === 'clay_seed' && row.owner_email === 'clay@accessyplabs.com';
  if (!isClays) return { ok: false, reason: 'not_clays' };
  return { ok: true, listing: row };
}

const NOT_YOURS_TO_EDIT =
  'That listing belongs to a creator, not to Clay. You can approve it, reject it with a reason, or '
  + 'take it down on policy grounds — but its words are theirs. Rewriting somebody\'s listing under '
  + 'their own name is not something staff can do here.';

// GET /api/seed-listings — everything Clay owns that a person may edit, newest first.
router.get('/', staffOnly, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT l.id, l.status, l.price_cents, l.format, l.stage_label, l.created_at,
            c.id AS concept_id, c.title, c.risk_summary,
            (SELECT count(*)::int FROM assets a WHERE a.concept_id = c.id AND a.is_current) AS materials,
            (c.launch_page IS NOT NULL) AS has_landing_page,
            EXISTS (SELECT 1 FROM assets a WHERE a.concept_id = c.id AND a.type = 'html_demo' AND a.is_current) AS has_demo
       FROM listings l
       JOIN concepts c ON c.id = l.concept_id
       JOIN users u ON u.id = c.owner_id
      WHERE c.origin = 'clay_seed' AND u.email = 'clay@accessyplabs.com'
      ORDER BY l.created_at DESC
      LIMIT 100`);
  res.json({ ok: true, listings: r.rows });
}));

// PATCH /api/seed-listings/:id — title, blurb and terms, in one place.
//
// Title and blurb live on the project while price and format live on the listing, which is why the
// existing route could not change a title at all. Both are handled here so a person editing a
// listing does not have to know which table anything is in.
router.patch('/:id', staffOnly, [
  body('title').optional().isString().trim().isLength({ min: 3, max: 120 }),
  // There is no blurb column. A listing card shows the title, the category and the risk summary —
  // the descriptive text a buyer reads comes from the project's own materials. So the editable text
  // here is the title and the risk summary, and pretending otherwise would have shipped a field
  // that silently saved nowhere.
  body('risk_summary').optional().isString().trim().isLength({ max: 2000 }),
  body('price_cents').optional().isInt({ min: PRICE_FLOOR_CENTS }).toInt(),
  body('stage_label').optional().isIn(['concept', 'in_build', 'prepared_to_start']),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'A title needs 3 to 120 characters, and a price must be at least $'
        + (PRICE_FLOOR_CENTS / 100) + '.',
      errors: errors.array(),
    });
  }

  const found = await clayListing(req.params.id);
  if (!found.ok) {
    if (found.reason === 'not_found') throw new ApiError(404, 'That listing could not be found.');
    throw new ApiError(403, NOT_YOURS_TO_EDIT);
  }
  const l = found.listing;

  const changes = [];
  if (req.body.title !== undefined && req.body.title !== l.title) {
    await query('UPDATE concepts SET title=$2, updated_at=now() WHERE id=$1', [l.concept_id, req.body.title]);
    changes.push(`title: "${l.title}" to "${req.body.title}"`);
  }
  if (req.body.risk_summary !== undefined) {
    await query('UPDATE concepts SET risk_summary=$2, updated_at=now() WHERE id=$1', [l.concept_id, req.body.risk_summary]);
    changes.push('risk summary rewritten');
  }
  if (req.body.price_cents !== undefined && req.body.price_cents !== l.price_cents) {
    await query('UPDATE listings SET price_cents=$2 WHERE id=$1', [l.id, req.body.price_cents]);
    changes.push(`price: $${(l.price_cents / 100).toFixed(2)} to $${(req.body.price_cents / 100).toFixed(2)}`);
  }
  if (req.body.stage_label !== undefined) {
    await query('UPDATE listings SET stage_label=$2 WHERE id=$1', [l.id, req.body.stage_label]);
    changes.push(`stage: ${req.body.stage_label}`);
  }

  if (!changes.length) return res.json({ ok: true, changed: false, message: 'Nothing was different, so nothing changed.' });

  // Recorded with a name on it. Platform-owned inventory being edited by the platform is fine and
  // normal — it being untraceable afterwards is not.
  await query(
    `INSERT INTO moderation_events (actor_id, target_type, target_id, action, note)
     VALUES ($1,'listing',$2,'note',$3)`,
    [req.user.id, l.id, 'STAFF EDIT of a Clay-seeded listing — ' + changes.join('; ')]
  ).catch((e) => console.error('could not record the seed-listing edit:', e && e.message));

  res.json({
    ok: true,
    changed: true,
    changes,
    message: 'Updated: ' + changes.join('; ') + '. Recorded in the audit log.',
  });
}));

module.exports = router;
module.exports.clayListing = clayListing;
