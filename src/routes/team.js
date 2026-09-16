// TEAM — relationships, and the permissions attached to them.
//
// The capability model has been enforced at every read since it was built, and until now an owner
// had no way to actually grant anything. A permission system nobody can use is a permission system
// that gets replaced by sharing a password.
//
// WHY RELATIONSHIPS RATHER THAN MEMBERS. A team_members table assumes everybody on a business is the
// same kind of person and differs only in access. Real small businesses do not look like that: a
// virtual assistant running sales and social, an owner who closes, and third-party cleaners who
// deliver the service are three different relationships, none of them employment, in a business most
// software models as one person.
//
// AND NOT EVERY RELATIONSHIP IS A LOGIN. A landlord is a record. A vendor is a record and a thread.
// A customer gets the portal. Only the people who work in the business take a seat, which is also
// what makes counting seats fair.
//
// THE RELATIONSHIP CREATES OBLIGATIONS. This is where the team screen stops being admin and earns
// its place on the spine: adding a contractor raises a W-9, and adding an employee raises workers
// comp — which in most states is triggered by the FIRST hire and is one of the genuinely dangerous
// moments in a small business that almost nothing warns you about.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const P = require('../lib/permissions');
const compliance = require('../services/clay/compliance');

const router = express.Router();

const bad = (req) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, e.array()[0].msg);
};

// Sensible starting points, not fixed roles. Fixed roles break immediately on real teams: somebody
// who does compliance AND development is not admin and not staff, and inventing a role for every
// combination is how a permission system becomes unusable. These are a first click; every area can
// be changed afterwards.
const PRESETS = {
  bookkeeper: { money: 'view', documents: 'view' },
  accountant: { money: 'view', documents: 'view', compliance: 'view' },
  compliance_manager: { compliance: 'act', documents: 'act' },
  developer: { projects: 'manage', sites: 'manage' },
  operations: { customers: 'act', projects: 'act', team: 'view' },
  office_manager: { customers: 'act', documents: 'act', compliance: 'view', money: 'view' },
  full_admin: { compliance: 'manage', money: 'manage', customers: 'manage', team: 'manage',
    documents: 'manage', projects: 'manage', sites: 'manage' },
  // Export is in NO preset, on purpose. It is the one capability that removes data from the
  // building, and it should be a deliberate act rather than something that arrives with a job title.
};

router.get('/presets', authenticate, asyncHandler(async (req, res) => {
  res.json({ presets: PRESETS, areas: P.AREAS, levels: P.LEVELS });
}));

