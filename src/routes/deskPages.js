const express = require('express');
const { asyncHandler } = require('../lib/http');
const deskCompose = require('../services/clay/deskCompose');
const deskSeo = require('../services/clay/deskSeo');

// Server-rendered PAGES for The Desk pieces.
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
// A DESK ARTICLE IS WRITTEN IN MARKDOWN, so it is read as markdown.
//
// Until 18 September 2026 every article was rendered as plain paragraphs: headings appeared as
// "## What it costs", bullet lists ran together, and a linked government source showed as raw
// brackets in the middle of a sentence. The sourced articles are the whole point of the Desk, and
// their sources were unreadable and unclickable.
//
// Deliberately small: headings, bullets, numbered points, bold, italics and links. Only http and
// https links are made clickable, and everything is escaped first, so an article can never inject
// markup or a javascript: url.
function paragraphs(body) {
  const inline = (t) => esc(t)
    .replace(/\[([^\]]{1,120})\]\((https?:\/\/[^\s)]{1,300})\)/g,
      (m, text, href) => `<a href="${href}" rel="nofollow noopener">${text}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  const out = [];
  let list = null;                       // 'ul' or 'ol' while one is open
  let table = null;                      // a pipe table being gathered
  const renderTable = (t) => '<table><thead><tr>'
    + t.head.map((h) => `<th scope="col">${inline(h)}</th>`).join('')
    + '</tr></thead><tbody>'
    + t.rows.map((r) => '<tr>' + r.map((c, i) => (i === 0
      ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('') + '</tr>').join('')
    + '</tbody></table>';
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); if (table) { out.push(renderTable(table)); table = null; } continue; }
    // A PIPE TABLE. Prices and comparisons are read as tables by people and by search engines, and
    // without this they arrived as a paragraph full of vertical bars (18 Sept 2026). The second row
    // of dashes is the header separator and is not printed.
    if (/^\|.*\|$/.test(line)) {
      closeList();
      const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (!table) {
        table = { head: cells(line), rows: [], sawRule: false };
        continue;
      }
      if (!table.sawRule && /^\|[\s|:-]+\|$/.test(line)) { table.sawRule = true; continue; }
      table.rows.push(cells(line));
      continue;
    }
    if (table) { out.push(renderTable(table)); table = null; }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (numbered) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    if (/^####\s+/.test(line)) { out.push(`<h4>${inline(line.replace(/^####\s+/, ''))}</h4>`); continue; }
    if (/^###\s+/.test(line))  { out.push(`<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`); continue; }
    if (/^##\s+/.test(line))   { out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`); continue; }
    // A single # would be a second h1 on a page that already has the title as its h1.
    if (/^#\s+/.test(line))    { out.push(`<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (table) out.push(renderTable(table));
  return out.join('\n      ');
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
    author: { '@type': 'Organization', name: 'Access YP Labs', url: `${SITE()}/desk.html` },
    publisher: { '@type': 'Organization', name: 'Access YP Labs', url: SITE() },
    mainEntityOfPage: url,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(a.title)} — The Desk, Access YP Labs</title>
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
    <a href="/desk.html">The Desk</a>
    <a href="/plans.html">Plans</a>
  </nav>
  <main id="main" tabindex="-1">
    <article>
      <p class="muted">${esc(kindLabel)} from The Desk</p>
      <h1>${esc(a.title)}</h1>
      ${a.dek ? `<p class="dek">${esc(a.dek)}</p>` : ''}
      ${published ? `<p class="muted"><time datetime="${esc(published)}">Published ${esc(new Date(a.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</time></p>` : ''}
      ${a.image_url ? `<img src="${esc(a.image_url)}" alt="${esc(a.image_alt || ('Illustration for ' + a.title))}" style="max-width:100%;height:auto;border-radius:12px;margin:16px 0;">` : ''}
      ${paragraphs(a.body)}
    </article>
    <p><a href="/desk.html">Back to The Desk</a></p>
  </main>
</body>
</html>`;
}

function notFoundHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>That piece isn't here — The Desk</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/css/kiln.css"></head>
<body><main id="main" tabindex="-1">
<h1>That piece isn't here</h1>
<p>It may have been taken down, or the address may be slightly off. Nothing is wrong with your account.</p>
<p><a href="/desk.html">See everything on The Desk</a></p>
</main></body></html>`;
}

// GET /desk/:slug — one article, fully rendered.
// GET /desk/all — every article, rendered by the server.
//
// Declared ABOVE /desk/:slug on purpose: that route matches 'all' as an article slug, so registering
// this one lower returned the Desk's own not-found page for the entire library.
//
// The Desk's front page draws its list with JavaScript. A person is fine; a crawler that does not run
// scripts sees an empty page, which is the whole library invisible to the thing we are writing it for
// (18 Sept 2026). Subject pages were already server-rendered; this is the index of everything.
router.get('/desk/all', asyncHandler(async (req, res) => {
  const bySubject = [];
  for (const c of deskSeo.CATEGORIES) {
    let list = [];
    try { list = await deskSeo.byCategory(c.slug, 60); } catch (_) { list = []; }
    if (list.length) bySubject.push({ c, list });
  }
  const body = `<h1>Everything on the Desk</h1>
    <p>Every article, by subject. Written by Penny, with the sources she used.</p>
    ${bySubject.length ? bySubject.map(({ c, list }) => `<h2><a href="/desk/topic/${c.slug}">${esc(c.label)}</a></h2>
      <p>${esc(c.blurb)}</p>
      <ul>${list.map((a) => `<li><a href="/desk/${a.slug}">${esc(a.title)}</a>${a.dek ? ' — ' + esc(a.dek) : ''}</li>`).join('')}</ul>`).join('\n    ')
      : '<p>Nothing is published yet.</p>'}
    <p><a href="/desk">Back to the Desk</a></p>`;
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(deskPage('Everything on the Desk', 'Every article on the Desk, by subject.', body,
    { canonical: `${SITE()}/desk/all` }));
}));

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
<nav class="top" aria-label="Primary"><a href="/">Home</a><a href="/desk">The Desk</a><a href="/plans.html">Plans</a></nav>
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
    : '<li>Nothing here yet. Penny is still writing on this one.</li>';
  const body = `<h1>${esc(meta.label)}</h1>
    <p>${esc(meta.blurb)}</p>
    <nav aria-label="Desk subjects"><p>${deskSeo.CATEGORIES.map((c) =>
      c.slug === cat ? `<strong>${esc(c.label)}</strong>` : `<a href="/desk/topic/${c.slug}">${esc(c.label)}</a>`
    ).join(' · ')}</p></nav>
    <ul>${items}</ul>
    <p><a href="/desk">All of the Desk</a></p>`;
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(deskPage(`${meta.label} — The Desk`, meta.blurb, body, { canonical: `${SITE()}/desk/topic/${cat}` }));
}));

// GET /sitemap.xml — generated, so every article Clay publishes is discoverable. Falls back to the
// static core pages if the database is unreachable; never throws.
router.get('/sitemap.xml', asyncHandler(async (req, res) => {
  const site = SITE();
  // The platform as it is now (16 Sept 2026). The marketplace, listings and the weekly magazine are retired
  // and their addresses redirect, so none of them is listed.
  const core = [
    { loc: `${site}/`, priority: '1.0' },
    { loc: `${site}/plans.html`, priority: '0.9' },
    { loc: `${site}/desk.html`, priority: '0.8' },
    { loc: `${site}/desk/all`, priority: '0.8' },
    { loc: `${site}/register.html`, priority: '0.6' },
    { loc: `${site}/values.html`, priority: '0.6' },
    { loc: `${site}/terms.html`, priority: '0.3' },
    { loc: `${site}/privacy.html`, priority: '0.3' },
  ];
  let articles = [];
  try { articles = await deskCompose.publishedSlugs(500); } catch (_) { articles = []; }
  // Subject pages are real destinations and tell a search engine what the Desk is about.
  const topics = deskSeo.CATEGORIES.map((c) => ({ loc: `${site}/desk/topic/${c.slug}`, priority: '0.7' }));

  const urls = core.concat(topics)
    .map((c) => `  <url><loc>${esc(c.loc)}</loc><priority>${c.priority}</priority></url>`)
    .concat(articles.map((a) => {
      const lastmod = a.published_at ? new Date(a.published_at).toISOString().slice(0, 10) : null;
      return `  <url><loc>${esc(site + '/desk/' + a.slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>0.7</priority></url>`;
    }));

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}));

module.exports = router;
