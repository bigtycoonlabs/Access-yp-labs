// SITES HOSTED ON ACCESS YP LABS, AT /s/<address>.
//
// The page is the client's, written by Penny, so it runs the way previews do: in a CSP sandbox with an
// opaque origin, unable to read anyone's session here. Two things are added to every page:
//   window.labsSend, the one way its forms can send anything, and only to this site's own inbox
//   a footer naming the business, with a way to report the page, because a page on our domain that
//   nobody can report is how a domain ends up hosting a scam
//
// A message sent from a form is kept, emailed to the owner, and raised as a reply on their Today.

const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/db');
const { sendEmail } = require('../services/email');

const router = express.Router();
const MAX_FIELDS = 30;
const MAX_VALUE = 2000;
const FLOOD_PER_HOUR = 5;

function origin(req) {
  const host = req.get('host');
  return (req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http') + '://' + host;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function notFound(res) {
  return res.status(404).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    .send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
      + 'content="width=device-width, initial-scale=1"><title>Not found</title></head><body '
      + 'style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5"><main><h1>There is no '
      + 'site at this address</h1><p>It may have been taken offline by its owner.</p></main></body></html>');
}

function addOns(slug, businessName, sendUrl, portalUrl) {
  const script = '<script>(function(){var u=' + JSON.stringify(sendUrl) + ';'
    + 'window.labsSend=async function(fields){try{var r=await fetch(u,{method:"POST",'
    + 'headers:{"Content-Type":"text/plain"},body:JSON.stringify({fields:fields||{}})});'
    + 'var d={};try{d=await r.json()}catch(e){}'
    + 'return {ok:r.ok&&d.ok===true,says:d.says||(r.ok?"Sent.":"That did not send. Please try again.")};'
    + '}catch(e){return {ok:false,says:"That did not send, because the connection failed. Please try again."}}};'
    + '})();</script>';
  const footer = '<footer style="font:14px/1.5 system-ui,sans-serif;padding:16px;text-align:center;'
    + 'color:#475569;border-top:1px solid #e2e8f0;margin-top:24px">'
    + (portalUrl ? '<p style="margin:0 0 8px"><a style="color:#475569;font-weight:600" href="' + esc(portalUrl)
      + '" target="_top">Customer sign in</a></p>' : '') + esc(businessName)
    + ', made with Access YP Labs. <a style="color:#475569" href="mailto:success@accessyourplace.com'
    + '?subject=' + encodeURIComponent('Report a site: ' + slug) + '">Report this page</a></footer>';
  return { script, footer };
}

router.get('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{1,63}$/.test(slug)) return notFound(res);
  let row;
  try {
    row = (await query(
      `SELECT b.id, b.business_id, p.html, bz.name AS business_name
         FROM builds b JOIN build_pages p ON p.build_id=b.id
         JOIN businesses bz ON bz.id=b.business_id
        WHERE b.published_slug=$1`, [slug])).rows[0];
  } catch (e) {
    return res.status(502).type('text/plain').send('This site could not be loaded just now. Please try again in a minute.');
  }
  if (!row) return notFound(res);
  const here = origin(req);
  let portalSlug = null;
  try {
    portalSlug = ((await query('SELECT slug FROM portals WHERE business_id=$1 AND is_open', [row.business_id])).rows[0] || {}).slug;
  } catch (_) { /* the site still opens without the portal link */ }
  const { script, footer } = addOns(slug, row.business_name, here + '/s/' + slug + '/send',
    portalSlug ? here + '/p/' + portalSlug : null);
  let html = row.html;
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, script + '</head>') : script + html;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, footer + '</body>') : html + footer;
  // Cloudflare rewrites every email address into a link that needs its own script to decode, and the
  // sandbox blocks that script, so the client's email and our report link would both break. Walked
  // on production 16 Sept 2026. Its documented opt-out is these markers around the content. They go
  // inside body, never before the doctype, which would switch the page into quirks mode.
  html = html.replace(/<body([^>]*)>/i, '<body$1><!--email_off-->')
    .replace(/<\/body>(?![\s\S]*<\/body>)/i, '<!--/email_off--></body>');
  res.status(200).set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': [
      'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox',
      "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
      'img-src data: blob:', 'font-src data:', 'connect-src ' + here, "form-action 'none'",
      "base-uri 'none'", "frame-ancestors 'self'",
    ].join('; '),
    // Not cached: taking a site offline or changing it has to take effect on the next open.
    'Cache-Control': 'no-cache, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  }).send(html);
});

