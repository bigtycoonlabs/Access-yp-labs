// Money is handled in integer cents everywhere. One source of truth for the
// platform economics so no route can drift: 20% platform take, $50 floor.
const PLATFORM_RATE = 0.20;      // 20% across marketplace + consultants
const PRICE_FLOOR_CENTS = 5000;  // $50 minimum listing price

// Consultant session economics (fixed): $150 total, 20% / 80% split.
const CONSULT_FEE_CENTS = 15000;
const CONSULT_PLATFORM_CENTS = 3000;   // $30
const CONSULT_CONSULTANT_CENTS = 12000; // $120
const CONSULT_WINDOW_HOURS = 12;        // free continuation window

// Subscription prices.
const SUB_PER_IDEA_CENTS = 299;   // $2.99 / idea
const SUB_UNLIMITED_CENTS = 4999; // $49.99 / month

function platformFeeCents(amountCents) {
  return Math.round(amountCents * PLATFORM_RATE);
}
function sellerNetCents(amountCents) {
  return amountCents - platformFeeCents(amountCents);
}
function isAboveFloor(amountCents) {
  return Number.isInteger(amountCents) && amountCents >= PRICE_FLOOR_CENTS;
}

module.exports = {
  PLATFORM_RATE, PRICE_FLOOR_CENTS,
  CONSULT_FEE_CENTS, CONSULT_PLATFORM_CENTS, CONSULT_CONSULTANT_CENTS, CONSULT_WINDOW_HOURS,
  SUB_PER_IDEA_CENTS, SUB_UNLIMITED_CENTS,
  platformFeeCents, sellerNetCents, isAboveFloor,
};
