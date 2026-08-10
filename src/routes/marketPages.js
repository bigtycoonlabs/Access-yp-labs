// SERVER-RENDERED LISTING PAGES.
//
// The Dream Market had no indexable inventory. Every listing shared one title — "Listing — The Dream
// Market" — carried no h1, and rendered entirely from JavaScript, so a crawler saw thirteen
// identical empty shells. The Desk, which sells nothing, was fully indexed; the marketplace, which
// is the business, was invisible.
//
// This is the thing Amazon and Etsy get right and it is not subtle: a product page is a real page,
// on its own address, with its own title and its own words in the HTML. That is how somebody
// searching for "buy a dog walking business plan" ever arrives.
//
// The interactive page keeps working exactly as it does — this serves the same listing as real HTML,
// links to the interactive version for anyone who wants to act on it, and is what search engines and
// link previews read.

const express = require('express');
const { query } = require('../config/db');
const { asyncHandler } = require('../lib/http');

const router = express.Router();
const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// A page in the platform's own shell rather than a bare document, so somebody who lands here from a
// search sees the real site and can move around it.
function page({ title, description, canonical, body, jsonLd }) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
<link rel="canonical" href="${esc(canonical)}"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:type" content="product"/>
<meta property="og:url" content="${esc(canonical)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<link rel="stylesheet" href="/css/kiln.css"/>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
</head><body>
<a class="skip" href="#main">Skip to main content</a>
<header class="site"><div class="wrap bar">
  <a class="brand" href="/">Access YP Labs</a>
  <nav class="top" aria-label="Primary"></nav>
</div></header>
<main id="main" class="wrap">
${body}
</main>
<script src="/js/a11y.js?v=20260807z"></script>
<script src="/js/api.js?v=20260807z"></script>
<script src="/js/nav.js?v=20260807z"></script>
</body></html>`;
}

// A listing's own words, for the title and description. Falls back down a chain rather than to
// something generic, because "Listing — The Dream Market" repeated thirteen times is what made every
// page look like a duplicate of every other one.
function describe(row) {
  const brief = row.brief && typeof row.brief === 'object' ? row.brief : {};
  const bits = [brief.problem, brief.customer, row.risk_summary].filter(Boolean);
  const text = bits.join(' ').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 300);
  return `An unbuilt business project for sale on the Dream Market: ${row.title}. `
    + 'Researched and packaged, ready for somebody to take on.';
}

// GET /market/:id — the indexable version of a listing.
router.get('/market/:id', asyncHandler(async (req, res, next) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return next();
  const r = await query(
    `SELECT l.id, l.price_cents, l.format, l.stage_label, l.status, l.created_at,
            c.title, c.category, c.risk_summary, c.brief, c.clays_take,
            COALESCE(u.display_name, 'A Dream Market creator') AS seller_alias
       FROM listings l
       JOIN concepts c ON c.id = l.concept_id
       JOIN users u ON u.id = l.seller_id
      WHERE l.id = $1 AND l.status = 'live'`, [req.params.id]);

  if (!r.rows.length) {
    // A withdrawn or sold listing is GONE rather than missing — 410 tells a crawler to drop it
    // instead of retrying forever, and tells a person what happened.
    res.status(410);
    return res.type('html').send(page({
      title: 'This project is no longer for sale — Access YP Labs',
      description: 'This listing has been withdrawn or claimed.',
      canonical: `${SITE()}/marketplace.html`,
      body: `<h1>This project is no longer for sale</h1>
        <p>It was either claimed by somebody or taken down by the person who listed it.</p>
        <p><a href="/marketplace.html">See what is on the Dream Market now</a></p>`,
    }));
  }

  const row = r.rows[0];
  const brief = row.brief && typeof row.brief === 'object' ? row.brief : {};
  const price = (row.price_cents / 100).toFixed(2);
  const description = describe(row);

  const rows = [
    ['The problem it solves', brief.problem],
    ['Who you would serve', brief.customer],
    ['What you could make', brief.earning],
    ['Why you', brief.why_you],
  ].filter((x) => x[1]);

  const body = `
  <p><a href="/marketplace.html">← The Dream Market</a></p>
  <h1>${esc(row.title)}</h1>
  <p class="muted">An unbuilt business project, listed by ${esc(row.seller_alias)} · $${esc(price)}</p>

  ${rows.length ? `<section aria-labelledby="opp-h">
    <h2 id="opp-h">The opportunity at a glance</h2>
    ${rows.map((x) => `<p><strong>${esc(x[0])}:</strong> ${esc(x[1])}</p>`).join('\n    ')}
  </section>` : ''}

  ${row.clays_take ? `<section aria-labelledby="take-h">
    <h2 id="take-h">Clay's read on it</h2>
    <p>${esc(row.clays_take)}</p>
  </section>` : ''}

  ${row.risk_summary ? `<section aria-labelledby="risk-h">
    <h2 id="risk-h">What to be aware of</h2>
    <p>${esc(row.risk_summary)}</p>
  </section>` : ''}

  <section aria-labelledby="what-h">
    <h2 id="what-h">What you would be buying</h2>
    <p>This is a business project, not a running business. It has been researched and packaged so
      somebody can pick it up and start — it has no customers and no revenue yet, and nothing here
      is a promise that it will earn.</p>
    <p><a class="btn" href="/listing.html?id=${esc(row.id)}">Open this listing</a></p>
  </section>`;

  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(page({
    title: `${row.title} — an unbuilt business for sale | Access YP Labs`,
    description,
    canonical: `${SITE()}/market/${row.id}`,
    body,
    // Marked up as a Product so a search result can show the price. Deliberately no aggregateRating
    // and no availability claim beyond InStock — inventing review counts to win a rich snippet is
    // the same lie as inventing a revenue figure.
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: row.title,
      description,
      category: String(row.category || '').replace(/_/g, ' '),
      offers: {
        '@type': 'Offer',
        price,
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        url: `${SITE()}/market/${row.id}`,
      },
    },
  }));
}));

module.exports = router;
