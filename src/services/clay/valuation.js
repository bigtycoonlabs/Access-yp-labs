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
// THE LADDER, PRICED AGAINST WHAT THIS MARKET ACTUALLY PAYS.
//
// These numbers used to top out at $250 for a full package and about $610 once depth was counted.
// That was priced for the marketplace as it is today — 12 live listings, $45 to $325, averaging
// $138 — rather than for what is being sold. A seller with a researched package and a working build
// could not ask for what comparable projects change hands for.
//
// Published 2026 comparables for pre-revenue projects, which is exactly this inventory:
//   an idea plus a domain                       $0 – $500
//   a working product with no users             $500 – $3,000
//   a product with a waitlist or early users    $2,000 – $10,000
//   strong assets behind it                     $5,000 – $25,000+
// with one marketplace in this niche averaging around $4,300 a deal, and a real $0-revenue SaaS
// selling at $4,500.
//
// The tiers below map onto those bands. The important structural point is which of our tiers
// corresponds to "a working product": launch_ready, and only launch_ready, because that tier
// requires a built_site, code_file or html_demo. Everything below it is paper, however good the
// paper is.
const TIERS = {
  bare_concept: { label: 'A shaped idea', low: 1000, high: 50000 },
  shaped:       { label: 'A shaped idea with a head start', low: 5000, high: 150000 },
  full_package: { label: 'A full package to build from', low: 25000, high: 300000 },
  // No `high`. The ceiling for a launch-ready project is worked out from its depth below, because
  // this is the tier where the difference between projects is largest — and where the market's own
  // range runs from $2,000 to $25,000 and beyond.
  launch_ready: { label: 'Ready for someone to launch', low: 100000, high: null },
};

// How much each additional piece of substance moves the ceiling.
//
// Counted as DISTINCT KINDS of material, not files. Ten versions of a business plan is one plan; a
// plan plus research plus a risk read plus a spec plus a demo is five different things a buyer is
// getting, and that is what actually makes a package worth more.
const DEPTH_STEP = 0.12;          // each distinct kind beyond the baseline adds 12% to the ceiling
const BASELINE_KINDS = 3;         // roughly what a first build produces
const LAUNCH_READY_STEP = 0.25;   // depth counts for more once it is genuinely launchable
// Real demand roughly DOUBLES what a project fetches in the published comparables: a working product
// with no users sits at $500–$3,000, and the same product with a waitlist or early users sits at
// $2,000–$10,000. The old 1.35 on the ceiling alone understated that, and left the floor untouched —
// which is wrong in a way that matters, because a project with people already waiting for it should
// not start where one nobody has heard of starts.
const PROOF_CEILING = 1.8;
const PROOF_FLOOR = 1.5;

function assessValue({ concept = {}, assets = [], waiting = 0 } = {}) {
  const fresh = (Array.isArray(assets) ? assets : []).filter((a) => a.is_current && !a.exclusive_locked);
  const types = new Set(fresh.map((a) => a.type));
  const has = {
    plan: types.has('business_plan'),
    marketing: types.has('marketing_strategy'),
    buildPath: BUILD_PATH_TYPES.some((t) => types.has(t)),
    launchable: LAUNCHABLE_TYPES.some((t) => types.has(t)),
    // PROOF IS BEHAVIOUR. SOMEBODY OUTSIDE THE BUILDING HAS TO HAVE DONE SOMETHING.
    //
    // research_grounded and claims_verified used to count here. Both mean Clay searched the web and
    // checked his claims against sources. That is desk research — good work, and not the same thing
    // as evidence that anyone wants this. Counting it as proof of demand raised the price ceiling by
    // 35% on the strength of Clay having done a web search, which is nothing the creator did and
    // nothing a stranger did.
    //
    // Found by walking a real build end to end. The growth project came back with
    // movement_state 'needs_customer_clarity' — Clay's own honest read that nobody had been
    // identified yet — while the value panel on the same project said "real proof of demand behind
    // it" and quoted a higher range for it. Two statements from the same platform contradicting each
    // other about the same project, with a price attached to the wrong one.
    //
    // It is also flatly against the doctrine Clay is given: proof is behaviour, not compliments, and
    // a project is never strong because it reads polished. A research-grounded package reads
    // polished. That is exactly the case the rule was written for.
    //
    // What counts now: somebody joined the waitlist, or Clay placed the project at ready_to_package,
    // which he is instructed to set only from real behaviour and never to flatter.
    proof: !!(waiting > 0 || concept.movement_state === 'ready_to_package'),
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

  // Real proof of demand lifts BOTH ends, because that is what the comparables do.
  if (has.proof) { high = Math.round(high * PROOF_CEILING); low = Math.round(low * PROOF_FLOOR); }

  // PAPER NEVER OUTPRICES A WORKING BUILD.
  //
  // Without this, a thoroughly researched package with a dozen kinds of material could be quoted
  // above a project that has an actual site somebody could launch on Monday — which is not how any
  // buyer of these thinks. They are asking what it will cost to run this without the person who
  // built it, and paper leaves more of that cost with them.
  //
  // So anything short of launch-ready is capped at the base of launch-ready. It can climb the whole
  // way there on depth and proof; it cannot pass a thing that exists.
  if (!has.launchable) high = Math.min(high, TIERS.launch_ready.low * 4);
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