// The sandboxed page has an opaque origin, so the browser sends Origin: null. This endpoint takes no
// session and returns nothing private, so answering that origin is safe.
function cors(res) {
  res.set({ 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin', 'Cache-Control': 'no-store' });
}

router.options('/:slug/send', (req, res) => { cors(res); res.status(204).end(); });

router.post('/:slug/send', express.text({ type: () => true, limit: '64kb' }), async (req, res) => {
  cors(res);
  const slug = String(req.params.slug || '').toLowerCase();
  let body;
  try { body = JSON.parse(typeof req.body === 'string' ? req.body : '{}'); } catch (_) { body = null; }
  const raw = body && body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : null;
  if (!raw) return res.status(400).json({ ok: false, says: 'That form sent nothing I could read.' });
  const fields = {};
  for (const [k, v] of Object.entries(raw).slice(0, MAX_FIELDS)) {
    const key = String(k).slice(0, 80).trim();
    const val = String(v == null ? '' : v).slice(0, MAX_VALUE).trim();
    if (key && val) fields[key] = val;
  }
  if (!Object.keys(fields).length) {
    return res.status(422).json({ ok: false, says: 'Please fill in the form before sending.' });
  }
  let site;
  try {
    site = (await query(
      `SELECT b.id, b.business_id, bz.name AS business_name, u.email AS owner_email
         FROM builds b JOIN businesses bz ON bz.id=b.business_id
         JOIN users u ON u.id=bz.owner_id
        WHERE b.published_slug=$1`, [slug])).rows[0];
  } catch (e) {
    return res.status(502).json({ ok: false, says: 'That did not send, because of a fault on our side. Please try again.' });
  }
  if (!site) return res.status(404).json({ ok: false, says: 'This site is no longer taking messages.' });

  const sender = crypto.createHash('sha256')
    .update(String(req.ip || '') + '|' + (process.env.JWT_SECRET || '')).digest('hex').slice(0, 32);
  const recent = await query(
    `SELECT count(*)::int AS n FROM site_messages
      WHERE build_id=$1 AND sender_hash=$2 AND created_at > now() - interval '1 hour'`, [site.id, sender]);
  if (recent.rows[0].n >= FLOOD_PER_HOUR) {
    return res.status(429).json({ ok: false, says: 'You have sent several messages already. Please wait an hour and try again.' });
  }

  const who = fields.name || fields['full-name'] || fields.full_name || fields['first-name']
    || fields.first_name || fields.email || 'someone';
  try {
    const ob = await query(
      `INSERT INTO obligations (business_id, kind, title, detail, counterparty, counterparty_kind,
          due_at, cost_basis, consequence, source, source_ref)
       VALUES ($1,'promise',$2,$3,$4,'customer', now() + interval '1 day','unknown',
          'A message left unanswered for a day is often a customer who has gone elsewhere.',
          'site', $5) RETURNING id`,
      [site.business_id, 'Reply to ' + who + ', who wrote through your site',
        Object.entries(fields).map(([k, v]) => k + ': ' + v).join('\n').slice(0, 4000),
        String(who).slice(0, 120), 'site ' + slug]);
    await query(
      `INSERT INTO site_messages (build_id, business_id, fields, sender_hash, obligation_id)
       VALUES ($1,$2,$3,$4,$5)`, [site.id, site.business_id, JSON.stringify(fields), sender, ob.rows[0].id]);
  } catch (e) {
    return res.status(502).json({ ok: false, says: 'That did not send, because of a fault on our side. Please try again.' });
  }

  // Best effort: the message is already kept and on Today, so a failed email does not lose it.
  const text = 'A message came in through your site ' + slug + ' for ' + site.business_name + '.\n\n'
    + Object.entries(fields).map(([k, v]) => k + ': ' + v).join('\n')
    + '\n\nIt is also on your Today list: ' + origin(req) + '/today.html\n\nPenny';
  sendEmail({ to: site.owner_email, subject: 'New message from your site, ' + slug, text,
    html: '<pre style="font:15px/1.5 system-ui,sans-serif;white-space:pre-wrap">' + esc(text) + '</pre>' })
    .then((r) => { if (!r || !r.sent) console.error('site message email not sent:', r && r.reason); })
    .catch((e) => console.error('site message email failed:', e.message));

  res.status(201).json({ ok: true, says: 'Thank you. Your message has been sent to ' + site.business_name + '.' });
});

module.exports = router;
module.exports.addOns = addOns;
