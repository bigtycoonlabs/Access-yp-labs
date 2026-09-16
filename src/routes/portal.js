// THE CUSTOMER PORTAL: the owner's endpoints under /api/portal, and the customer's pages under /p.
//
// The customer's pages are rendered on the server and work with no JavaScript: plain forms, plain
// links, a status sentence at the top after every action. They are the pages most likely to be
// opened on an old phone by somebody who has never heard of us.
//
// Sessions are an httpOnly cookie scoped to that one portal's path, SameSite=Lax, so a form on
// another site cannot post as the customer.

const express = require('express');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const Po = require('../services/clay/portal');
const Cfg = require('../services/clay/portalConfig');

const api = express.Router();
const STATUS = { refused: 403, unclear: 422, unavailable: 502 };
function send(res, r, okCode = 200) {
  if (r.ok) return res.status(okCode).json(r);
  return res.status(STATUS[r.kind] || 400).json({ error: r.says, kind: r.kind });
}
const biz = (req) => {
  const b = String(req.query.business_id || (req.body || {}).business_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(b)) throw new ApiError(400, 'Which business?');
  return b;
};

api.get('/', authenticate, asyncHandler(async (req, res) => send(res, await Po.get(req.user, biz(req)))));
api.patch('/', authenticate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  send(res, await Po.customise(req.user, biz(req), { changes: b.changes, asked_for: b.asked_for }));
}));
api.post('/open', authenticate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  send(res, await Po.setOpen(req.user, biz(req), { open: b.open !== false, address: b.address }));
}));
api.get('/customers', authenticate, asyncHandler(async (req, res) => send(res, await Po.customers(req.user, biz(req)))));
api.post('/customers', authenticate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  send(res, await Po.addCustomer(req.user, biz(req), { name: b.name, email: b.email, invite: b.invite !== false }), 201);
}));
api.delete('/customers/:id', authenticate, asyncHandler(async (req, res) => send(res, await Po.removeCustomer(req.user, req.params.id))));
api.post('/customers/:id/invite', authenticate, asyncHandler(async (req, res) => send(res, await Po.invite(req.user, req.params.id))));
api.get('/customers/:id', authenticate, asyncHandler(async (req, res) => send(res, await Po.thread(req.user, req.params.id))));
api.post('/customers/:id/messages', authenticate, asyncHandler(async (req, res) => {
  send(res, await Po.reply(req.user, req.params.id, (req.body || {}).body), 201);
}));
api.post('/customers/:id/files', authenticate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  send(res, await Po.shareFile(req.user, req.params.id, b.file_id, b.share !== false));
}));
api.post('/customers/:id/items', authenticate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  send(res, await Po.addItem(req.user, req.params.id, { direction: b.direction, title: b.title,
    due_on: b.due_on, detail: b.detail }), 201);
}));

// ------------------------------------------------------------------ the customer's pages

const pages = express.Router();
const COOKIE = 'ypl_portal';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function cookie(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})'));
  return m ? m[1] : null;
}
function setCookie(res, slug, value, days) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', COOKIE + '=' + value + '; Path=/p/' + slug + '; HttpOnly; SameSite=Lax'
    + '; Max-Age=' + (days * 86400) + secure);
}
// A post must come from this site. SameSite already blocks the cookie; this blocks the attempt.
function sameOrigin(req) {
  const o = req.get('origin');
  if (!o) return true;
  try { return new URL(o).host === req.get('host'); } catch (_) { return false; }
}
function date(d) {
  return d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
}

