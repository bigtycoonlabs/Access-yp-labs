// The image economy, in one place — the single source of truth for image limits and pricing.
// Every concept gets a monthly image allowance; beyond it, images come from standalone "Extras"
// packs the owner buys. Clay generates images automatically but SPARINGLY, so the allowance
// mostly stays with the person.

// Images included per concept, per calendar month, by plan.
const MONTHLY_INCLUDED = { base: 20, sculptor: 100 };

// Standalone "Extras" packs — one-time purchases. Credits attach to the concept and don't expire
// (unlike the monthly allowance, which resets each month).
const PACKS = [
  { id: 'img20', images: 20, price_cents: 99,  label: '20 images', blurb: '20 extra images for this concept' },
  { id: 'img50', images: 50, price_cents: 165, label: '50 images', blurb: '50 extra images — best value' },
];

// How many images Clay makes on its own per build. Small on purpose: the allowance is meant mostly
// for the person, so Clay adds only a couple of key visuals (e.g. a logo and one mockup), and only
// on the FIRST build of a concept — not on every small enhancement.
const AUTO_IMAGES_PER_BUILD = 2;

function monthlyIncluded(plan) {
  return MONTHLY_INCLUDED[plan === 'sculptor' ? 'sculptor' : 'base'];
}

function packById(id) {
  return PACKS.find((p) => p.id === id) || null;
}

// Given a plan, images already used this month, and purchased (pack) credits on hand, what's the
// picture? Pure — the caller supplies the counts from the database.
function budget({ plan, usedThisMonth = 0, purchased = 0 }) {
  const included = monthlyIncluded(plan);
  const used = Math.max(0, usedThisMonth);
  const freeRemaining = Math.max(0, included - used);
  const purchasedRemaining = Math.max(0, purchased);
  return {
    plan: plan === 'sculptor' ? 'sculptor' : 'base',
    monthly_included: included,
    used_this_month: used,
    free_remaining: freeRemaining,
    purchased_balance: purchasedRemaining,
    total_remaining: freeRemaining + purchasedRemaining,
    can_generate: (freeRemaining + purchasedRemaining) > 0,
  };
}

// How many images Clay should auto-make on a build, never exceeding what's actually available.
// Only the first build gets auto images — enhancements don't, to spend the allowance sparingly.
function autoBudget({ plan, usedThisMonth = 0, purchased = 0, isFirstBuild = true }) {
  if (!isFirstBuild) return 0;
  const b = budget({ plan, usedThisMonth, purchased });
  return Math.max(0, Math.min(AUTO_IMAGES_PER_BUILD, b.total_remaining));
}

module.exports = { MONTHLY_INCLUDED, PACKS, AUTO_IMAGES_PER_BUILD, monthlyIncluded, packById, budget, autoBudget };
