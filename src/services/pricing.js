const SERVICE_CATALOG = Object.freeze({
  marketing_site: { label: 'Marketing Website', price: 1200, sla_hours: 72 },
  booking_engine: { label: 'Direct Booking Engine + PMS Integration', price: 1500, sla_hours: 72 },
  ai_concierge: { label: 'AI Hospitality Concierge', price: 1800, sla_hours: 72 },
  mobile_app: { label: 'React Native Mobile App (iOS/Android)', price: 1500, sla_hours: 72 },
  web_portal: { label: 'Web Application Portal', price: 1000, sla_hours: 48 },
  sop_manual: { label: 'SOPs & Employee Manual', price: 750, sla_hours: 24 },
  va_dashboard: { label: 'VA Training Dashboard', price: 950, sla_hours: 48 },
});

const BLUEPRINT_BASE = 6000;
const HOSTING_MONTHLY = 60;
const INSTALL_MONTHS = 3;

function calculateQuote({ track, cart = [], payment_plan }) {
  const lineItems = [];
  if (track === 'A') {
    lineItems.push({ type: 'full_blueprint', label: 'Full Architecture Tech Package', amount: BLUEPRINT_BASE, sla_hours: 112 });
  } else if (track === 'B') {
    [...new Set(cart)].forEach((serviceId) => {
      const service = SERVICE_CATALOG[serviceId];
      if (service) lineItems.push({ type: serviceId, ...service, amount: service.price });
    });
  } else {
    throw new Error('Invalid project track.');
  }
  if (!lineItems.length) throw new Error('Select at least one service.');
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const financedTotal = payment_plan === 'financed' ? subtotal + (HOSTING_MONTHLY * INSTALL_MONTHS) : null;
  return { lineItems, subtotal, financedTotal, installmentAmount: financedTotal ? Math.round(financedTotal / INSTALL_MONTHS) : null, hostingMonthly: HOSTING_MONTHLY, installmentMonths: INSTALL_MONTHS };
}

module.exports = { SERVICE_CATALOG, BLUEPRINT_BASE, HOSTING_MONTHLY, INSTALL_MONTHS, calculateQuote };
