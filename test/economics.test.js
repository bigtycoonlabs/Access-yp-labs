const { test } = require('node:test');
const assert = require('node:assert');
const { computeUnitEconomics } = require('../src/lib/economics');

test('computes a full, correct picture from ordinary assumptions', () => {
  const r = computeUnitEconomics({
    price_per_unit: 50, unit_cost: 10, payment_fee_pct: 2.9,
    monthly_fixed_costs: 2000, startup_cost: 5000, expected_units_per_month: 100,
  });
  assert.strictEqual(r.payment_fee_per_unit, 1.45);        // 50 * 2.9%
  assert.strictEqual(r.variable_cost_per_unit, 11.45);     // 10 + 1.45
  assert.strictEqual(r.contribution_margin_per_unit, 38.55);
  assert.strictEqual(r.gross_margin_pct, 77.1);            // 38.55 / 50
  assert.strictEqual(r.break_even_units_per_month, 52);    // ceil(2000 / 38.55) = ceil(51.88)
  assert.strictEqual(r.break_even_revenue_per_month, 2600);
  assert.strictEqual(r.monthly_revenue_at_expected, 5000);
  assert.strictEqual(r.monthly_contribution_at_expected, 3855);
  assert.strictEqual(r.monthly_operating_profit_at_expected, 1855);
  assert.strictEqual(r.annual_operating_profit_at_expected, 22260);
  assert.strictEqual(r.payback_months, 2.7);               // 5000 / 1855
  assert.strictEqual(r.warnings.length, 0);
});

test('no break-even when each sale loses money after variable cost', () => {
  const r = computeUnitEconomics({ price_per_unit: 5, unit_cost: 10, monthly_fixed_costs: 100 });
  assert.strictEqual(r.contribution_margin_per_unit, -5);
  assert.strictEqual(r.break_even_units_per_month, null);
  assert.ok(r.warnings.some((w) => /no break-even/i.test(w)));
});

test('missing price never invents a margin — it warns instead', () => {
  const r = computeUnitEconomics({ unit_cost: 10, monthly_fixed_costs: 500 });
  assert.strictEqual(r.contribution_margin_per_unit, null);
  assert.strictEqual(r.gross_margin_pct, null);
  assert.ok(r.warnings.some((w) => /no price/i.test(w)));
});

test('no payback period is reported when the business runs at a loss', () => {
  const r = computeUnitEconomics({
    price_per_unit: 20, unit_cost: 5, monthly_fixed_costs: 1000,
    startup_cost: 3000, expected_units_per_month: 40, // contribution 15 * 40 = 600 < 1000 fixed
  });
  assert.strictEqual(r.monthly_operating_profit_at_expected, -400);
  assert.strictEqual(r.payback_months, null);
  assert.ok(r.warnings.some((w) => /payback/i.test(w)));
});

test('subscription LTV and LTV:CAC compute only when churn is supplied', () => {
  const withChurn = computeUnitEconomics({ price_per_unit: 50, unit_cost: 11.45, monthly_churn_pct: 5, cac: 20 });
  // contribution ~= 38.55; lifetime = 100/5 = 20 months; ltv ~= 771
  assert.strictEqual(withChurn.ltv, 771);
  assert.strictEqual(withChurn.ltv_cac_ratio, 38.6);       // 771 / 20
  const noChurn = computeUnitEconomics({ price_per_unit: 50, unit_cost: 10 });
  assert.strictEqual(noChurn.ltv, null);
  assert.strictEqual(noChurn.ltv_cac_ratio, null);
});

test('empty input is honest, not a crash', () => {
  const r = computeUnitEconomics({});
  assert.strictEqual(r.contribution_margin_per_unit, null);
  assert.ok(Array.isArray(r.warnings) && r.warnings.length >= 1);
});
