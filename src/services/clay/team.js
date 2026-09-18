// ADDING SOMEBODY TO A BUSINESS.
//
// One implementation, used by the team screen and by Penny. It was only in the route handler, so
// when she was asked to add a teammate she had to send the person to another tab — the thing this
// product is meant to stop. Two implementations would be two behaviours, and whoever asked would get
// whichever one they happened to reach.
const { query } = require('../../config/db');
const P = require('../../lib/permissions');
const { sendEmail } = require('../email');

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

async function addPerson(actor, b) {
  const gate = await P.can(actor.id, b.business_id, 'team', 'manage');
  if (!gate.ok) {
    return { ok: false, kind: gate.reason === 'no_access' ? 'not_found' : 'refused',
      says: P.refusalLine(gate, 'team', gate.perms && gate.perms.business.name) };
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
      return { ok: false, kind: 'refused', says: 'They are already on this business. One person holds one relationship '
        + 'to a business — change what they can see rather than adding them twice.' };
    }
  }

  const rel = await query(
    `INSERT INTO relationships (business_id, user_id, display_name, email, phone, kind, started_on, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.business_id, userId, b.display_name.trim(), b.email || null, b.phone || null,
      b.kind, b.started_on || null, b.notes || null]);

  // Permissions, from a preset or explicitly. A relationship with no permissions sees nothing, which
  // is the right default — absence is never permission.
  // A PRESET NOBODY HAS IS NOT AN EMPTY PRESET. Asked live for an "assistant" preset, which does not
  // exist, this granted nothing and said nothing: the person was added, emailed, and could see
  // nothing at all, with the owner believing they had given them a role (17 Sept 2026).
  if (b.preset && !PRESETS[b.preset]) {
    throw new ApiError(400, 'There is no "' + String(b.preset).slice(0, 40) + '" preset, so nobody was '
      + 'added. The presets are: ' + Object.keys(PRESETS).join(', ') + '. Or name the areas yourself.');
  }
  const wanted = b.permissions && typeof b.permissions === 'object'
    ? b.permissions
    : (PRESETS[b.preset] || {});
  if (!Object.keys(wanted).length) {
    throw new ApiError(400, 'That would add them with nothing they can see or do. Give a preset ('
      + Object.keys(PRESETS).join(', ') + ') or say which areas they get.');
  }
  const granted = {};
  for (const [area, level] of Object.entries(wanted)) {
    if (!P.AREAS.includes(area) || !P.LEVELS.includes(level) || level === 'none') continue;
    await query(
      `INSERT INTO permissions (relationship_id, area, level, granted_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT (relationship_id, area)
       DO UPDATE SET level=EXCLUDED.level, granted_by=EXCLUDED.granted_by, granted_at=now()`,
      [rel.rows[0].id, area, level, actor.id]);
    granted[area] = level;
  }

  // THEY ARE TOLD, AND THEY MAKE THEIR OWN ACCOUNT.
  //
  // Adding somebody used to be silent: a row appeared and the person never heard about it. Nobody is
  // signed up by somebody else either, so the email invites them to create their own account, which
  // is then linked to this relationship by their email address when they register.
  let invited = null;
  if (b.email) {
    try {
      const { teamInviteEmail } = require('../services/pennyEmails');
      const biz = (await query('SELECT name FROM businesses WHERE id=$1', [b.business_id])).rows[0];
      const msg = teamInviteEmail({
        name: b.display_name, ownerName: actor.name, businessName: biz && biz.name,
        areas: Object.entries(granted).map(([area, level]) => area + ': ' + level),
        hasAccount: !!userId, site: process.env.CLIENT_URL,
      });
      const sent = await sendEmail({ to: b.email, subject: msg.subject, html: msg.html, text: msg.text });
      invited = sent && sent.sent ? 'told' : 'not_told';
    } catch (_) { invited = 'not_told'; }
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


  return { ok: true, person: rel.rows[0], permissions: granted, has_login: !!userId, invited, raised };
}

// WHO IS ON IT. The same rows the business screen shows, behind the same permission check.
async function listPeople(actor, business_id) {
  const gate = await P.can(actor.id, business_id, 'team', 'view');
  if (!gate.ok) {
    return { ok: false, kind: gate.reason === 'no_access' ? 'not_found' : 'refused',
      says: P.refusalLine(gate, 'team', gate.perms && gate.perms.business.name) };
  }
  const r = await query(
    `SELECT r.id, r.display_name, r.email, r.kind, r.ended_on,
            (r.user_id IS NOT NULL) AS has_login,
            COALESCE(json_object_agg(p.area, p.level) FILTER (WHERE p.area IS NOT NULL), '{}'::json) AS areas
       FROM relationships r
       LEFT JOIN permissions p ON p.relationship_id = r.id
      WHERE r.business_id = $1 AND r.ended_on IS NULL
      GROUP BY r.id ORDER BY r.created_at ASC`, [business_id]);
  return { ok: true, people: r.rows };
}

module.exports = { addPerson, listPeople, PRESETS };
