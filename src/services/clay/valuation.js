// A concept's honest value as a listing rises with how launch-ready it is. A bare idea is worth the
// least; an idea packaged with a plan and a marketing strategy is worth more; and a concept a buyer
// could actually LAUNCH — a working build artifact, backed by real proof of demand — is worth the
// most. This is a COMPLETENESS-based starting guide, never a market appraisal or a promise: it
// reasons only from what the concept carries, and every caller says so. The creator sets the price;
// the marketplace decides.

const FLOOR_CENTS = 1000; // the platform's $10 listing minimum.

// A build path is any route to building it; a "launchable" artifact is a working thing a buyer
// could actually run or ship — that's the jump that earns the top prices.
const BUILD_PATH_TYPES = ['html_demo', 'website_prompt', 'build_instructions', 'code_file', 'built_site'];
const LAUNCHABLE_TYPES = ['built_site', 'code_file', 'html_demo'];

const TIERS = {
  bare_concept: { label: 'A shaped idea', low: 1000, high: 4000 },
  shaped:       { label: 'A shaped idea with a head start', low: 2500, high: 9000 },
  full_package: { label: 'A full package to build from', low: 7500, high: 25000 },
  launch_ready: { label: 'Ready for someone to launch', low: 20000, high: 80000 },
};

function assessValue({ concept = {}, assets = [], waiting = 0 } = {}) {
  const fresh = (Array.isArray(assets) ? assets : []).filter((a) => a.is_current && !a.exclusive_locked);
  const types = new Set(fresh.map((a) => a.type));
  const has = {
    plan: types.has('business_plan'),
    marketing: types.has('marketing_strategy'),
    buildPath: BUILD_PATH_TYPES.some((t) => types.has(t)),
    launchable: LAUNCHABLE_TYPES.some((t) => types.has(t)),
    proof: !!(concept.research_grounded || concept.claims_verified || waiting > 0
      || concept.movement_state === 'ready_to_package'),
  };

  let tier;
  if (has.launchable && has.plan && has.marketing) tier = 'launch_ready';
  else if (has.plan && has.marketing && has.buildPath) tier = 'full_package';
  else if (has.plan || has.marketing || has.buildPath) tier = 'shaped';
  else tier = 'bare_concept';

  const t = TIERS[tier];
  let low = Math.max(t.low, FLOOR_CENTS);
  // Real proof of demand justifies the top of the range — and a bit above it.
  let high = has.proof ? Math.round(t.high * 1.35) : t.high;
  if (high < low) high = low;

  const drivers = [];
  if (has.plan) drivers.push('a business plan');
  if (has.marketing) drivers.push('a marketing strategy');
  if (has.launchable) drivers.push('a working build a buyer could actually launch');
  else if (has.buildPath) drivers.push('a build path to follow');
  if (has.proof) drivers.push('real proof of demand behind it');
  if (!drivers.length) drivers.push('the shaped idea itself');

  const toRaise = [];
  if (!has.plan) toRaise.push('add a business plan');
  if (!has.marketing) toRaise.push('add a marketing strategy');
  if (!has.launchable) {
    toRaise.push(has.buildPath
      ? 'turn the build path into a working demo or site a buyer could launch'
      : 'add a build path, then a working demo or site');
  }
  if (!has.proof) toRaise.push('get one real proof of demand — a booked paid call, a preorder, a landing page that converts');

  return { tier, tierLabel: t.label, has, range: { low_cents: low, high_cents: high }, drivers, toRaise };
}

module.exports = { assessValue, TIERS, FLOOR_CENTS, BUILD_PATH_TYPES, LAUNCHABLE_TYPES };
