// Money is handled in integer cents everywhere. One source of truth for the
// platform economics so no route can drift: 20% platform take, $10 floor.
const PLATFORM_RATE = 0.20;      // 20% on marketplace sales
const PRICE_FLOOR_CENTS = 1000;  // $10 minimum listing price

// THE MINIMUM BID IS THE MINIMUM LISTING PRICE. ONE FLOOR, $10, EVERYWHERE.
//
// It was not always. `bids.amount_cents` carried CHECK (amount_cents >= 5000) from migration 004 —
// a $50 floor from when the minimum listing price was also $50. The listing floor was lowered to
// $10 and this was not, so the route validated against $10, told people "Bid must be at least $10",
// and Postgres rejected anything under $50 with a raw constraint name inside an HTTP 500. On the one
// live auction, whose starting bid is $35, the page pre-filled a $36 bid that could not be placed.
//
// Owner's decision, 11 August 2026: one floor of $10 for projects and auctions alike. Migration 056
// moved the constraint. MIN_BID_CENTS is kept as its own name rather than collapsed into
// PRICE_FLOOR_CENTS so the bid route still says which rule it is obeying — but they are now the same
// number, and the schema-agreement guard asserts both against the live constraints so they cannot
// drift apart again the way they did for months without anything noticing.
const MIN_BID_CENTS = PRICE_FLOOR_CENTS;   // $10 — matches bids_amount_cents_check (migration 056)

// Consultant session economics lived here: $150 total, split $30 / $120. Retired with the product.
// Nothing prices a consultant session any more, and keeping a price for something we do not sell is
// how a retired thing gets sold again by accident — the same reason planCents refuses to price the
// retired subscription plans.

// THE PLANS, decided by the owner on 16 September 2026.
//
// Free, Desk at $55 a month and Office at $99 a month, each with a monthly allowance. The prices
// were set from measured costs (the pricing document of that date): a Penny message is about three
// cents, a page build eighteen, a compliance search eighty-five, and $19 with no limits lost money
// on anyone who used Penny daily. Allowances are listed here so every screen and Penny read the
// same numbers; they are not enforced yet, and nothing may say they are.
//
// Yearly is ten months' price for twelve. Prices live only here.
const DESK_CENTS = 5500;
const OFFICE_CENTS = 9900;
const YEARLY_MONTHS_CHARGED = 10;
const FREE_PROJECTS = 1;          // the first project is free forever, in full
const CONCEPT_ACCESS_DAYS = 30;   // legacy window, only applies to projects beyond the free one

const PLANS = {
  desk: { cents: DESK_CENTS, mode: 'subscription', per_concept: false, name: 'Desk',
    label: 'Desk \u2014 $55 a month',
    for: 'Most owners',
    allowance: { penny_messages: 400, builds: 20, images: 60, compliance_reviews: 1, compliance_questions: 5, businesses_reviewed: 1 },
    includes: 'Penny, a monthly compliance review, unlimited sites hosted on Labs, a customer portal, files and Keys' },
  office: { cents: OFFICE_CENTS, mode: 'subscription', per_concept: false, name: 'Office',
    label: 'Office \u2014 $99 a month',
    for: 'Custom apps, several businesses, small teams',
    allowance: { penny_messages: 1000, builds: 60, images: 150, compliance_reviews: 3, compliance_questions: 15, businesses_reviewed: 3, team_seats: 5 },
    includes: 'Everything in Desk, compliance reviews for up to three businesses, custom app launches and up to five team seats' },
};

const FREE_ALLOWANCE = { penny_messages: 100, builds: 3, images: 5, compliance_reviews: 0, compliance_questions: 1, labs_sites: 1 };

// BUNDLES WITH YP FLOW, approved by the owner on 16 September 2026: 17% off the two bought apart.
// One Stripe subscription on the shared account; both platforms' webhooks receive it. Labs records
// the Labs plan; Flow grants flow_tier to the same email and sends its welcome. Flow prices are its
// own (lib/execution/tiers.ts in yp-flow): Flow $15, Power $39, Master $69.
const FLOW_TIER_CENTS = { flow: 1500, power: 3900, master: 6900 };
const BUNDLES = {
  desk_flow:     { name: 'Desk + Flow',     labs: 'desk',   flow: 'flow',   cents: 5800 },
  desk_power:    { name: 'Desk + Power',    labs: 'desk',   flow: 'power',  cents: 7800 },
  office_master: { name: 'Office + Master', labs: 'office', flow: 'master', cents: 13900 },
};
function bundleSeparateCents(key) {
  const b = BUNDLES[key];
  return b ? PLANS[b.labs].cents + FLOW_TIER_CENTS[b.flow] : null;
}
function bundleYearlyCents(key) { return BUNDLES[key] ? BUNDLES[key].cents * YEARLY_MONTHS_CHARGED : null; }

