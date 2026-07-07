const SERVICE_CATALOG = Object.freeze({
  marketing_site: { label: 'Marketing Website', price: 1200, monthly: 0, sla_hours: 72 },
  booking_engine: { label: 'Direct Booking Engine + PMS Integration', price: 1500, monthly: 0, sla_hours: 72 },
  ai_concierge: { label: 'AI Concierge Customer Receptionist', price: 500, monthly: 65, sla_hours: 72, description: 'Calling, text, call transfers, data capture, and email call transcripts.' },
  mobile_app: { label: 'React Native Mobile App (iOS/Android)', price: 1500, monthly: 0, sla_hours: 72 },
  web_portal: { label: 'Web Application Portal', price: 1000, monthly: 0, sla_hours: 48 },
  sop_manual: { label: 'SOPs & Employee Manual', price: 750, monthly: 0, sla_hours: 24 },
  va_dashboard: { label: 'VA Training Dashboard', price: 950, monthly: 0, sla_hours: 48 },
});

const BLUEPRINT_BASE = 6000;
const HOSTING_MONTHLY = 60;
const INSTALL_MONTHS = 3;

function calculateQuote({ track, cart = [], payment_plan = 'one_time' }) {
  const lineItems = [];
  const selected = [...new Set(cart || [])];

  if (track === 'A') {
    lineItems.push({ type: 'full_blueprint', label: 'Full Architecture Tech Package', amount: BLUEPRINT_BASE, monthly: HOSTING_MONTHLY, sla_hours: 112 });
    selected.forEach((serviceId) => {
      const service = SERVICE_CATALOG[serviceId];
      if (service && service.monthly) lineItems.push({ type: serviceId, ...service, amount: service.price });
    });
  } else if (track === 'B') {
    selected.forEach((serviceId) => {
      const service = SERVICE_CATALOG[serviceId];
      if (service) lineItems.push({ type: serviceId, ...service, amount: service.price });
    });
  } else {
    throw new Error('Invalid project track.');
  }

  if (!lineItems.length) throw new Error('Select at least one service.');

  const subtotal = lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const monthlyMaintenance = lineItems.reduce((sum, item) => sum + Number(item.monthly || 0), 0) + (track === 'B' ? HOSTING_MONTHLY : 0);
  const financedTotal = subtotal + (monthlyMaintenance * INSTALL_MONTHS);
  const installmentAmount = Math.round(financedTotal / INSTALL_MONTHS);

  return {
    lineItems,
    subtotal,
    financedTotal: payment_plan === 'financed' ? financedTotal : null,
    estimatedFinanceTotal: financedTotal,
    installmentAmount,
    hostingMonthly: monthlyMaintenance,
    monthlyMaintenance,
    installmentMonths: INSTALL_MONTHS,
  };
}

module.exports = { SERVICE_CATALOG, BLUEPRINT_BASE, HOSTING_MONTHLY, INSTALL_MONTHS, calculateQuote };
