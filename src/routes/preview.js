// OPENING SOMETHING PENNY BUILT.
//
// A generated page is not our code and must not run as our site. Sign-in sessions live in
// localStorage on this origin, so a page served here normally could read them and act as the person.
// The Content-Security-Policy `sandbox` directive gives the page an opaque origin: it cannot read our
// storage or cookies, cannot reach our API as the person, cannot navigate the tab away, and has no
// network at all. Scripts and forms still run, so the preview behaves like the real thing.
//
// The address is an unguessable token rather than a login, because inside the sandbox nobody is
// signed in. It is not indexed and not cached.

const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

const SANDBOX_CSP = [
  'sandbox allow-scripts allow-forms allow-modals allow-popups',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

function plain(res, code, sentence) {
  res.status(code).set({
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  }).send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
    + 'content="width=device-width, initial-scale=1"><title>Preview</title></head><body '
    + 'style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5"><main><h1>Preview</h1>'
    + '<p>' + sentence + '</p></main></body></html>');
}

router.get('/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{36}$/.test(token)) return plain(res, 404, 'There is nothing at this address.');
  let row;
  try {
    row = (await query(
      `SELECT b.status, b.says, p.html FROM builds b
         LEFT JOIN build_pages p ON p.build_id = b.id
        WHERE b.preview_token = $1`, [token])).rows[0];
  } catch (e) {
    return plain(res, 502, 'I could not open this just now. That is a fault on our side, not a '
      + 'missing page. Try again in a minute.');
  }
  if (!row) return plain(res, 404, 'There is nothing at this address.');
  if (row.status !== 'ready' || !row.html) {
    const why = row.status === 'failed' ? ' It did not finish: ' + (row.says || 'no reason given') : '';
    return plain(res, 404, 'This is not ready to open yet.' + why);
  }
  res.status(200).set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': SANDBOX_CSP,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  }).send(row.html);
});

module.exports = router;
module.exports.SANDBOX_CSP = SANDBOX_CSP;
