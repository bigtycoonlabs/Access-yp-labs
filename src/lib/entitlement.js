// Who may EXPORT / DOWNLOAD / KEEP a concept. Building with Clay is always free;
// this gate applies only when a user wants to pull assets out (download, share,
// export) or keep a concept past its window.
const { query } = require('../config/db');
const { PLANS, FREE_PROJECTS } = require('./money');

const STAFF_ROLES = ['staff', 'admin', 'master_staff'];
const isStaff = (role) => STAFF_ROLES.includes(role);

// The three pieces a person can always see and keep refining for free, even before
// paying: the business plan, the marketing strategy, and the live HTML demo. Everything
// else is still generated and updated, but stays locked until the concept is kept.
const PREVIEW_TYPES = ['business_plan', 'marketing_strategy', 'html_demo', 'built_site'];
const isPreviewType = (type) => PREVIEW_TYPES.includes(type);

// Strip the BODY of any non-preview asset when the caller isn't entitled, so locked content
// never leaves the server through a list endpoint. Keeps id/type/title/version so the UI can
// still list the piece and route the click through the gated single-asset endpoint. This is
// the backstop that makes the preview-gate real: without it, any list response leaks bodies.
function redactLockedAssets(assets, entitled) {
  if (entitled) return assets || [];
  return (assets || []).map((a) => (isPreviewType(a.type) ? a : { ...a, body: '', locked: true }));
}

// Staff normally never pay. billing_test lets a staff account (e.g. the founder)
// deliberately go through the real subscribe/paywall/pay flow to test it end to end,
// while keeping its role and staff powers for everything else.
const billingExempt = (user) => isStaff(user && user.role) && !(user && user.billing_test);

// Active plan covering a concept? Returns { entitled, reason, http }.
async function conceptEntitlement(user, conceptId) {
  if (billingExempt(user)) return { entitled: true, reason: 'staff' };

  const c = (await query(
    'SELECT id, owner_id, origin, access_expires_at, free_forever FROM concepts WHERE id=$1', [conceptId])).rows[0];
  if (!c) return { entitled: false, reason: 'not_found', http: 404 };
  if (c.owner_id !== user.id) return { entitled: false, reason: 'not_owner', http: 403 };

  // A project someone ALREADY PAID FOR stays theirs, free, permanently. We retired the per-project
  // charge and stopped billing them; the project they bought must not re-lock behind the new plan.
  // They bought it under one deal, and changing our packaging is not their problem. Checked before
  // anything else, and it keeps holding after the old subscription is cancelled — which is the
  // whole case it exists for.
  if (c.free_forever) return { entitled: true, reason: 'already_paid_for' };

  // THE FIRST PROJECT IS FREE, FOREVER, IN FULL. Not a trial and not a teaser: someone can shape a
  // real business here, own it, add to it, list it and sell it without paying us anything. An empty
  // marketplace is worth nothing, so the first job is letting people fill it. "First" means the
  // earliest project they created, so it can never be gamed by deleting and remaking, and it never
  // expires — this check runs before any date logic.
  const first = await query(
    `SELECT id FROM concepts WHERE owner_id=$1 ORDER BY created_at ASC, id ASC LIMIT $2`,
    [user.id, FREE_PROJECTS]);
  if (first.rows.some((r) => r.id === conceptId)) {
    return { entitled: true, reason: 'free_project' };
  }

  // Any active plan — the current one, or a legacy plan an existing subscriber still pays for.
  // People who signed up under the old packaging keep exactly what they were promised.
  const anyPlan = await query(
    `SELECT plan FROM subscriptions
      WHERE user_id=$1 AND status='active' AND plan IN ('builder','sculptor')
        AND (current_period_end IS NULL OR current_period_end > now()) LIMIT 1`, [user.id]);
  if (anyPlan.rows.length) return { entitled: true, reason: anyPlan.rows[0].plan };

  const sculptor = { rows: [] };
  if (sculptor.rows.length) return { entitled: true, reason: 'sculptor' };

  const maker = await query(
    `SELECT 1 FROM subscriptions WHERE user_id=$1 AND plan='maker' AND status='active' AND concept_id=$2
       AND (current_period_end IS NULL OR current_period_end > now()) LIMIT 1`,
    [user.id, conceptId]);
  if (maker.rows.length) return { entitled: true, reason: 'maker' };

  // Purchased concepts include the first month.
  if (c.origin === 'purchased' && c.access_expires_at && new Date(c.access_expires_at) > new Date()) {
    return { entitled: true, reason: 'first_month_included' };
  }
  return { entitled: false, reason: 'subscription_required', http: 402 };
}

// Standard paywall payload the UI renders into the single plan button.
function paywall(conceptId) {
  return {
    error: 'subscription_required',
    message: 'To download, share, or keep these materials, choose a plan. You can keep building for free.',
    options: [
      { plan: 'builder', label: PLANS.builder.label },
    ],
  };
}

module.exports = { isStaff, billingExempt, STAFF_ROLES, conceptEntitlement, paywall, PREVIEW_TYPES, isPreviewType, redactLockedAssets };