// Every plan that counts as paid, current or retired. Checks for "is this person on a plan" read
// this list, so a new plan cannot be forgotten in one of them.
const PAID_PLANS = ['desk', 'office', 'builder', 'sculptor'];

function yearlyCents(plan) { return PLANS[plan] ? PLANS[plan].cents * YEARLY_MONTHS_CHARGED : null; }

// Older accounts may still hold 'builder' ($19, retired 16 Sept 2026), 'maker' or 'sculptor'. They
// keep working and keep their access: nothing a person is paying for is switched off because the
// packaging changed. New subscriptions can only be the plans above.
const LEGACY_PLANS = ['builder', 'maker', 'sculptor'];
const BUILDER_CENTS = 1900;       // retired price, kept only to record what a legacy subscriber pays

// What the retired plans cost, kept ONLY so an existing subscriber's Stripe events can still be
// recorded truthfully. Not sellable — planCents() below still refuses to price them for anything
// new — but a webhook for a live legacy subscription has to know what that person actually pays.
// Without this, their event inserted a null price into a NOT NULL column, the insert failed, the
// webhook returned 500, and Stripe retried it forever while the subscription never registered.
const LEGACY_PLAN_CENTS = { builder: BUILDER_CENTS, maker: 299, sculptor: 4999 };
function planCents(plan) { return PLANS[plan] ? PLANS[plan].cents : null; }

function platformFeeCents(amountCents) { return Math.round(amountCents * PLATFORM_RATE); }
function sellerNetCents(amountCents) { return amountCents - platformFeeCents(amountCents); }
function isAboveFloor(amountCents) { return Number.isInteger(amountCents) && amountCents >= PRICE_FLOOR_CENTS; }
// Separate from isAboveFloor on purpose. Conflating them is how the bid route came to promise the
// listing floor on a column that enforces a different one.
function isValidBid(amountCents) { return Number.isInteger(amountCents) && amountCents >= MIN_BID_CENTS; }

// Affiliate referral commission. A mover who drives a sale through their promo link
// earns 5% of the sale — paid OUT OF the platform's 20% take, never out of the seller's
// share. So on an attributed sale the seller still nets 80%, the mover gets 5%, and the
// platform keeps 15%. This keeps sellers strictly better off when movers promote them.
const MOVER_RATE = 0.05;
function moverCommissionCents(amountCents) { return Math.round(amountCents * MOVER_RATE); }
function platformNetAfterMoverCents(amountCents) {
  return platformFeeCents(amountCents) - moverCommissionCents(amountCents);
}

// The price to RECORD for a plan that already exists, including retired ones. Deliberately separate
// from planCents: one answers "what may we charge for this?" and the other "what does this person
// actually pay?". Conflating them is how a retired price gets sold again by accident.
function recordedPlanCents(plan, billing, bundle) {
  if (bundle && BUNDLES[bundle]) return billing === 'yearly' ? bundleYearlyCents(bundle) : BUNDLES[bundle].cents;
  if (billing === 'yearly' && PLANS[plan]) return yearlyCents(plan);
  const live = planCents(plan);
  if (live !== null && live !== undefined) return live;
  return LEGACY_PLAN_CENTS[plan] !== undefined ? LEGACY_PLAN_CENTS[plan] : 0;
}

module.exports = {
  PLATFORM_RATE, PRICE_FLOOR_CENTS, MIN_BID_CENTS, isValidBid,
  BUNDLES, FLOW_TIER_CENTS, bundleSeparateCents, bundleYearlyCents,
  BUILDER_CENTS, DESK_CENTS, OFFICE_CENTS, YEARLY_MONTHS_CHARGED, yearlyCents, FREE_ALLOWANCE, PAID_PLANS,
  FREE_PROJECTS, LEGACY_PLANS, LEGACY_PLAN_CENTS, recordedPlanCents, CONCEPT_ACCESS_DAYS, PLANS, planCents,
  platformFeeCents, sellerNetCents, isAboveFloor,
  MOVER_RATE, moverCommissionCents, platformNetAfterMoverCents,
};
