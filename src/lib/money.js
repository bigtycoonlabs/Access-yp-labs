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

// ONE PLAN, and a first project that is genuinely free.
//
// What this replaced and why: charging per project taxed the exact behaviour we want. Every new
// idea became a purchase decision, and people answer that by having fewer ideas — while capping us
// at a few dollars from someone who would happily pay for everything. Two tiers also forced a
// choice nobody had enough information to make. So: build your first project free, forever, with
// nothing held back; one plan covers everything after that, including the website builder and
// landing pages that used to sit behind a separate purchase.
//
// The price lives in ONE constant. Changing it is a one-line change on purpose — this number is a
// hypothesis to be tested, not a fact. (Rel's read is that it belongs nearer $25; we are starting
// at $19 to see what happens, which is exactly the kind of thing this constant exists for.)
const BUILDER_CENTS = 1900;       // $19.00 / month, unlimited projects, everything included
const FREE_PROJECTS = 1;          // the first project is free forever, in full
const CONCEPT_ACCESS_DAYS = 30;   // legacy window, only applies to projects beyond the free one

const PLANS = {
  builder: { cents: BUILDER_CENTS, mode: 'subscription', per_concept: false,
             label: 'Builder — $19/month, unlimited projects, sites and landing pages included' },
};

// Older accounts may still hold a 'maker' or 'sculptor' subscription. They keep working and keep
// their access — we do not switch off something a person is paying for because we changed our mind
// about packaging. New subscriptions can only be the single plan above.
const LEGACY_PLANS = ['maker', 'sculptor'];

// What the retired plans cost, kept ONLY so an existing subscriber's Stripe events can still be
// recorded truthfully. Not sellable — planCents() below still refuses to price them for anything
// new — but a webhook for a live legacy subscription has to know what that person actually pays.
// Without this, their event inserted a null price into a NOT NULL column, the insert failed, the
// webhook returned 500, and Stripe retried it forever while the subscription never registered.
const LEGACY_PLAN_CENTS = { maker: 299, sculptor: 4999 };
function planCents(plan) { return PLANS[plan] ? PLANS[plan].cents : null; }

function platformFeeCents(amountCents) { return Math.round(amountCents * PLATFORM_RATE); }
function sellerNetCents(amountCents) { return amountCents - platformFeeCents(amountCents); }
function isAboveFloor(amountCents) { return Number.isInteger(amountCents) && amountCents >= PRICE_FLOOR_CENTS; }
// Separate from isAboveFloor on purpose. Conflating them is how the bid route came to promise the
// listing floor on a column that enforces a different one.
function isValidBid(amountCents) { return Number.isInteger(amountCents) && amountCents >= MIN_BID_CENTS; }

// Dream Mover referral commission. A mover who drives a sale through their promo link
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
function recordedPlanCents(plan) {
  const live = planCents(plan);
  if (live !== null && live !== undefined) return live;
  return LEGACY_PLAN_CENTS[plan] !== undefined ? LEGACY_PLAN_CENTS[plan] : 0;
}

module.exports = {
  PLATFORM_RATE, PRICE_FLOOR_CENTS, MIN_BID_CENTS, isValidBid,
  BUILDER_CENTS, FREE_PROJECTS, LEGACY_PLANS, LEGACY_PLAN_CENTS, recordedPlanCents, CONCEPT_ACCESS_DAYS, PLANS, planCents,
  platformFeeCents, sellerNetCents, isAboveFloor,
  MOVER_RATE, moverCommissionCents, platformNetAfterMoverCents,
};
