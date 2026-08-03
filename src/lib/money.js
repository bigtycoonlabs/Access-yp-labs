// Money is handled in integer cents everywhere. One source of truth for the
// platform economics so no route can drift: 20% platform take, $10 floor.
const PLATFORM_RATE = 0.20;      // 20% across marketplace + consultants
const PRICE_FLOOR_CENTS = 1000;  // $10 minimum listing price

// Consultant session economics (fixed): $150 total, 20% / 80% split.
const CONSULT_FEE_CENTS = 15000;
const CONSULT_PLATFORM_CENTS = 3000;   // $30
const CONSULT_CONSULTANT_CENTS = 12000; // $120
const CONSULT_WINDOW_HOURS = 12;        // free continuation window

// Plans:
//  Maker    — $2.99 / month, PER CONCEPT (keep + export one concept).
//  Sculptor — $49.99 / month, UNLIMITED concepts.
const MAKER_CENTS = 299;
const SCULPTOR_CENTS = 4999;
const CONCEPT_ACCESS_DAYS = 30;   // free/included window before timeout

const PLANS = {
  maker:    { cents: MAKER_CENTS,    mode: 'subscription', per_concept: true,  label: 'Maker — $2.99/month for this concept' },
  sculptor: { cents: SCULPTOR_CENTS, mode: 'subscription', per_concept: false, label: 'Sculptor — $49.99/month, unlimited concepts' },
};
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
  MAKER_CENTS, SCULPTOR_CENTS, CONCEPT_ACCESS_DAYS, PLANS, planCents,
  platformFeeCents, sellerNetCents, isAboveFloor,
  MOVER_RATE, moverCommissionCents, platformNetAfterMoverCents,
};