function shell(portal, body, { status, title } = {}) {
  const accent = Cfg.ACCENTS[portal.config.accent] || Cfg.ACCENTS.violet;
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow">'
    + '<title>' + esc(title ? title + ', ' + portal.config.title : portal.config.title) + '</title>'
    + '<style>:root{--a:' + accent + '}*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,'
    + 'Segoe UI,sans-serif;color:#101A2E;background:#F8FAFC}header{background:var(--a);color:#fff;padding:16px 20px}'
    + 'header p{margin:0;font-weight:700;font-size:1.05rem}main{max-width:640px;margin:0 auto;padding:20px}'
    + 'h1{font-size:1.6rem;margin:8px 0 12px}h2{font-size:1.2rem;margin:0 0 10px}'
    + 'section{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:16px 18px;margin:0 0 16px}'
    + 'label{display:block;font-weight:600;margin:12px 0 6px}input,textarea{width:100%;min-height:44px;padding:10px 12px;'
    + 'font:inherit;border:1px solid #CBD5E1;border-radius:10px}textarea{min-height:110px}'
    + 'button,.btn{display:inline-block;min-height:44px;padding:10px 18px;margin-top:12px;border:0;border-radius:10px;'
    + 'background:var(--a);color:#fff;font:600 16px/24px inherit;text-decoration:none;cursor:pointer}'
    + '.quiet{background:transparent;color:var(--a);border:1px solid var(--a)}.status{background:#EEF2FF;border-left:4px solid var(--a);'
    + 'padding:12px 14px;border-radius:8px;margin:0 0 16px}.muted{color:#475569}ul{padding-left:20px}li{margin:0 0 8px}'
    + '.me{background:#F1F5F9}.msg{padding:10px 12px;border-radius:10px;margin:0 0 8px;border:1px solid #E2E8F0}'
    + 'a{color:var(--a)}footer{text-align:center;color:#475569;font-size:14px;padding:20px}</style></head><body>'
    + '<a href="#main" style="position:absolute;left:-9999px">Skip to your portal</a>'
    + '<header><p>' + esc(portal.business_name) + '</p></header><main id="main">'
    + (status ? '<p class="status" role="status">' + esc(status) + '</p>' : '<p role="status" style="margin:0"></p>')
    + body + '</main><footer>' + esc(portal.business_name) + ', powered by Access YP Labs.</footer></body></html>';
}

function page(res, code, html) {
  res.status(code).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    // same-origin, not no-referrer: with no-referrer the browser sends Origin: null on these pages'
    // own forms, and the same-site check then refuses every post. Walked 16 Sept 2026. Other sites
    // still receive no referrer.
    'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' }).send(html);
}

function closed(res) {
  page(res, 404, '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
    + 'content="width=device-width, initial-scale=1"><title>Portal not available</title></head><body '
    + 'style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5"><main><h1>This portal is not '
    + 'available</h1><p>It may be closed. Contact the business directly.</p></main></body></html>');
}

function signInPage(portal, status) {
  return shell(portal, '<h1>' + esc(portal.config.title) + '</h1>'
    + '<section><h2>Sign in</h2><p>Enter the email address ' + esc(portal.business_name)
    + ' has for you, and we will email you a link to sign in. No password needed.</p>'
    + '<form method="post" action="/p/' + esc(portal.slug) + '/link">'
    + '<label for="email">Your email address</label>'
    + '<input id="email" name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required>'
    + '<button type="submit">Email me a sign-in link</button></form></section>', { status, title: 'Sign in' });
}

