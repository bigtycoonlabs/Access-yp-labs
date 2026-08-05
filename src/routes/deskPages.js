const express = require('express');
const { asyncHandler } = require('../lib/http');
const deskCompose = require('../services/clay/deskCompose');

// Server-rendered PAGES for Clay's Desk pieces.
//
// Why rendered on the server rather than drawn by JavaScript like the rest of the site: a search
// engine (and a link preview in a message or a post) reads the HTML it is handed. A page that only
// fills itself in after JavaScript runs gives them an empty shell, so nothing Clay writes can be
// found. Each published piece now answers at its own address with its title, summary, image, and
// full text already in the HTML — which is also faster and more robust for a screen reader.
//
// Published pieces only. A draft has no public address, so an unapproved piece can never be reached
// by guessing a URL.

const router = express.Router();

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

// Escape everything that goes into HTML. Clay's text is trusted, but this is defence in depth and
// costs nothing.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Clay writes plain prose with blank lines between paragraphs — turn that into real paragraphs so
// the page has genuine structure to navigate by, rather than one undifferentiated block of text.
function paragraphs(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('\n      ');
}

function articleHtml(a) {
  const url = `${SITE()}/desk/${encodeURIComponent(a.slug)}`;
  const desc = a.meta_desc || a.dek || '';
  const kindLabel = a.kind === 'story' ? 'Story' : 'Help';
  const published = a.published_at ? new Date(a.published_at).toISOString() : null;

  // Structured data so search engines can present this as a real article.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: desc || undefined,
    image: a.image_url || undefined,
    datePublished: published || undefined,
    author: { '@type': 'Person', name: 'Clay', url: `${SITE()}/desk.html` },
    publisher: { '@type': 'Organization', name: 'Access YP Labs', url: SITE() },
    mainEntityOfPage: url,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(a.title)} — Clay's Desk, Access YP Labs</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:site_name" content="Access YP Labs">
${a.image_url ? `<meta property="og:image" content="${esc(a.image_url)}">` : ''}
<meta name="twitter:card" content="${a.image_url ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(a.title)}">
<meta name="twitter:description" content="${esc(desc)}">
${a.image_url ? `<meta name="twitter:image" content="${esc(a.image_url)}">` : ''}
<link rel="stylesheet" href="/css/kiln.css">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <a class="skip" href="#main">Skip to the article</a>
  <nav class="top" aria-label="Primary">
    <a href="/">Access YP Labs</a>
    <a href="/desk.html">Clay's Desk</a>
    <a href="/marketplace.html">The Dream Market</a>
  </nav>
  <main id="main" tabindex="-1">
    <article>
      <p class="muted">${esc(kindLabel)} from Clay's Desk</p>
      <h1>${esc(a.title)}</h1>
      ${a.dek ? `<p class="dek">${esc(a.dek)}</p>` : ''}
      ${published ? `<p class="muted"><time datetime="${esc(published)}">Published ${esc(new Date(a.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</time></p>` : ''}
      ${a.image_url ? `<img src="${esc(a.image_url)}" alt="${esc(a.image_alt || ('Illustration for ' + a.title))}" style="max-width:100%;height:auto;border-radius:12px;margin:16px 0;">` : ''}
      ${paragraphs(a.body)}
    </article>
    <p><a href="/desk.html">Back to Clay's Desk</a></p>
  </main>
</body>
</html>`;
}

function notFoundHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>That piece isn't here — Clay's Desk</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/css/kiln.css"></head>
<body><main id="main" tabindex="-1">
<h1>That piece isn't here</h1>
<p>It may have been taken down, or the address may be slightly off. Nothing is wrong with your account.</p>
<p><a href="/desk.html">See everything on Clay's Desk</a></p>
</main></body></html>`;
}

// GET /desk/:slug — one article, fully rendered.
router.get('/desk/:slug', asyncHandler(async (req, res) => {
  let a = null;
  try { a = await deskCompose.getPublishedBySlug(req.params.slug); } catch (_) { a = null; }
  if (!a) return res.status(404).type('html').send(notFoundHtml());
  res.set('Cache-Control', 'public, max-age=300');
  return res.type('html').send(articleHtml(a));
}));

// GET /sitemap.xml — generated, so every article Clay publishes is discoverable. Falls back to the
// static core pages if the database is unreachable; never throws.
router.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const site = SITE();
  const core = [
    { loc: `${site}/`, priority: '1.0' },
    { loc: `${site}/desk.html`, priority: '0.9' },
    { loc: `${site}/marketplace.html`, priority: '0.9' },
    { loc: `${site}/dreamhold.html`, priority: '0.9' },
    { loc: `${site}/sell.html`, priority: '0.8' },
  ];
  let articles = [];
  try { articles = await deskCompose.publishedSlugs(500); } catch (_) { articles = []; }

  const urls = core.map((c) => `  <url><loc>${esc(c.loc)}</loc><priority>${c.priority}</priority></url>`)
    .concat(articles.map((a) => {
      const lastmod = a.published_at ? new Date(a.published_at).toISOString().slice(0, 10) : null;
      return `  <url><loc>${esc(site + '/desk/' + a.slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>0.7</priority></url>`;
    }));

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}));

module.exports = router;
