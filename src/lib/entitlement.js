// Who may EXPORT / DOWNLOAD / KEEP a concept. Building with Clay is always free;
// this gate applies only when a user wants to pull assets out (download, share,
// export) or keep a concept past its window.
const { query } = require('../config/db');

const STAFF_ROLES = ['staff', 'admin', 'master_staff'];
const isStaff = (role) => STAFF_ROLES.includes(role);

// Active plan covering a concept? Returns { entitled, reason, http }.
async function conceptEntitlement(user, conceptId) {
  if (isStaff(user.role)) return { entitled: true, reason: 'staff' };

  const c = (await query(
    'SELECT id, owner_id, origin, access_expires_at FROM concepts WHERE id=$1', [conceptId])).rows[0];
  if (!c) return { entitled: false, reason: 'not_found', http: 404 };
  if (c.owner_id !== user.id) return { entitled: false, reason: 'not_owner', http: 403 };

  const sculptor = await query(
    `SELECT 1 FROM subscriptions WHERE user_id=$1 AND plan='sculptor' AND status='active' LIMIT 1`, [user.id]);
  if (sculptor.rows.length) return { entitled: true, reason: 'sculptor' };

  const maker = await query(
    `SELECT 1 FROM subscriptions WHERE user_id=$1 AND plan='maker' AND status='active' AND concept_id=$2 LIMIT 1`,
    [user.id, conceptId]);
  if (maker.rows.length) return { entitled: true, reason: 'maker' };

  // Purchased concepts include the first month.
  if (c.origin === 'purchased' && c.access_expires_at && new Date(c.access_expires_at) > new Date()) {
    return { entitled: true, reason: 'first_month_included' };
  }
  return { entitled: false, reason: 'subscription_required', http: 402 };
}

// Standard paywall payload Clay/the UI can render into Maker/Sculptor buttons.
function paywall(conceptId) {
  const { PLANS } = require('./money');
  return {
    error: 'subscription_required',
    message: 'To download, share, or keep these materials, choose a plan. You can keep building for free.',
    options: [
      { plan: 'maker', label: PLANS.maker.label, concept_id: conceptId },
      { plan: 'sculptor', label: PLANS.sculptor.label },
    ],
  };
}

module.exports = { isStaff, STAFF_ROLES, conceptEntitlement, paywall };