function sectionHtml(sec, portal, view) {
  const slug = esc(portal.slug);
  const h = '<section aria-labelledby="s-' + sec.type + '"><h2 id="s-' + sec.type + '">' + esc(sec.title) + '</h2>';
  if (sec.type === 'welcome') {
    return h + portal.config.welcome.split(/\n+/).map((p) => '<p>' + esc(p) + '</p>').join('') + '</section>';
  }
  if (sec.type === 'owed') {
    const li = (i) => '<li>' + esc(i.title) + (i.due_at ? ', by ' + esc(date(i.due_at)) : '')
      + (i.detail ? '. ' + esc(i.detail) : '') + '</li>';
    if (!view.they_owe.length && !view.we_owe.length) return h + '<p>Nothing is open between us right now.</p></section>';
    return h + (view.they_owe.length ? '<h3>What you owe us</h3><ul>' + view.they_owe.map(li).join('') + '</ul>' : '')
      + (view.we_owe.length ? '<h3>What we owe you</h3><ul>' + view.we_owe.map(li).join('') + '</ul>' : '')
      + '</section>';
  }
  if (sec.type === 'files') {
    if (!view.files.length) return h + '<p>No files have been shared with you yet.</p></section>';
    return h + '<ul>' + view.files.map((f) => '<li><a href="/p/' + slug + '/file/' + esc(f.id) + '">'
      + esc(f.name) + '</a>' + (f.description ? '. ' + esc(f.description) : '') + '</li>').join('') + '</ul></section>';
  }
  if (sec.type === 'messages') {
    const msgs = view.messages.length ? view.messages.map((m) => '<div class="msg' + (m.from_customer ? ' me' : '') + '"><p style="margin:0 0 4px"><strong>'
      + (m.from_customer ? 'You' : esc(portal.business_name)) + '</strong>, ' + esc(date(m.created_at)) + '</p><p style="margin:0;white-space:pre-wrap">'
      + esc(m.body) + '</p></div>').join('') : '<p>No messages yet.</p>';
    return h + msgs + '<form method="post" action="/p/' + slug + '/message"><label for="body">Write to '
      + esc(portal.business_name) + '</label><textarea id="body" name="body" required maxlength="5000"></textarea>'
      + '<button type="submit">Send</button></form></section>';
  }
  if (sec.type === 'request') {
    const r = portal.config.request;
    const type = { email: 'email', phone: 'tel', date: 'date', number: 'number', text: 'text' };
    return h + '<p>' + esc(r.intro) + '</p><form method="post" action="/p/' + slug + '/request">'
      + r.fields.map((f, i) => '<label for="f' + i + '">' + esc(f.label) + (f.required ? '' : ' (optional)') + '</label>'
        + (f.kind === 'long_text'
          ? '<textarea id="f' + i + '" name="f' + i + '"' + (f.required ? ' required' : '') + ' maxlength="2000"></textarea>'
          : '<input id="f' + i + '" name="f' + i + '" type="' + type[f.kind] + '"' + (f.required ? ' required' : '')
            + (f.kind === 'email' ? ' autocapitalize="none" spellcheck="false" autocomplete="email"' : '') + '>')).join('')
      + '<button type="submit">Send the request</button></form></section>';
  }
  if (sec.type === 'links') {
    if (!portal.config.links.length) return '';
    return h + '<ul>' + portal.config.links.map((l) => '<li><a href="' + esc(l.url) + '" rel="noopener">'
      + esc(l.label) + '</a></li>').join('') + '</ul></section>';
  }
  return '';
}

async function portalPage(portal, customer, status) {
  const view = await Po.customerView(customer);
  const body = '<h1>' + esc(portal.config.title) + '</h1><p class="muted">Signed in as ' + esc(customer.name) + '.</p>'
    + portal.config.sections.filter((s) => s.on).map((s) => sectionHtml(s, portal, view)).join('')
    + '<form method="post" action="/p/' + esc(portal.slug) + '/out"><button type="submit" class="quiet btn">Sign out</button></form>';
  return shell(portal, body, { status });
}

// Status lines are fixed sentences chosen by code. Free text in the address would let anyone send a
// customer a link to the real portal saying something the business never said.
const NOTES = {
  link: 'If that address belongs to a customer here, a sign-in link is on its way. It works for '
    + Po.LINK_MINUTES + ' minutes.',
  in: 'You are signed in.',
  bad: 'That sign-in link has expired or was already used. Ask for a new one below.',
  first: 'Please sign in first.',
  sent: 'Sent. We will reply here.',
  asked: 'Your request is sent. We will get back to you.',
  missing: 'Please fill in every field that is not marked optional.',
  empty: 'Write something before sending.',
  slow: 'You have sent a lot of messages in the last hour. Please wait a little.',
  off: 'That part of the portal is switched off.',
  out: 'You are signed out.',
};
const go = (res, slug, code, hash) => res.redirect(303, '/p/' + encodeURIComponent(slug) + '?n=' + code + (hash || ''));

