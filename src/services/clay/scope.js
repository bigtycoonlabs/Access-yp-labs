// WHICH HOME FITS WHAT WAS ASKED FOR.
//
// The owner decided on 16 Sept 2026 that Penny explains three homes and suggests the smallest that
// does the job. A cleaner asking for "a page where people can ask for a quote" does not need their own
// server, and telling them they do would cost them a weekend and a monthly bill.
//
// This reads plain signals in the words and names them, so Penny can say WHY: "you mentioned
// customers logging in, which needs somewhere to keep accounts". It never decides for the person.
// It recommends, explains, and asks.

const TIERS = ['labs_site', 'labs_portal', 'custom_app'];

// What each home is, in the words Penny uses.
const WHAT = {
  labs_site: 'a site hosted here on Access YP Labs, such as a landing page, a wedding site, a menu '
    + 'or a quote form. It goes online at an address on our site in one step, forms send messages '
    + 'straight to you, and you need no other accounts.',
  labs_portal: 'the Labs customer portal, attached to your site, where each customer signs in to '
    + 'see what is theirs: their bookings, invoices or documents.',
  custom_app: 'a custom web application with its own backend, built into your own GitHub and run '
    + 'on your own Railway and Supabase accounts. It can do anything, and it needs those accounts '
    + 'and their keys.',
};

// Whether each home can actually be delivered today. Penny must never offer something as ready
// that is not.
const AVAILABLE = {
  labs_site: { ready: true },
  labs_portal: { ready: false, says: 'The customer portal is not built yet. I can build your site '
    + 'now and attach the portal when it is ready.' },
  custom_app: { ready: true, partial: 'I can build a working version of the app to try here now. '
    + 'Launching it on your own accounts is not switched on yet, so it stays a preview until then.' },
};

// Signals, each with the words that trigger it and the plain reason it matters.
const SIGNALS = [
  { tier: 'custom_app', re: /\b(pay(ment)?s?|checkout|subscriptions?|stripe|charge (the|a) card|take (card )?payments?)\b/i,
    why: 'taking payments' },
  { tier: 'custom_app', re: /\b(inventory|stock levels?|admin (panel|dashboard)|database|crm|point of sale|pos system)\b/i,
    why: 'keeping and managing your own records' },
  { tier: 'custom_app', re: /\b(api|integrat\w*|sync\w* with|webhooks?|connect\w* to (quickbooks|square|shopify|google))\b/i,
    why: 'connecting to other software' },
  { tier: 'custom_app', re: /\b(marketplace|multiple (vendors|sellers)|staff (accounts|logins)|team members? (log|sign) in|roles? and permissions)\b/i,
    why: 'several kinds of users with their own access' },
  { tier: 'custom_app', re: /\b(real[- ]time|live (availability|tracking|chat)|scheduling system|availability calendar|dispatch)\b/i,
    why: 'live data that changes as people use it' },
  { tier: 'labs_portal', re: /\b(client|customer) (portal|area|dashboard|account)s?\b/i,
    why: 'a place for each customer' },
  { tier: 'labs_portal', re: /\b(customers?|clients?|members?|tenants?) (can )?(log|sign) ?in\b|\blog ?in to see\b|\bsee (their|his|her) (own )?(invoices?|bookings?|documents?|orders?|history)\b/i,
    why: 'customers signing in to see what is theirs' },
  { tier: 'labs_site', re: /\b(landing page|wedding|event page|menu|portfolio|one[- ]page|brochure|contact (form|page)|quote (form|request)|coming soon|link in bio|about (us|page)|services page|flyer)\b/i,
    why: 'a page people read and can send you a message from' },
];

function classify(askedFor) {
  const t = String(askedFor || '');
  const hits = { labs_site: [], labs_portal: [], custom_app: [] };
  for (const s of SIGNALS) {
    if (s.re.test(t) && !hits[s.tier].includes(s.why)) hits[s.tier].push(s.why);
  }
  // The largest need wins, because a site cannot take payments however nicely it is asked.
  const recommended = hits.custom_app.length ? 'custom_app'
    : hits.labs_portal.length ? 'labs_portal' : 'labs_site';
  return { recommended, signals: hits, says: explain(recommended, hits) };
}

function list(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function explain(rec, hits) {
  const parts = [];
  if (rec === 'custom_app') {
    parts.push('You mentioned ' + list(hits.custom_app) + ', which needs its own backend. That '
      + 'points to ' + WHAT.custom_app);
    parts.push('If a smaller start would do, I could instead build ' + WHAT.labs_site
      + ' That would not do ' + list(hits.custom_app) + ', but it would be online today.');
  } else if (rec === 'labs_portal') {
    parts.push('You mentioned ' + list(hits.labs_portal) + '. That fits ' + WHAT.labs_portal);
    parts.push(AVAILABLE.labs_portal.says);
    parts.push('If you need more than the portal offers, the other route is ' + WHAT.custom_app);
  } else {
    parts.push('This sounds like ' + WHAT.labs_site);
    parts.push('If you later want customers to sign in, I can attach the Labs customer portal, and '
      + 'if you need something fully custom, I can build it as a web application on your own '
      + 'accounts instead.');
  }
  return parts.join(' ');
}

const TIER_QUESTION = 'Where should this live: as a site hosted on Access YP Labs, with the Labs '
  + 'customer portal attached, or as a custom web application on your own accounts?';

function tierChoice(v) {
  return TIERS.includes(v) ? v : null;
}

module.exports = { classify, explain, TIERS, WHAT, AVAILABLE, TIER_QUESTION, tierChoice };
