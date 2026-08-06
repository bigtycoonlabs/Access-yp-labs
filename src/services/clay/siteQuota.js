// Sculptor website allowance: 10 newly-published sites per calendar month. An active 'site_addon'
// subscription lifts the cap. Non-Sculptor creators are already bounded by their entitlement, so
// the cap only applies to Sculptor (the unlimited-concepts plan). A site counts once, by the month
// it was first published (launch_page.published_at), so re-publishing an existing site is free.
// db is loaded lazily so importing this module (e.g. to use the pure countedThisMonth helper)
// doesn't open a connection pool.
function query(...args) { return require('../../config/db').query(...args); }

const SCULPTOR_SITE_LIMIT = 10;

async function activePlans(userId) {
  const s = await query("SELECT plan FROM subscriptions WHERE user_id=$1 AND status='active'", [userId]);
  const plans = s.rows.map((r) => r.plan);
  // The website builder and landing pages are part of the plan now, not a separate purchase.
  // They are among the most valuable things Clay makes, and putting them behind a second decision
  // cost more in hesitation than the add-on ever earned.
  return { sculptor: plans.includes('builder') || plans.includes('sculptor'), addon: plans.includes('site_addon') };
}

async function publishedThisMonth(userId) {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM concepts
       WHERE owner_id=$1
         AND (launch_page->>'published_at') IS NOT NULL
         AND date_trunc('month', (launch_page->>'published_at')::timestamptz) = date_trunc('month', NOW())`,
    [userId]);
  return r.rows[0].n;
}

// Call BEFORE first-publishing a site that has not been counted this month.
// Returns { allowed, limit, used, addon } — allowed=false means the cap is reached.
async function canPublishNewSite(userId) {
  const { sculptor, addon } = await activePlans(userId);
  if (!sculptor || addon) return { allowed: true, limit: SCULPTOR_SITE_LIMIT, addon };
  const used = await publishedThisMonth(userId);
  return { allowed: used < SCULPTOR_SITE_LIMIT, limit: SCULPTOR_SITE_LIMIT, used, addon: false };
}

// Is this launch_page already counted for the current month?
function countedThisMonth(launchPage) {
  const at = launchPage && launchPage.published_at;
  if (!at) return false;
  const d = new Date(at); if (isNaN(d)) return false;
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}

module.exports = { SCULPTOR_SITE_LIMIT, activePlans, publishedThisMonth, canPublishNewSite, countedThisMonth };