pages.get('/:slug', asyncHandler(async (req, res) => {
  const { portal, customer } = await Po.whoIs(req.params.slug, cookie(req));
  if (!portal) return closed(res);
  const note = NOTES[String(req.query.n || '')] || null;
  if (!customer) return page(res, 200, signInPage(portal, note));
  page(res, 200, await portalPage(portal, customer, note));
}));

pages.post('/:slug/link', express.urlencoded({ extended: false, limit: '4kb' }), asyncHandler(async (req, res) => {
  if (!sameOrigin(req)) return res.status(403).send('Forbidden');
  const r = await Po.requestLink(req.params.slug, (req.body || {}).email);
  if (!r.ok) return closed(res);
  go(res, req.params.slug, 'link');
}));

pages.get('/:slug/in', asyncHandler(async (req, res) => {
  const r = await Po.consumeLink(req.params.slug, req.query.t);
  if (!r.ok) return go(res, req.params.slug, 'bad');
  setCookie(res, req.params.slug.toLowerCase(), r.session, r.days);
  go(res, req.params.slug, 'in');
}));

async function asCustomer(req, res) {
  if (!sameOrigin(req)) { res.status(403).send('Forbidden'); return null; }
  const who = await Po.whoIs(req.params.slug, cookie(req));
  if (!who.portal) { closed(res); return null; }
  if (!who.customer) {
    go(res, req.params.slug, 'first');
    return null;
  }
  return who;
}

pages.post('/:slug/message', express.urlencoded({ extended: false, limit: '16kb' }), asyncHandler(async (req, res) => {
  const who = await asCustomer(req, res); if (!who) return;
  const on = who.portal.config.sections.find((s) => s.type === 'messages' && s.on);
  const r = on ? await Po.fromCustomer(who.customer, who.portal, { body: (req.body || {}).body })
    : { code: 'off' };
  go(res, req.params.slug, r.code || 'sent', '#s-messages');
}));

pages.post('/:slug/request', express.urlencoded({ extended: false, limit: '32kb' }), asyncHandler(async (req, res) => {
  const who = await asCustomer(req, res); if (!who) return;
  const on = who.portal.config.sections.find((s) => s.type === 'request' && s.on);
  let r = { code: 'off' };
  if (on) {
    const fields = {};
    who.portal.config.request.fields.forEach((f, i) => { fields[f.label] = (req.body || {})['f' + i]; });
    r = await Po.fromCustomer(who.customer, who.portal, { fields });
  }
  go(res, req.params.slug, r.code || 'asked', '#s-request');
}));

pages.get('/:slug/file/:fileId', asyncHandler(async (req, res) => {
  const who = await Po.whoIs(req.params.slug, cookie(req));
  if (!who.portal) return closed(res);
  if (!who.customer) return go(res, req.params.slug, 'first');
  const on = who.portal.config.sections.find((s) => s.type === 'files' && s.on);
  const f = on ? await Po.customerFile(who.customer, req.params.fileId) : null;
  if (!f) return page(res, 404, shell(who.portal, '<h1>File not available</h1><p><a href="/p/' + esc(who.portal.slug) + '">Back to your portal</a></p>'));
  const ascii = f.name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.status(200).set({
    'Content-Type': f.mime,
    'Content-Disposition': (f.kind === 'photo' ? 'inline' : 'attachment') + '; filename="' + ascii
      + '"; filename*=UTF-8\'\'' + encodeURIComponent(f.name),
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
  }).send(f.data);
}));

pages.post('/:slug/out', asyncHandler(async (req, res) => {
  if (!sameOrigin(req)) return res.status(403).send('Forbidden');
  await Po.signOut(cookie(req));
  setCookie(res, req.params.slug.toLowerCase(), '', 0);
  go(res, req.params.slug, 'out');
}));

module.exports = { api, pages };
