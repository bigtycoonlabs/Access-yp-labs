// A concept's honest value as a listing rises with how launch-ready it is. A bare idea is worth the
// least; an idea packaged with a plan and a marketing strategy is worth more; and a concept a buyer
// could actually LAUNCH — a working build artifact, backed by real proof of demand — is worth the
// most. This is a COMPLETENESS-based starting guide, never a market appraisal or a promise: it
// reasons only from what the concept carries, and every caller says so. The creator sets the price;
// the marketplace decides.

const FLOOR_CENTS = 1000; // the platform's $10 listing minimum.

// A build path is any route to building it; a "launchable" artifact is a working thing a buyer
// could actually run or ship — that's the jump that earns the top prices.
// 'tech_spec' is the CURRENT build-path asset — generation was consolidated to produce one complete
// spec instead of the older website_prompt / build_instructions pair. Leaving it out of this list
// meant every project built since that change was valued as a bare idea with no route to building
// it, which is both wrong and expensive: it is the difference between the lowest tier and the
// highest. The older names stay so nothing built before the change loses value.
const BUILD_PATH_TYPES = ['tech_spec', 'html_demo', 'website_prompt', 'build_instructions', 'code_file', 'built_site'];
const LAUNCHABLE_TYPES = ['built_site', 'code_file', 'html_demo'];

// The tier sets where a range STARTS. It does not cap it.
//
// The top tier used to end at $800 flat, which said that a project with four materials and one with
// twenty were worth the same the moment both cleared the same bar. That is plainly untrue, and it is
// the opposite of what this platform is trying to encourage: if adding the eighth piece cannot move
// the number, nobody adds it.
//
// So the ceiling grows with what has actually been built, and the top tier has no fixed ceiling at
// all — someone who keeps adding keeps seeing it move.
const TIERS = {
  bare_concept: { label: 'A shaped idea', low: 1000, high: 4000 },
  shaped:       { label: 'A shaped idea with a head start', low: 2500, high: 9000 },
  full_package: { label: 'A full package to build from', low: 7500, high: 25000 },
  // No `high`. The ceiling for a launch-ready project is worked out from its depth below, because
  // this is the tier where the difference between projects is largest.
  launch_ready: { label: 'Ready for someone to launch', low: 20000, high: null },
};

// How much each additional piece of substance moves the ceiling.
//
// Counted as DISTINCT KINDS of material, not files. Ten versions of a business plan is one plan; a
// plan plus research plus a risk read plus a spec plus a demo is five different things a buyer is
// getting, and that is what actually makes a package worth more.
const DEPTH_STEP = 0.18;          // each distinct kind beyond the baseline adds 18% to the ceiling
const BASELINE_KINDS = 3;         // roughly what a first build produces
const LAUNCH_READY_STEP = 0.30;   // depth counts for more once it is genuinely launchable

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

  // DEPTH: how many distinct kinds of material this project carries beyond a first build. This is
  // what makes the ladder a ladder — every genuine addition moves the top of the range, so somebody
  // can see that adding the next piece is worth doing before they do it.
  const kinds = types.size;
  const extra = Math.max(0, kinds - BASELINE_KINDS);
  const step = tier === 'launch_ready' ? LAUNCH_READY_STEP : DEPTH_STEP;

  // A launch-ready project has no fixed ceiling. Its base is the tier floor times four — the same
  // 4x spread the other tiers have — and then it grows with depth, with nothing capping it.
  const base = t.high == null ? t.low * 4 : t.high;
  let high = Math.round(base * (1 + extra * step));

  // Real proof of demand justifies the top of the range — and a bit above it.
  if (has.proof) high = Math.round(high * 1.35);
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

  return {
    tier, tierLabel: t.label, has,
    range: { low_cents: low, high_cents: high },
    drivers, toRaise,
    // Surfaced so a creator can see WHY the ceiling is where it is, and that it moves.
    depth: { kinds, beyond_baseline: extra, uncapped: t.high == null },
  };
}

module.exports = { assessValue, TIERS, FLOOR_CENTS, BUILD_PATH_TYPES, LAUNCHABLE_TYPES };
