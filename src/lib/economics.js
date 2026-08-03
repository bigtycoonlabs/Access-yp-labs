// Pure unit-economics math. No I/O, no model — just arithmetic, so every derived figure is REAL
// and checkable against the assumptions it came from. This is the honesty fix for the money_flow
// section: assumptions may be estimates (and are labelled as such), but the bottom-line numbers are
// computed here, never written by a language model.
//
// Money is in dollars. We round money to cents and break-even units UP (you can't half-sell your way
// to break-even). Missing or nonsensical inputs produce nulls plus a plain-language warning — never
// a guessed number.

function num(x) { return (typeof x === 'number' && Number.isFinite(x)) ? x : null; }
function round2(x) { return x == null ? null : Math.round(x * 100) / 100; }
function round1(x) { return x == null ? null : Math.round(x * 10) / 10; }

function computeUnitEconomics(a = {}) {
  const warnings = [];
  const price = num(a.price_per_unit);
  const unitCost = num(a.unit_cost);              // variable cost / COGS per unit
  const fixed = num(a.monthly_fixed_costs);
  const startup = num(a.startup_cost);
  const expected = num(a.expected_units_per_month);
  const feePct = num(a.payment_fee_pct);          // processor fee as % of price (e.g. 2.9)
  const cac = num(a.cac);                         // customer acquisition cost
  const churn = num(a.monthly_churn_pct);         // monthly churn %, for subscription LTV

  if (price == null) warnings.push('No price per unit was given, so margins can’t be computed.');
  if (unitCost == null) warnings.push('No unit cost was given; the margin below assumes a $0 variable cost.');

  // Keep raw (unrounded) values for the math; round only at the output edge to avoid drift.
  const feePerUnit = (price != null && feePct != null) ? price * (feePct / 100) : 0;
  const variablePerUnit = (unitCost || 0) + feePerUnit;
  const contribution = price != null ? (price - variablePerUnit) : null;
  const grossMarginPct = (price && contribution != null) ? (contribution / price) * 100 : null;

  let breakEvenUnits = null, breakEvenRevenue = null;
  if (fixed != null && contribution != null) {
    if (contribution <= 0) {
      warnings.push('Each sale earns nothing after variable costs, so there is no break-even at this price — the price must rise or unit costs must fall.');
    } else {
      breakEvenUnits = Math.ceil(fixed / contribution);
      breakEvenRevenue = price != null ? breakEvenUnits * price : null;
    }
  }

  const monthlyRevenue = (expected != null && price != null) ? expected * price : null;
  const monthlyContribution = (expected != null && contribution != null) ? expected * contribution : null;
  const monthlyOperatingProfit = (monthlyContribution != null && fixed != null) ? monthlyContribution - fixed : null;

  let paybackMonths = null;
  if (startup != null && monthlyOperatingProfit != null) {
    if (monthlyOperatingProfit > 0) paybackMonths = startup / monthlyOperatingProfit;
    else warnings.push('At the expected volume this doesn’t yet turn a monthly profit, so the startup cost has no payback period until volume rises or costs fall.');
  }
  const annualOperatingProfit = monthlyOperatingProfit != null ? monthlyOperatingProfit * 12 : null;

  // Optional subscription lifetime value (only when a churn rate is supplied).
  let ltv = null, ltvCacRatio = null;
  if (churn != null && churn > 0 && contribution != null) {
    ltv = contribution * (100 / churn);           // avg lifetime (months) = 100 / churn%
    if (cac != null && cac > 0) ltvCacRatio = ltv / cac;
  }

  return {
    inputs: {
      price_per_unit: price, unit_cost: unitCost, payment_fee_pct: feePct,
      monthly_fixed_costs: fixed, startup_cost: startup, expected_units_per_month: expected,
      cac, monthly_churn_pct: churn,
    },
    payment_fee_per_unit: round2(feePerUnit),
    variable_cost_per_unit: round2(variablePerUnit),
    contribution_margin_per_unit: round2(contribution),
    gross_margin_pct: round1(grossMarginPct),
    break_even_units_per_month: breakEvenUnits,
    break_even_revenue_per_month: round2(breakEvenRevenue),
    monthly_revenue_at_expected: round2(monthlyRevenue),
    monthly_contribution_at_expected: round2(monthlyContribution),
    monthly_operating_profit_at_expected: round2(monthlyOperatingProfit),
    annual_operating_profit_at_expected: round2(annualOperatingProfit),
    payback_months: round1(paybackMonths),
    ltv: round2(ltv),
    ltv_cac_ratio: round1(ltvCacRatio),
    warnings,
  };
}

module.exports = { computeUnitEconomics, round2, round1 };
