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
const Team = require('../services/clay/team');
const { sendEmail } = require('../services/email');
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
  // Export is in NO preset, on purpose. Neither are keys, for the same reason. It is the one capability that removes data from the
  // building, and it should be a deliberate act rather than something that arrives with a job title.
};

router.get('/presets', authenticate, asyncHandler(async (req, res) => {
  res.json({ presets: Team.PRESETS, areas: P.AREAS, levels: P.LEVELS });
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
  // The work itself lives in services/clay/team.js, so this screen and Penny do the same thing.
  const r = await Team.addPerson(req.user, req.body);
  if (!r.ok) throw new ApiError(r.kind === 'not_found' ? 404 : r.kind === 'refused' ? 403 : 400, r.says);
  const { person, permissions: granted, has_login, invited, raised } = r;

  res.status(201).json({
    person,
    permissions: granted,
    has_login,
    // Said plainly rather than left for them to discover when the person cannot sign in.
    invited,
    seat_note: has_login
      ? (invited === 'told' ? 'They already have an account, and I have emailed them to say this '
        + 'business is now on it.' : null)
      : (person.email
        ? (invited === 'told'
          ? 'No account exists for that email yet, so I have emailed them to make their own. It '
            + 'links to this seat when they register.'
          : 'No account exists for that email yet, and I could not email them, so nobody has been '
            + 'told. Send them to the sign-up page yourself.')
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
