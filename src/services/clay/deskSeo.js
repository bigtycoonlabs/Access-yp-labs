// THE DESK, MADE FINDABLE.
//
// The Desk is the only part of this platform that can bring strangers in on its own. Everything else
// needs someone to already know we exist. So it is worth writing deliberately for what people
// actually search, rather than publishing good pieces into the dark and hoping.
//
// Two honesty rules hold, and they matter more here than anywhere because SEO invites cutting them:
//   1. The KEYWORD chooses the topic, never the content. Clay writes the true piece and targets a
//      real search; he never pads a piece with phrases, and never writes something he does not
//      believe in order to rank for it. A keyword-stuffed Desk would earn traffic and lose the
//      thing the traffic came for.
//   2. Nothing here invents an audience. These are terms people plainly search when they are trying
//      to start something — not fabricated volumes we cannot measure. Where we do not know how much
//      traffic a term gets, we do not pretend to.

const { query } = require('../../config/db');

// The categories a reader can browse. Small on purpose: seven browsable shelves beat twenty-four
// one-article "topics", which is what the Desk had.
const CATEGORIES = [
  { slug: 'starting-out',       label: 'Starting out',        blurb: 'Going from an idea in your head to something real.' },
  { slug: 'finding-customers',  label: 'Finding customers',   blurb: 'Proof, first buyers, and the strangers who tell you it works.' },
  { slug: 'pricing',            label: 'Pricing',             blurb: 'What to charge, and what it does to everything else.' },
  { slug: 'marketing',          label: 'Marketing',           blurb: 'Getting seen, and saying the thing that lands.' },
  { slug: 'growing',            label: 'Growing',             blurb: 'When something works and you want more of it.' },
  { slug: 'buying-and-selling', label: 'Buying and selling',  blurb: 'The Dream Market, what makes a project worth buying, and what it is worth.' },
  { slug: 'getting-help',       label: 'Getting help',        blurb: 'Partners, first hires, and what to hand off.' },
];
const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);
const isCategory = (s) => CATEGORY_SLUGS.includes(String(s || ''));

// What people genuinely type when they are trying to start something. Grouped by category so Clay
// writes toward a real search from within the subject he is already writing about — not bolted on
// afterwards. These are search INTENTS, chosen because they describe a person with a problem we can
// actually help with; they are not a claim about monthly volume, which we cannot measure and will
// not invent.
const KEYWORD_TARGETS = {
  'starting-out': [
    'how to start a business with no money', 'business ideas for beginners',
    'how to validate a business idea', 'side hustle ideas that actually work',
    'how to write a business plan', 'what business should i start',
  ],
  'finding-customers': [
    'how to get your first customers', 'how to find customers for a new business',
    'how to test a business idea before building it', 'how to get customers with no marketing budget',
  ],
  pricing: [
    'how to price a product', 'how much should i charge for my service',
    'pricing strategy for small business', 'how to calculate profit margin',
  ],
  marketing: [
    'marketing for small business', 'how to market a business with no budget',
    'best marketing channel for a new business', 'how to write a value proposition',
  ],
  growing: [
    'how to grow a small business', 'how to increase revenue',
    'how to turn a service into a product', 'when to raise prices',
  ],
  'buying-and-selling': [
    'how to sell a business idea', 'where to sell business ideas',
    'buying an online business', 'how much is a business idea worth',
  ],
  'getting-help': [
    'how to find a business partner', 'when to make your first hire',
    'how to find a co-founder', 'what to outsource in a small business',
  ],
};

// Which targets have NOT been written for yet, so Clay covers ground instead of circling.
async function openTargets(limit = 6) {
  const used = await query(
    `SELECT DISTINCT unnest(keywords) AS kw FROM desk_articles WHERE keywords <> '{}'`);
  const taken = new Set(used.rows.map((r) => String(r.kw).toLowerCase()));
  const open = [];
  for (const [category, list] of Object.entries(KEYWORD_TARGETS)) {
    for (const kw of list) {
      if (!taken.has(kw.toLowerCase())) open.push({ category, keyword: kw });
    }
  }
  // Fewest-covered category first, so the Desk fills out evenly rather than going deep on one shelf.
  const counts = await query(
    `SELECT category, COUNT(*)::int AS n FROM desk_articles
      WHERE status='published' AND category IS NOT NULL GROUP BY category`);
  const byCat = Object.fromEntries(counts.rows.map((r) => [r.category, r.n]));
  open.sort((a, b) => (byCat[a.category] || 0) - (byCat[b.category] || 0));
  return open.slice(0, limit);
}

async function categoriesWithCounts() {
  const r = await query(
    `SELECT category, COUNT(*)::int AS n FROM desk_articles
      WHERE status='published' AND category IS NOT NULL GROUP BY category`);
  const byCat = Object.fromEntries(r.rows.map((x) => [x.category, x.n]));
  // Every category is returned, including empty ones, with its real count — an empty shelf is
  // honest and tells a reader what is coming, whereas hiding it makes the Desk look smaller.
  return CATEGORIES.map((c) => ({ ...c, count: byCat[c.slug] || 0 }));
}

async function byCategory(slug, limit = 30) {
  if (!isCategory(slug)) return null;
  const r = await query(
    `SELECT id, kind, title, dek, slug, image_url, image_alt, meta_desc, category, published_at
       FROM desk_articles
      WHERE status='published' AND category=$1
      ORDER BY published_at DESC LIMIT $2`,
    [slug, Math.min(Math.max(Number(limit) || 30, 1), 60)]);
  return r.rows;
}

// Catch up anything published before this machinery existed: give it a category, a meta description
// and a picture. Runs in the background, reports honestly, and never throws.
async function backfill({ images = true, limit = 10 } = {}) {
  const out = { categorised: 0, described: 0, illustrated: 0, image_failures: 0 };
  try {
    const cat = await query(
      `UPDATE desk_articles SET category='starting-out'
        WHERE status='published' AND category IS NULL RETURNING id`);
    out.categorised = cat.rowCount || 0;

    const compose = require('./deskCompose');
    const missing = await query(
      `SELECT id, dek, body FROM desk_articles
        WHERE status='published' AND (meta_desc IS NULL OR meta_desc='') LIMIT 50`);
    for (const a of missing.rows) {
      await query('UPDATE desk_articles SET meta_desc=$2 WHERE id=$1',
        [a.id, compose.metaDescription(a.dek, a.body)]);
      out.described += 1;
    }

    if (images) {
      const noPic = await query(
        `SELECT id FROM desk_articles WHERE status='published' AND image_url IS NULL
          ORDER BY published_at DESC LIMIT $1`, [Math.min(Math.max(Number(limit) || 10, 1), 25)]);
      for (const a of noPic.rows) {
        const r = await compose.ensureArticleImage(a.id);
        if (r && r.ok) out.illustrated += 1;
        else {
          out.image_failures += 1;
          // Stop on a configuration problem rather than failing the same way 25 times.
          if (r && r.reason === 'images_not_configured') { out.reason = 'images_not_configured'; break; }
        }
      }
    }
    return { ok: true, ...out };
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message, ...out };
  }
}

module.exports = { CATEGORIES, CATEGORY_SLUGS, isCategory, KEYWORD_TARGETS, openTargets, categoriesWithCounts, byCategory, backfill };
