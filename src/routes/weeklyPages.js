const express = require('express');
const { asyncHandler } = require('../lib/http');
const weekly = require('../services/clay/weekly');

// PUBLIC pages for Clay Weekly, rendered on the SERVER so search engines and link previews get real
// HTML (the same reason the Desk articles are rendered this way), and so a screen reader gets a
// clean document with real headings instead of a page that assembles itself afterwards.
//
// Also here: the two one-click actions that arrive by email — a creator accepting or declining the
// sponsored slot, and anyone leaving the mailing list. Both work from a plain link with no sign-in,
// because that is what makes them honest: leaving must never be harder than arriving.

const router = express.Router();
const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function paras(text) {
  return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`).join('\n      ');
}
function money(cents) { return '$' + ((Number(cents) || 0) / 100).toFixed(2); }

function shell(title, body, opts = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${opts.description ? `<meta name="description" content="${esc(opts.description)}">` : ''}
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : ''}
${opts.noindex ? '<meta name="robots" content="noindex">' : ''}
${opts.head || ''}
<link rel="stylesheet" href="/css/kiln.css"></head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<nav class="top" aria-label="Primary">
  <a href="/">Access YP Labs</a>
  <a href="/weekly">Clay Weekly</a>
  <a href="/desk.html">Clay's Desk</a>
  <a href="/dreamhold.html">Dream Market</a>
  <a href="/movers.html">Become a Dream Mover</a>
</nav>
<main id="main" tabindex="-1" class="wrap">
${body}
</main>
</body></html>`;
}

function issueHtml(issue) {
  const url = `${SITE()}/weekly/${issue.slug}`;
  const h = issue.highlights || {};
  const creators = Array.isArray(h.creators) ? h.creators : [];
  const movers = Array.isArray(h.movers) ? h.movers : [];
  const when = issue.published_at ? new Date(issue.published_at) : null;

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: issue.title,
    description: (issue.intro || '').slice(0, 200) || undefined,
    datePublished: when ? when.toISOString() : undefined,
    author: { '@type': 'Person', name: 'Clay' },
    publisher: { '@type': 'Organization', name: 'Access YP Labs', url: SITE() },
    mainEntityOfPage: url,
  };

  const body = `
    <article>
      <p class="muted">Clay Weekly</p>
      <h1>${esc(issue.title)}</h1>
      ${when ? `<p class="muted"><time datetime="${when.toISOString()}">${esc(when.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}</time></p>` : ''}
      ${paras(issue.intro)}

      ${issue.sponsored_title ? `
      <section aria-labelledby="sponsored-h">
        <h2 id="sponsored-h">Project of the Week</h2>
        <p><strong>${esc(issue.sponsored_title)}</strong> — featured with the creator's permission.</p>
        ${paras(issue.sponsored_blurb || issue.sponsored_brief)}
      </section>` : ''}

      ${(issue.articles && issue.articles.length) ? `
      <section aria-labelledby="reads-h">
        <h2 id="reads-h">This week from Clay's Desk</h2>
        <ul>
          ${issue.articles.map((a) => `<li><a href="/desk/${encodeURIComponent(a.slug)}">${esc(a.title)}</a>${a.dek ? ' — ' + esc(a.dek) : ''}</li>`).join('\n          ')}
        </ul>
      </section>` : ''}

      ${creators.length ? `
      <section aria-labelledby="creators-h">
        <h2 id="creators-h">Creators who shipped</h2>
        <ul>
          ${creators.map((c) => `<li>${esc(c.name)} — ${c.listings} ${c.listings === 1 ? 'project' : 'projects'} into the Dream Market</li>`).join('\n          ')}
        </ul>
      </section>` : ''}

      ${movers.length ? `
      <section aria-labelledby="movers-h">
        <h2 id="movers-h">Dream Movers who earned</h2>
        <ul>
          ${movers.map((m) => `<li>${esc(m.name)} — ${esc(money(m.earned_cents))} from ${m.sales} ${m.sales === 1 ? 'sale' : 'sales'}</li>`).join('\n          ')}
        </ul>
      </section>` : ''}

      ${issue.clays_note ? `
      <section aria-labelledby="note-h">
        <h2 id="note-h">Clay's Note</h2>
        ${paras(issue.clays_note)}
      </section>` : ''}

      <section aria-labelledby="join-h">
        <h2 id="join-h">Want in?</h2>
        <p><a href="/register.html">Shape your own idea with Clay</a> — free. Or <a href="/dreamhold.html">claim a business someone already proved</a>. Or <a href="/movers.html">become a Dream Mover</a> and earn on what you promote.</p>
      </section>
    </article>
    <p><a href="/weekly">Every issue of Clay Weekly</a></p>`;

  return shell(`${issue.title} — Clay Weekly`, body, {
    description: (issue.intro || '').slice(0, 155),
    canonical: url,
    head: `<meta property="og:type" content="article">
<meta property="og:title" content="${esc(issue.title)}">
<meta property="og:description" content="${esc((issue.intro || '').slice(0, 155))}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  });
}

// GET /weekly — every published issue.
router.get('/weekly', asyncHandler(async (req, res) => {
  let issues = [];
  try { issues = await weekly.listPublished(20); } catch (_) { issues = []; }
  const body = `
    <h1>Clay Weekly</h1>
    <p>The magazine of Access YP Labs — written by Clay. The sponsored project of the week, what he wrote, who shipped, who earned, and a note from him.</p>
    ${issues.length ? `<ul>${issues.map((i) => `<li><a href="/weekly/${encodeURIComponent(i.slug)}">${esc(i.title)}</a></li>`).join('')}</ul>`
      : '<p>The first issue is on its way.</p>'}
    <p><a href="/register.html">Get it by email — create a free account</a>.</p>`;
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(shell('Clay Weekly — Access YP Labs', body, {
    description: 'The weekly magazine of Access YP Labs, written by Clay.',
    canonical: `${SITE()}/weekly`,
  }));
}));

// GET /weekly/sponsor/:token/(accept|decline) — a creator answering from their email.
router.get('/weekly/sponsor/:token/:decision', asyncHandler(async (req, res) => {
  const accept = req.params.decision === 'accept';
  if (!['accept', 'decline'].includes(req.params.decision)) {
    return res.status(404).type('html').send(shell('Not found', '<h1>Not found</h1>', { noindex: true }));
  }
  const out = await weekly.respondToSponsorship(req.params.token, accept);
  const body = out
    ? (accept
      ? `<h1>Thank you — you're in</h1><p>Your project will be the sponsored Project of the Week in the next issue of Clay Weekly. Clay writes the piece; nothing is charged, and nothing else is needed from you.</p><p><a href="/weekly">See Clay Weekly</a></p>`
      : `<h1>No problem at all</h1><p>Your project will not be featured, and Clay won't ask again about this one. Nothing changed on your account.</p><p><a href="/dashboard.html">Back to your Laboratory</a></p>`)
    : `<h1>That link has already been used</h1><p>It may have been answered already, or it may have expired. Nothing was changed. If you're not sure what happened, just ask Clay.</p>`;
  res.type('html').send(shell(accept ? 'Featured in Clay Weekly' : 'Declined', body, { noindex: true }));
}));

