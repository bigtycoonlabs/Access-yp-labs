// PERMISSIONS — enforced at the query layer, because an assistant has no screens.
//
// In a normal application you can audit permissions by walking the screens: this page shows the
// financials, so it checks Money. An assistant has no fixed set of screens. It has a model that can
// be asked anything, and the only place a check can actually hold is between the question and the
// data.
//
// A SCREEN THAT HIDES A NUMBER IS NOT A PERMISSION IF PENNY WILL SAY IT OUT LOUD.
//
// Three rules this file exists to keep:
//
//   FAIL CLOSED. If the permission cannot be read, the answer is no. Never "probably fine".
//
//   BE LEGIBLE. Somebody who cannot see something is told that it EXISTS and is restricted, and who
//   can grant it. Telling them it does not exist is a lie, and it makes people distrust everything
//   else the assistant says.
//
//   EXPORT IS NEVER IMPLIED. It is the one capability that removes data from the building, and no
//   amount of 'view' or even 'manage' elsewhere grants it.

const { query } = require('../config/db');

const AREAS = ['compliance', 'money', 'customers', 'team', 'documents', 'projects', 'sites', 'export'];
const LEVELS = ['none', 'view', 'act', 'manage'];

// Ordered, so "at least view" is a comparison rather than a list of cases.
const rank = (level) => Math.max(0, LEVELS.indexOf(level));

// What the person can do on this business. Returns a map of area -> level, plus the relationship.
//
// The owner is not a row in permissions. They own it, so they have manage everywhere — but that is
// decided HERE rather than by seeding eight permission rows at creation time, so an owner can never
// end up locked out of their own business by a bad migration.
async function forBusiness(userId, businessId) {
  if (!userId || !businessId) return null;

  let biz;
  try {
    biz = await query('SELECT id, owner_id, name FROM businesses WHERE id=$1 AND archived_at IS NULL',
      [businessId]);
  } catch (e) {
    // Could not read. That is not permission to proceed.
    console.error('permissions: could not read business', e && e.message);
    return null;
  }
  if (!biz.rows.length) return null;

  if (biz.rows[0].owner_id === userId) {
    const all = {};
    AREAS.forEach((a) => { all[a] = 'manage'; });
    return { business: biz.rows[0], relationship: { kind: 'owner' }, areas: all, isOwner: true };
  }

  let rel;
  try {
    rel = await query(
      `SELECT r.id, r.kind, r.display_name,
              COALESCE(json_object_agg(p.area, p.level) FILTER (WHERE p.area IS NOT NULL), '{}'::json) AS areas
         FROM relationships r
         LEFT JOIN permissions p ON p.relationship_id = r.id
        WHERE r.business_id=$1 AND r.user_id=$2 AND r.ended_on IS NULL
        GROUP BY r.id, r.kind, r.display_name`,
      [businessId, userId]);
  } catch (e) {
    console.error('permissions: could not read relationship', e && e.message);
    return null;
  }
  if (!rel.rows.length) return null;

  // Anything not granted is 'none'. Absence is never permission.
  const areas = {};
  AREAS.forEach((a) => { areas[a] = (rel.rows[0].areas || {})[a] || 'none'; });
  return { business: biz.rows[0], relationship: rel.rows[0], areas, isOwner: false };
}

// Does this person have at least `level` on `area` for this business?
async function can(userId, businessId, area, level = 'view') {
  const p = await forBusiness(userId, businessId);
  if (!p) return { ok: false, reason: 'no_access', areas: null };
  const held = p.areas[area] || 'none';
  if (rank(held) >= rank(level)) return { ok: true, perms: p, held };
  return { ok: false, reason: 'insufficient', perms: p, held, needed: level };
}

// THE SENTENCE PENNY SAYS WHEN THE ANSWER IS NO.
//
// It names what exists, says it is restricted rather than absent, and says who can change that.
// Pretending the thing does not exist would be the easier implementation and it is a lie.
function refusalLine(result, area, businessName, ownerName) {
  const who = ownerName ? ownerName + ' can' : 'The owner can';
  if (result.reason === 'no_access') {
    return 'You do not have access to that business. ' + who
      + ' add you if you should.';
  }
  const plain = {
    compliance: 'the filings and licences', money: 'the financials',
    customers: 'the customers', team: 'the team', documents: 'the documents',
    projects: 'the projects and builds', sites: 'the website', export: 'exporting data',
  }[area] || area;
  return 'That is outside what you can see on ' + (businessName || 'this business')
    + ' — you do not have access to ' + plain + '. ' + who + ' give you access.';
}

// Every business this person can reach, for the cross-business ranked list. An owner sees theirs;
// everybody else sees the ones they hold a live relationship to.
async function myBusinesses(userId) {
  const r = await query(
    `SELECT b.id, b.name, b.legal_name, b.entity_type, b.formation_state,
            b.operating_states, b.trade, b.stage,
            (b.owner_id = $1) AS is_owner
       FROM businesses b
      WHERE b.archived_at IS NULL
        AND (b.owner_id = $1
             OR EXISTS (SELECT 1 FROM relationships r
                         WHERE r.business_id = b.id AND r.user_id = $1 AND r.ended_on IS NULL))
      ORDER BY (b.owner_id = $1) DESC, b.created_at ASC`,
    [userId]);
  return r.rows;
}

// Export leaves a record behind, always. Called after the rows are produced, never before — a
// logged export that failed is a worse record than no log.
async function logExport(businessId, userId, what, rowCount) {
  return query(
    'INSERT INTO export_log (business_id, user_id, what, row_count) VALUES ($1,$2,$3,$4)',
    [businessId, userId, what, rowCount == null ? null : rowCount],
  ).catch((e) => console.error('export_log write failed', e && e.message));
}

module.exports = { AREAS, LEVELS, forBusiness, can, refusalLine, myBusinesses, logExport, rank };
