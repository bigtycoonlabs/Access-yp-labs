// WHAT A LISTING COSTS, SAID HONESTLY. ONE DEFINITION.
//
// A live auction listing was rendering on its public page, and in the Product markup search engines
// read, as "$0.00". The price was not zero. An auction has no price_cents at all — it has a starting
// bid — and `(null / 100).toFixed(2)` is "0.00". Nobody wrote the number; a missing value turned
// into a confident one on the way to the screen.
//
// That is this platform's signature defect wearing a different hat: a failed or absent read printed
// as a clean zero. It is worse here than most places it has appeared, because the number is the
// price of somebody's work, it was published to Google as an offer of a free product, and the person
// who owns the platform cannot catch it by glancing at the page.
//
// The interactive marketplace and listing pages branch on format and were always right. Everything
// built after them — the server-rendered listing page, the homepage cards, the staff console, the
// mover pages — read price_cents alone. So the rule lives here now, once, and each surface asks.

// Cents to dollars. Only ever called with a real number.
function dollars(cents) {
  return '$' + (Number(cents) / 100).toFixed(2);
}

// The one honest sentence about what a listing costs.
//
// Three genuinely different states, and they must not be flattened into each other:
//   a flat listing has a price
//   an auction has a starting bid and no price, which is not the same as a price of nothing
//   a listing with neither is broken, and saying so is better than inventing a figure for it
function priceLabel(listing) {
  const l = listing || {};
  const isAuction = String(l.format || '') === 'auction';

  if (isAuction) {
    if (l.starting_bid_cents == null) return 'Auction — no starting bid set';
    return 'Auction, bidding from ' + dollars(l.starting_bid_cents);
  }
  if (l.price_cents == null) return 'Price not set';
  return dollars(l.price_cents);
}

// Whichever figure a buyer would actually be asked for first, in cents, or null if there is not one.
// Callers doing arithmetic (a mover's commission, a sort) want this rather than the label.
function askingCents(listing) {
  const l = listing || {};
  if (String(l.format || '') === 'auction') return l.starting_bid_cents == null ? null : Number(l.starting_bid_cents);
  return l.price_cents == null ? null : Number(l.price_cents);
}

// The schema.org offer for a listing, or null.
//
// Returning null matters. The alternative — an Offer carrying 0.00 — tells every search engine that
// a piece of work somebody expects to be paid for is free, and it is the kind of claim that gets
// repeated in a search result long after the page is fixed. An auction is an AggregateOffer with a
// lowPrice and no highPrice, which is precisely true: bidding starts there and we do not know where
// it ends. Claiming the starting bid as `price` would be a small lie in the same family as the big
// one this file exists to stop.
function offerJsonLd(listing, url) {
  const l = listing || {};
  const cents = askingCents(l);
  if (cents == null) return null;

  const money = (Number(cents) / 100).toFixed(2);
  if (String(l.format || '') === 'auction') {
    return {
      '@type': 'AggregateOffer',
      lowPrice: money,
      priceCurrency: 'USD',
      offerCount: 1,
      availability: 'https://schema.org/InStock',
      url,
    };
  }
  return {
    '@type': 'Offer',
    price: money,
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
    url,
  };
}

module.exports = { priceLabel, askingCents, offerJsonLd, dollars };