// GET /weekly/unsubscribe/:token — leaving must be one click, no sign-in.
router.get('/weekly/unsubscribe/:token', asyncHandler(async (req, res) => {
  const ok = await weekly.unsubscribe(req.params.token);
  const body = ok
    ? `<h1>You're unsubscribed</h1><p>You won't get Clay Weekly again. You'll still get the important account emails — receipts and security messages — because those aren't marketing.</p><p><a href="/">Back to Access YP Labs</a></p>`
    : `<h1>That link didn't work</h1><p>It may already have been used. If you're still getting the magazine, reply to any issue and we'll take you off by hand.</p>`;
  res.type('html').send(shell('Clay Weekly — unsubscribe', body, { noindex: true }));
}));

// POST version for mail clients that honor one-click unsubscribe headers.
router.post('/weekly/unsubscribe/:token', asyncHandler(async (req, res) => {
  await weekly.unsubscribe(req.params.token);
  res.status(200).send('unsubscribed');
}));

// GET /weekly/:slug — one issue.
router.get('/weekly/:slug', asyncHandler(async (req, res) => {
  let issue = null;
  try { issue = await weekly.getPublished(req.params.slug); } catch (_) { issue = null; }
  if (!issue) {
    return res.status(404).type('html').send(shell("That issue isn't here", `
      <h1>That issue isn't here</h1>
      <p>It may not be published yet, or the address may be slightly off.</p>
      <p><a href="/weekly">See every issue of Clay Weekly</a></p>`, { noindex: true }));
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(issueHtml(issue));
}));

module.exports = router;
