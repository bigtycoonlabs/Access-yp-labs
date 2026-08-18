const express = require('express');
const { asyncHandler } = require('../lib/http');
const deskCompose = require('../services/clay/deskCompose');
const deskSeo = require('../services/clay/deskSeo');

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
    <a href="/marketplace.html">The Exchange</a>
    <a href="/seats.html">Help build</a>
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

// A plain page in the Desk's own styling. Written here rather than borrowed from another router,
// because a shared helper that only exists in one file is exactly how a page 500s in production.
// canonical MUST be the page's own address. I first wrote this with every page declaring /desk as
// its canonical, which tells a search engine these subject pages are duplicates of the Desk and
// should be dropped from the index — the exact opposite of why they were built. A canonical pointing
// somewhere else is not a small mistake: it is an instruction to ignore the page.
function deskPage(title, description, bodyHtml, { noindex = false, canonical = null } = {}) {
  const site = SITE();
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || '')}"/>
${noindex ? '<meta name="robots" content="noindex, nofollow"/>' : (canonical ? `<link rel="canonical" href="${esc(canonical)}"/>` : '')}
<link rel="stylesheet" href="/css/kiln.css"/>
</head><body>
<a class="skip" href="#main">Skip to main content</a>
<header class="site"><div class="wrap bar"><a class="brand" href="/">Access YP Labs</a>
<nav class="top" aria-label="Primary"><a href="/desk">The Desk</a><a href="/weekly">Clay Weekly</a><a href="/marketplace.html">The Exchange</a><a href="/seats.html">Help build</a></nav>
</div></header>
<main id="main" class="wrap">${bodyHtml}</main>
<footer class="site"><div class="wrap"><nav aria-label="Legal">
<a href="/terms.html">Terms of Service</a> · <a href="/privacy.html">Privacy Policy</a> · <a href="/risk.html">Risk Disclosure</a>
</nav></div></footer>
</body></html>`;
}

// GET /white-paper — why this platform exists, in full.
//
// Served from the markdown in docs/ rather than a second copy pasted into a page, so there is ONE
// white paper. A duplicate would drift, and the version a reader saw would eventually stop matching
// the version we edit.
let WHITE_PAPER_CACHE = null;
function whitePaperHtml() {
  if (WHITE_PAPER_CACHE) return WHITE_PAPER_CACHE;
  const fsMod = require('fs');
  const pathMod = require('path');
  let md = '';
  try {
    md = fsMod.readFileSync(pathMod.join(__dirname, '..', '..', 'docs', 'WHITEPAPER-YP-Labs.md'), 'utf8');
  } catch (_) { return null; }

  // A deliberately small markdown reader: headings, bullets, bold, italics, paragraphs. Enough for
  // this document and nothing more — a full parser would be a dependency and an attack surface for
  // one file we write ourselves.
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^---+$/.test(line.trim())) { if (inList) { out.push('</ul>'); inList = false; } continue; }
    if (/^- /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (/^### /.test(line)) { out.push(`<p class="muted">${inline(line.slice(4))}</p>`); continue; }
    if (/^## /.test(line))  { out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
    if (/^# /.test(line))   { out.push(`<h1>${inline(line.slice(2))}</h1>`); continue; }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  WHITE_PAPER_CACHE = out.join('\n      ');
  return WHITE_PAPER_CACHE;
}

router.get('/white-paper', asyncHandler(async (req, res) => {
  const html = whitePaperHtml();
  if (!html) {
    return res.status(404).type('html').send(deskPage('Not found', '', '<h1>Not found</h1>', { noindex: true }));
  }
  res.set('Cache-Control', 'public, max-age=1800');
  res.type('html').send(deskPage(
    'Why we built Access YP Labs — a white paper',
    'Why Access YP Labs exists, what it costs, how everyone involved makes money, and the one line we never cross.',
    html, { canonical: `${SITE()}/white-paper` }));
}));

// GET /desk/topic/:category — browse the Desk by subject.
//
// The Desk had 32 pieces and no way through them but reverse-chronological. Someone who arrives on
// a pricing article from a search has no way to find the other pricing pieces, which is the moment
// they are most likely to stay.
router.get('/desk/topic/:category', asyncHandler(async (req, res) => {
  const cat = String(req.params.category || '');
  if (!deskSeo.isCategory(cat)) {
    return res.status(404).type('html').send(deskPage('No such subject', '', `
      <h1>No such subject</h1>
      <p>That is not one of the Desk's subjects.</p>
      <p><a href="/desk">Back to the Desk</a></p>`, { noindex: true }));
  }
  const meta = deskSeo.CATEGORIES.find((c) => c.slug === cat);
  let list = [];
  try { list = await deskSeo.byCategory(cat, 40); } catch (_) { list = []; }
  const items = list.length
    ? list.map((a) => `<li><a href="/desk/${a.slug}">${esc(a.title)}</a>${a.dek ? ' — ' + esc(a.dek) : ''}</li>`).join('\n')
    : '<li>Nothing here yet. Clay is still writing on this one.</li>';
  const body = `<h1>${esc(meta.label)}</h1>
    <p>${esc(meta.blurb)}</p>
    <nav aria-label="Desk subjects"><p>${deskSeo.CATEGORIES.map((c) =>
      c.slug === cat ? `<strong>${esc(c.label)}</strong>` : `<a href="/desk/topic/${c.slug}">${esc(c.label)}</a>`
    ).join(' · ')}</p></nav>
    <ul>${items}</ul>
    <p><a href="/desk">All of the Desk</a></p>`;
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(deskPage(`${meta.label} — Clay's Desk`, meta.blurb, body, { canonical: `${SITE()}/desk/topic/${cat}` }));
}));

