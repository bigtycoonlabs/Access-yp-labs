// Money is handled in integer cents everywhere. One source of truth for the
// platform economics so no route can drift: 20% platform take, $10 floor.
const PLATFORM_RATE = 0.20;      // 20% across marketplace + consultants
const PRICE_FLOOR_CENTS = 1000;  // $10 minimum listing price

// Consultant session economics (fixed): $150 total, 20% / 80% split.
const CONSULT_FEE_CENTS = 15000;
const CONSULT_PLATFORM_CENTS = 3000;   // $30
const CONSULT_CONSULTANT_CENTS = 12000; // $120
const CONSULT_WINDOW_HOURS = 12;        // free continuation window

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
function planCents(plan) { return PLANS[plan] ? PLANS[plan].cents : null; }

function platformFeeCents(amountCents) { return Math.round(amountCents * PLATFORM_RATE); }
function sellerNetCents(amountCents) { return amountCents - platformFeeCents(amountCents); }
function isAboveFloor(amountCents) { return Number.isInteger(amountCents) && amountCents >= PRICE_FLOOR_CENTS; }

// Dream Mover referral commission. A mover who drives a sale through their promo link
// earns 5% of the sale — paid OUT OF the platform's 20% take, never out of the seller's
// share. So on an attributed sale the seller still nets 80%, the mover gets 5%, and the
// platform keeps 15%. This keeps sellers strictly better off when movers promote them.
const MOVER_RATE = 0.05;
function moverCommissionCents(amountCents) { return Math.round(amountCents * MOVER_RATE); }
function platformNetAfterMoverCents(amountCents) {
  return platformFeeCents(amountCents) - moverCommissionCents(amountCents);
}

module.exports = {
  PLATFORM_RATE, PRICE_FLOOR_CENTS,
  CONSULT_FEE_CENTS, CONSULT_PLATFORM_CENTS, CONSULT_CONSULTANT_CENTS, CONSULT_WINDOW_HOURS,
  BUILDER_CENTS, FREE_PROJECTS, LEGACY_PLANS, CONCEPT_ACCESS_DAYS, PLANS, planCents,
  platformFeeCents, sellerNetCents, isAboveFloor,
  MOVER_RATE, moverCommissionCents, platformNetAfterMoverCents,
};
