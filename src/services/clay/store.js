'use strict';
// Store helpers — pure and testable. A concept can have a storefront of real products with real
// prices. Money is handled in integer CENTS end-to-end to avoid floating-point drift. These
// helpers validate and normalize what Clay writes and format prices for display; they never touch
// the database or Stripe.

const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud'];
const DEFAULT_CURRENCY = 'usd';
const CURRENCY_SYMBOLS = { usd: '$', eur: '€', gbp: '£', cad: 'CA$', aud: 'A$' };
const MAX_PRICE_CENTS = 100000000; // $1,000,000 sanity cap — a store price above this is a mistake

// Parse a human price ("19.99", "$19.99", "20", 19.99, "1,299.00") to integer cents, or null if
// it isn't a clean non-negative money value. Rejecting is safer than guessing on money.
function parsePriceToCents(input) {
  if (input == null) return null;
  if (typeof input === 'number') {
    if (!isFinite(input) || input < 0) return null;
    const c = Math.round(input * 100);
    return c > MAX_PRICE_CENTS ? null : c;
  }
  const s = String(input).trim().replace(/[$£€,\s]/g, '');
  if (s === '' || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!isFinite(cents) || cents < 0 || cents > MAX_PRICE_CENTS) return null;
  return cents;
}

function normalizeCurrency(c) {
  const v = String(c || '').trim().toLowerCase();
  return CURRENCIES.includes(v) ? v : DEFAULT_CURRENCY;
}

// Display a cents amount as a readable price, e.g. "$19.99", "£19.99", "CA$19.99".
function formatPrice(cents, currency) {
  const cur = normalizeCurrency(currency);
  const sym = CURRENCY_SYMBOLS[cur];
  const n = (Math.max(0, Math.round(Number(cents) || 0)) / 100).toFixed(2);
  return sym ? (sym + n) : (n + ' ' + cur.toUpperCase());
}

// Only accept an https image URL; anything else becomes null (no http, no data: URLs on a store).
function cleanImageUrl(s) {
  const v = String(s == null ? '' : s).trim();
  return /^https:\/\/[^\s]+$/i.test(v) ? v.slice(0, 2000) : null;
}

// Validate + normalize a new product. Returns { ok, product } or { ok:false, error } — the error
// is a plain, speakable sentence Clay can relay.
function normalizeProduct({ name, price, description, image_url, currency } = {}) {
  const nm = String(name == null ? '' : name).trim();
  if (nm.length < 1) return { ok: false, error: 'A product needs a name.' };
  const cents = parsePriceToCents(price);
  if (cents == null) return { ok: false, error: 'That price isn’t valid — give a number like 19.99.' };
  return {
    ok: true,
    product: {
      name: nm.slice(0, 200),
      price_cents: cents,
      currency: normalizeCurrency(currency),
      description: description == null ? null : String(description).slice(0, 4000),
      image_url: cleanImageUrl(image_url),
    },
  };
}

// Summarize a set of store_orders rows: paid orders count toward revenue; started-but-unfinished
// checkouts are counted separately and NEVER as money. Pure, so the money math is unit-tested.
function summarizeOrders(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const paid = list.filter((r) => r && r.status === 'paid');
  const paidTotal = paid.reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
  const currency = (paid[0] && paid[0].currency) || (list[0] && list[0].currency) || 'usd';
  return { paid_count: paid.length, paid_total_cents: paidTotal, currency, unfinished: list.length - paid.length };
}

module.exports = {
  parsePriceToCents, normalizeCurrency, formatPrice, cleanImageUrl, normalizeProduct, summarizeOrders,
  CURRENCIES, DEFAULT_CURRENCY, MAX_PRICE_CENTS,
};
