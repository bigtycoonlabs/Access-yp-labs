const SERVICE_CATALOG = Object.freeze({
  arbitrage_access: {
    label: 'YP Labs Arbo + Equity Arbitrage Access',
    price: 997,
    sla_hours: 24,
  },
});

const ARBITRAGE_ACCESS_PRICE = 997;
const HOSTING_MONTHLY = 0;
const INSTALL_MONTHS = 1;

function calculateQuote({ track, cart = [], payment_plan }) {
  if (!['A', 'arbitrage_access'].includes(track)) throw new Error('Invalid access track.');
  if (payment_plan !== 'one_time') throw new Error('Invalid payment plan.');

  const access = SERVICE_CATALOG.arbitrage_access;
  const lineItems = [{
    type: 'arbitrage_access',
    label: access.label,
    amount: access.price,
    sla_hours: access.sla_hours,
  }];

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const financedTotal = null;

  return {
    lineItems,
    subtotal,
    financedTotal,
    installmentAmount: financedTotal ? Math.round(financedTotal / INSTALL_MONTHS) : null,
    hostingMonthly: HOSTING_MONTHLY,
    installmentMonths: INSTALL_MONTHS,
  };
}

module.exports = {
  SERVICE_CATALOG,
  ARBITRAGE_ACCESS_PRICE,
  HOSTING_MONTHLY,
  INSTALL_MONTHS,
  calculateQuote,
};
