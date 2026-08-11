// Dream Mover helpers: promo-page handles, and the founder's display rule —
// never show a bare "5%" (it reads as small); show the real dollars a mover earns
// on THIS concept.
const { moverCommissionCents } = require('./money');

// A promo handle: lowercase letters, numbers, and hyphens; 3–32 chars; no leading,
// trailing, or doubled hyphen. Kept simple so it's easy to say out loud and share.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

// Handles we won't hand out, because they collide with real paths or read as official.
const RESERVED_SLUGS = new Set([
  'admin', 'staff', 'api', 'app', 'login', 'signup', 'logout', 'me', 'new', 'edit',
  'settings', 'mover', 'movers', 'dreamhold', 'dream', 'dreams', 'clay', 'labs',
  'accessyplabs', 'support', 'help', 'about', 'terms', 'privacy', 'listing', 'listings',
]);

// Turn free text into a candidate handle: lowercase, spaces/punctuation to hyphens,
// collapse and trim hyphens.
function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

// The dollars a mover earns if THIS concept sells through their link. We surface the
// dollar figure, not the percentage, everywhere a mover sees an opportunity.
//
// Except when there is no figure to surface. `priceCents || 0` turned a listing with no fixed price
// — an auction, where the sale price is decided by bidding — into a commission of $0.00, shown to
// somebody being asked to promote it. A rate is the honest answer there: it is the part we know.
// The caller renders `label`; `cents` being null is the signal that arithmetic is not available.
function commissionDisplay(priceCents) {
  if (priceCents == null) {
    return { cents: null, dollars: null, label: '5% of whatever it sells for' };
  }
  const cents = moverCommissionCents(priceCents);
  return { cents, dollars: cents / 100, label: '$' + (cents / 100).toFixed(2) };
}

module.exports = { SLUG_RE, RESERVED_SLUGS, normalizeSlug, isValidSlug, commissionDisplay };
