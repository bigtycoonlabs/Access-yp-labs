// BUSINESSES — a business is a first-class object, not a setting.
//
// Somebody running a cleaning company in Ohio, an Airbnb LLC in Tennessee and a consulting entity in
// Delaware has three annual reports in three jurisdictions with three sets of penalties. Every tool
// they can buy models one business per account, so they either run three subscriptions or keep two
// of them in their head. They are the likeliest person alive to lose an entity to administrative
// dissolution, and they are exactly who this is for.
//
// These routes deliberately do not have a "setup" shape. There are no wizard steps and no required
// fields beyond a name, because the onboarding is a conversation and Penny fills the rest in as she
// learns it. A form that demands entity type and formation state before it will save anything is
// how a person bounces on day one.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const P = require('../lib/permissions');

const router = express.Router();

const bad = (req) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, e.array()[0].msg);
};

// Everything this person can reach. Owners first, then businesses they hold a relationship to.
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const rows = await P.myBusinesses(req.user.id);
  res.json({ businesses: rows });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const perms = await P.forBusiness(req.user.id, req.params.id);
  // No access and does-not-exist are the same response on purpose HERE, because this is an id in a
  // URL and distinguishing them would let somebody enumerate businesses. The legible refusal
  // belongs in conversation with Penny, where there is a name to say and a person to point at.
  if (!perms) throw new ApiError(404, 'No such business, or you do not have access to it.');
  res.json({
    business: perms.business,
    relationship: perms.relationship,
    areas: perms.areas,
    is_owner: perms.isOwner,
  });
}));

// Only a name is required. Everything else arrives as Penny learns it.
router.post('/', authenticate, [
  body('name').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('A business needs a name.'),
  body('entity_type').optional({ values: 'falsy' }).isIn(
    ['sole_proprietor', 'llc', 's_corp', 'c_corp', 'partnership', 'nonprofit', 'other']),
  body('formation_state').optional({ values: 'falsy' }).isString().trim().isLength({ max: 40 }),
  body('operating_states').optional().isArray(),
  body('trade').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 }),
], asyncHandler(async (req, res) => {
  bad(req);
  const b = req.body;
  // Operating states default to the formation state when nothing else is known, because the common
  // case is a business that operates where it was formed — and an empty array would quietly mean
  // "owes nothing anywhere", which is the wrong default for a compliance product.
  const operating = Array.isArray(b.operating_states) && b.operating_states.length
    ? b.operating_states
    : (b.formation_state ? [b.formation_state] : []);

  const r = await query(
    `INSERT INTO businesses (owner_id, name, legal_name, entity_type, formation_state,
                             operating_states, trade, stage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'running'))
     RETURNING *`,
    [req.user.id, b.name.trim(), b.legal_name || null, b.entity_type || null,
      b.formation_state || null, operating, b.trade || null, b.stage || null]);
  res.status(201).json({ business: r.rows[0] });
}));

router.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const gate = await P.can(req.user.id, req.params.id, 'team', 'manage');
  if (!gate.ok) {
    throw new ApiError(gate.reason === 'no_access' ? 404 : 403,
      P.refusalLine(gate, 'team', gate.perms && gate.perms.business.name));
  }
  const allowed = ['name', 'legal_name', 'entity_type', 'formation_state',
    'operating_states', 'localities', 'trade', 'headcount', 'stage'];
  const sets = []; const vals = [];
  allowed.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      vals.push(req.body[k]); sets.push(k + '=$' + (vals.length + 1));
    }
  });
  if (!sets.length) throw new ApiError(400, 'Nothing to change.');
  vals.unshift(req.params.id);
  const r = await query(
    `UPDATE businesses SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 RETURNING *`, vals);
  res.json({ business: r.rows[0] });
}));

// Archived, never deleted. A business that is wound down still has filings that were owed, and a
// dissolved entity can still be audited — so the record stays and stops appearing.
router.post('/:id/archive', authenticate, asyncHandler(async (req, res) => {
  const perms = await P.forBusiness(req.user.id, req.params.id);
  if (!perms) throw new ApiError(404, 'No such business, or you do not have access to it.');
  if (!perms.isOwner) throw new ApiError(403, 'Only the owner can archive a business.');
  await query('UPDATE businesses SET archived_at=now(), updated_at=now() WHERE id=$1', [req.params.id]);
  res.json({ archived: true, note: 'Archived rather than deleted. Nothing it owed has been erased.' });
}));

// WHO IS ON THIS BUSINESS. Not every relationship is a login — a landlord is a record, a vendor is
// a record and a thread, a customer gets the portal.
router.get('/:id/people', authenticate, asyncHandler(async (req, res) => {
  const gate = await P.can(req.user.id, req.params.id, 'team', 'view');
  if (!gate.ok) {
    throw new ApiError(gate.reason === 'no_access' ? 404 : 403,
      P.refusalLine(gate, 'team', gate.perms && gate.perms.business.name));
  }
  const r = await query(
    `SELECT r.id, r.user_id, r.display_name, r.email, r.kind, r.started_on, r.ended_on,
            (r.user_id IS NOT NULL) AS has_login,
            COALESCE(json_object_agg(p.area, p.level) FILTER (WHERE p.area IS NOT NULL), '{}'::json) AS areas
       FROM relationships r
       LEFT JOIN permissions p ON p.relationship_id = r.id
      WHERE r.business_id=$1
      GROUP BY r.id
      ORDER BY r.ended_on NULLS FIRST, r.created_at ASC`, [req.params.id]);
  res.json({ people: r.rows });
}));

module.exports = router;