// GET /sitemap.xml — generated, so every article Clay publishes is discoverable. Falls back to the
// static core pages if the database is unreachable; never throws.
router.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const site = SITE();
  const core = [
    { loc: `${site}/`, priority: '1.0' },
    { loc: `${site}/desk.html`, priority: '0.9' },
    { loc: `${site}/marketplace.html`, priority: '0.9' },
    // The way in for somebody who has a skill and no idea of their own, which is most people.
    { loc: `${site}/seats.html`, priority: '0.9' },
    { loc: `${site}/dreamhold.html`, priority: '0.9' },
    { loc: `${site}/sell.html`, priority: '0.8' },
  ];
  let articles = [];
  try { articles = await deskCompose.publishedSlugs(500); } catch (_) { articles = []; }
  // Clay Weekly issues are public pages too — they belong in the sitemap or nothing Clay writes
  // for the magazine can be found. Required lazily so a failure here can never break the Desk.
  let issues = [];
  try { issues = await require('../services/clay/weekly').listPublished(200); } catch (_) { issues = []; }

  // Subject pages belong here too: they are real destinations, and they are what a search engine
  // uses to understand that the Desk is about something rather than being a pile of posts. Nothing
  // here is cached — the sitemap is generated on request, so anything Clay publishes, and every
  // Clay Weekly issue that goes live, appears the moment it does.
  const topics = deskSeo.CATEGORIES.map((c) => ({ loc: `${site}/desk/topic/${c.slug}`, priority: '0.7' }));

  // THE THINGS WE ACTUALLY SELL. The sitemap listed every Desk article and not one live listing, so
  // the part of the platform that gives things away was fully indexed and the part that is the
  // business was invisible. Priority above the topic pages because a project for sale is the point.
  let listings = [];
  try {
    const r = await require('../config/db').query(
      `SELECT l.id, l.updated_at FROM listings l WHERE l.status='live' ORDER BY l.created_at DESC LIMIT 500`);
    listings = r.rows.map((x) => ({ loc: `${site}/market/${x.id}`, priority: '0.8' }));
  } catch (_) { listings = []; }

  const urls = core.concat([{ loc: `${site}/weekly`, priority: '0.8' }]).concat(topics).concat(listings)
    .map((c) => `  <url><loc>${esc(c.loc)}</loc><priority>${c.priority}</priority></url>`)
    .concat(issues.map((i) => {
      const lastmod = i.published_at ? new Date(i.published_at).toISOString().slice(0, 10) : null;
      return `  <url><loc>${esc(site + '/weekly/' + i.slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>0.7</priority></url>`;
    }))
    .concat(articles.map((a) => {
      const lastmod = a.published_at ? new Date(a.published_at).toISOString().slice(0, 10) : null;
      return `  <url><loc>${esc(site + '/desk/' + a.slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>0.7</priority></url>`;
    }));

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}));

module.exports = router;
