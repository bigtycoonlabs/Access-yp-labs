// STAFF, GATED BY ROLE — the same "one Clay, powers depend on where it's speaking" pattern the
// public profile uses, now for the team. Regular builders never see these tools at all. Staff get
// review, marketplace review, basic moderation, and health checks. Admins add heavier moderation.
// Owners (master_staff — Vission and Rel) add running the place: onboarding staff. Pure + testable.

// The Kennedy set: health, activity, reviewing concepts/listings, and clearing reports.
const STAFF_TOOLS = ['check_systems', 'platform_pulse', 'review_queue', 'decide_listing', 'report_queue', 'resolve_report'];
// Heavier moderation — pausing/reinstating accounts. Admins and owners.
const ADMIN_TOOLS = ['suspend_user', 'reinstate_user'];
// Running the platform — onboarding and setting up staff. Owners only.
const MASTER_TOOLS = ['manage_staff'];
const ALL_STAFF_TOOLS = STAFF_TOOLS.concat(ADMIN_TOOLS, MASTER_TOOLS);

function tierFor(role) {
  if (role === 'master_staff') return 'master';
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff';
  return 'none';
}
function staffToolsFor(role) {
  const t = tierFor(role);
  if (t === 'master') return STAFF_TOOLS.concat(ADMIN_TOOLS, MASTER_TOOLS);
  if (t === 'admin') return STAFF_TOOLS.concat(ADMIN_TOOLS);
  if (t === 'staff') return STAFF_TOOLS.slice();
  return [];
}
function allows(role, tool) { return staffToolsFor(role).includes(tool); }

module.exports = { STAFF_TOOLS, ADMIN_TOOLS, MASTER_TOOLS, ALL_STAFF_TOOLS, tierFor, staffToolsFor, allows };