// Add a person. Only a name and a kind are required — an email turns it into an invitation later,
// and a landlord or vendor may never need one.
router.post('/', authenticate, [
  body('business_id').isUUID().withMessage('Which business?'),
  body('display_name').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('What is their name?'),
  body('kind').isIn(['owner', 'partner', 'employee', 'contractor', 'assistant',
    'vendor', 'landlord', 'customer', 'professional']),
  body('email').optional({ values: 'falsy' }).isEmail(),
], asyncHandler(async (req, res) => {
  bad(req);
  const b = req.body;
  const gate = await P.can(req.user.id, b.business_id, 'team', 'manage');
  if (!gate.ok) {
    throw new ApiError(gate.reason === 'no_access' ? 404 : 403,
      P.refusalLine(gate, 'team', gate.perms && gate.perms.business.name));
  }

  // If this email already belongs to an account, link it so they get a real seat rather than a
  // duplicate record with no way in.
  let userId = null;
  if (b.email) {
    const u = await query('SELECT id FROM users WHERE lower(email)=lower($1)', [b.email]);
    if (u.rows.length) userId = u.rows[0].id;
  }
  if (userId) {
    const dupe = await query(
      'SELECT id FROM relationships WHERE business_id=$1 AND user_id=$2 AND ended_on IS NULL',
      [b.business_id, userId]);
    if (dupe.rows.length) {
      throw new ApiError(409, 'They are already on this business. One person holds one relationship '
        + 'to a business — change what they can see rather than adding them twice.');
    }
  }

  const rel = await query(
    `INSERT INTO relationships (business_id, user_id, display_name, email, phone, kind, started_on, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.business_id, userId, b.display_name.trim(), b.email || null, b.phone || null,
      b.kind, b.started_on || null, b.notes || null]);

  // Permissions, from a preset or explicitly. A relationship with no permissions sees nothing, which
  // is the right default — absence is never permission.
  const wanted = b.permissions && typeof b.permissions === 'object'
    ? b.permissions
    : (PRESETS[b.preset] || {});
  const granted = {};
  for (const [area, level] of Object.entries(wanted)) {
    if (!P.AREAS.includes(area) || !P.LEVELS.includes(level) || level === 'none') continue;
    await query(
      `INSERT INTO permissions (relationship_id, area, level, granted_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (relationship_id, area)
       DO UPDATE SET level=EXCLUDED.level, granted_by=EXCLUDED.granted_by, granted_at=now()`,
      [rel.rows[0].id, area, level, req.user.id]);
    granted[area] = level;
  }

  // WHAT ADDING THEM MEANS, beyond access. This is the part nobody else does.
  const raised = [];
  const kindRules = {
    contractor: [
      { kind: 'task', title: 'Get a W-9 from ' + b.display_name.trim(),
        counterparty: b.display_name.trim(), counterparty_kind: 'contractor',
        consequence: 'Without it you cannot file their 1099 in January, and chasing a tax ID from '
          + 'somebody who has stopped working for you is much harder than asking on day one.' },
    ],
    assistant: [
      { kind: 'task', title: 'Confirm how ' + b.display_name.trim() + ' is classified',
        counterparty: b.display_name.trim(), counterparty_kind: 'contractor',
        consequence: 'An assistant working outside the US usually needs a W-8BEN rather than a W-9, '
          + 'and misclassifying somebody who works like an employee is expensive to unwind.' },
    ],
    employee: [
      { kind: 'insurance', title: 'Workers comp before their first day',
        counterparty: 'State', counterparty_kind: 'government',
        cost_basis: 'unknown',
        consequence: 'In most states the requirement is triggered by your first or second employee, '
          + 'and operating without it carries real penalties. This is one of the genuinely dangerous '
          + 'moments in a small business and almost nothing warns you about it.' },
    ],
    partner: [
      { kind: 'task', title: 'Operating agreement with ' + b.display_name.trim(),
        counterparty: b.display_name.trim(), counterparty_kind: 'self',
        consequence: 'Partnerships without one are settled by state default rules rather than by '
          + 'what the two of you actually agreed.' },
    ],
  };
  for (const r of (kindRules[b.kind] || [])) {
    const row = await query(
      `INSERT INTO obligations (business_id, kind, title, counterparty, counterparty_kind,
          cost_basis, consequence, source, source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'rule_engine',$8) RETURNING id, title, consequence`,
      [b.business_id, r.kind, r.title, r.counterparty, r.counterparty_kind,
        r.cost_basis || null, r.consequence,
        'Raised because you added a ' + b.kind + ' on ' + new Date().toISOString().slice(0, 10)]);
    raised.push(row.rows[0]);
  }

  res.status(201).json({
    person: rel.rows[0],
    permissions: granted,
    has_login: !!userId,
    // Said plainly rather than left for them to discover when the person cannot sign in.
    seat_note: userId
      ? null
      : (b.email
        ? 'No account exists for that email yet, so they are a record rather than a login for now.'
        : 'No email, so this is a record rather than a login — which is right for a landlord or a '
          + 'vendor who never needs to sign in.'),
    raised,
  });
}));

// Change what somebody can see. One area at a time, because a screen that rewrites every permission
// at once makes it very easy to remove access nobody meant to touch.
router.patch('/:relationshipId/permissions', authenticate, [
  body('area').isIn(P.AREAS),
  body('level').isIn(P.LEVELS),
], asyncHandler(async (req, res) => {
  bad(req);
  const rel = await query('SELECT * FROM relationships WHERE id=$1', [req.params.relationshipId]);
  if (!rel.rows.length) throw new ApiError(404, 'I cannot find that person.');
  const r = rel.rows[0];

  const gate = await P.can(req.user.id, r.business_id, 'team', 'manage');
  if (!gate.ok) {
    throw new ApiError(gate.reason === 'no_access' ? 404 : 403,
      P.refusalLine(gate, 'team', gate.perms && gate.perms.business.name));
  }
  // An owner cannot be demoted through this screen. Ownership is not a permission row, and letting
  // somebody with team:manage strip the owner would lock the business away from the person it
  // belongs to.
  if (r.kind === 'owner') {
    throw new ApiError(400, 'The owner\u2019s access is not something this screen changes.');
  }

  if (req.body.level === 'none') {
    await query('DELETE FROM permissions WHERE relationship_id=$1 AND area=$2',
      [r.id, req.body.area]);
  } else {
    await query(
      `INSERT INTO permissions (relationship_id, area, level, granted_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (relationship_id, area)
       DO UPDATE SET level=EXCLUDED.level, granted_by=EXCLUDED.granted_by, granted_at=now()`,
      [r.id, req.body.area, req.body.level, req.user.id]);
  }

  const now = await query(
    `SELECT COALESCE(json_object_agg(area, level) FILTER (WHERE area IS NOT NULL), '{}'::json) AS areas
       FROM permissions WHERE relationship_id=$1`, [r.id]);
  res.json({
    areas: now.rows[0].areas,
    // Export is worth naming every time it is granted, because it is the one that leaves.
    note: req.body.area === 'export' && req.body.level !== 'none'
      ? r.display_name + ' can now take data out of this business. Every export is logged.'
      : null,
  });
}));

// Somebody leaving. Ended, not deleted — the record of who had access and when is the thing an audit
// asks for, and deleting it destroys exactly that.
router.post('/:relationshipId/end', authenticate, asyncHandler(async (req, res) => {
  const rel = await query('SELECT * FROM relationships WHERE id=$1', [req.params.relationshipId]);
  if (!rel.rows.length) throw new ApiError(404, 'I cannot find that person.');
  const r = rel.rows[0];
  const gate = await P.can(req.user.id, r.business_id, 'team', 'manage');
  if (!gate.ok) {
    throw new ApiError(gate.reason === 'no_access' ? 404 : 403,
      P.refusalLine(gate, 'team', gate.perms && gate.perms.business.name));
  }
  if (r.kind === 'owner') throw new ApiError(400, 'You cannot remove the owner.');

  await query('UPDATE relationships SET ended_on=CURRENT_DATE WHERE id=$1', [r.id]);
  await query('DELETE FROM permissions WHERE relationship_id=$1', [r.id]);

  // Offboarding is a checklist people forget, and the forgetting is what causes the damage.
  const raised = await query(
    `INSERT INTO obligations (business_id, kind, title, counterparty, counterparty_kind,
        cost_basis, consequence, source, source_ref)
     VALUES ($1,'task',$2,$3,$4,'unknown',$5,'rule_engine',$6) RETURNING id, title`,
    [r.business_id, 'Finish offboarding ' + r.display_name, r.display_name, 'self',
      'Keys, shared logins, anything in their name, and final pay. Access here is already removed; '
      + 'the rest is the part people forget.',
      'Raised because ' + r.display_name + ' left on ' + new Date().toISOString().slice(0, 10)]);

  res.json({
    ended: true,
    says: r.display_name + ' no longer has access here. Their record stays, because who had access '
      + 'and when is what an audit asks for.',
    raised: raised.rows[0],
  });
}));

module.exports = router;
