// WHO MAY PUT A SITE IN FRONT OF THE PUBLIC.
//
// Anyone can BUILD a site and a landing page, and anyone can look at their own while signed in.
// What the plan buys is the moment it stops being private: a live address other people can reach,
// the ability to take payments through it, and the file itself to take away.
//
// The reasoning, so it does not get softened later: a site that strangers can visit is us hosting
// and serving something on our infrastructure under our name, and a site that takes payments is us
// standing behind a transaction. Those are the parts with real cost and real risk attached.
// Building and previewing cost us almost nothing and are where someone decides whether this is any
// good — so those stay open, and they stay open with nothing held back.
//
// One rule, in one place, called by everything that could expose a site. Publishing, public serving,
// checkout and export must never disagree about this; if they did, a site could be unpublished and
// still reachable, or unreachable and still taking money.

const { query } = require('../../config/db');

const STAFF = ['staff', 'admin', 'master_staff'];

// Does this person currently hold a plan that allows a site to go public?
// Legacy Sculptor and the old site add-on both still count — people who paid for this keep it.
async function hasLivePlan(userId) {
  const r = await query(
    `SELECT 1 FROM subscriptions
      WHERE user_id = $1 AND status = 'active'
        AND plan IN ('builder', 'sculptor', 'site_addon')
        AND (current_period_end IS NULL OR current_period_end > now())
      LIMIT 1`, [userId]);
  return r.rows.length > 0;
}

// The full answer for a concept's owner, with a reason a person can act on.
async function siteAccess(user, ownerId) {
  if (user && STAFF.includes(user.role)) return { allowed: true, reason: 'staff' };
  if (!ownerId) return { allowed: false, reason: 'unknown_owner' };
  if (await hasLivePlan(ownerId)) return { allowed: true, reason: 'plan' };
  return {
    allowed: false,
    reason: 'plan_required',
    message: 'Building and previewing your site is free and always will be. Making it live for other '
      + 'people to visit, taking payments through it, and downloading the site files are part of the '
      + '$19 plan. Nothing you have built is lost — it stays exactly as it is until you are ready.',
  };
}

// Is this concept's site allowed to be served to the PUBLIC right now? Used by the host-based
// serving path, so that if a subscription lapses the site quietly stops being reachable rather
// than continuing to be hosted for free forever.
async function publiclyVisible(conceptId) {
  const r = await query(
    `SELECT c.owner_id, c.launch_page, u.role
       FROM concepts c JOIN users u ON u.id = c.owner_id
      WHERE c.id = $1`, [conceptId]);
  const row = r.rows[0];
  if (!row) return false;
  const page = row.launch_page || {};
  if (String(page.enabled) !== 'true') return false;
  if (STAFF.includes(row.role)) return true;
  return hasLivePlan(row.owner_id);
}

module.exports = { hasLivePlan, siteAccess, publiclyVisible };
