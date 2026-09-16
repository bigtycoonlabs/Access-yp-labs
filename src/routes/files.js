// FILE ENDPOINTS.
//
// Uploads arrive as the raw file body, with the name in a header, rather than base64 inside JSON:
// base64 makes a 10 MB photo 13 MB and it would hit the JSON limit before it hit ours.
//
// Serving: photos open inline inside a CSP sandbox; everything else downloads. Nothing we store is
// ever rendered as a page on our origin.

const express = require('express');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const F = require('../services/clay/files');

const router = express.Router();
const STATUS = { refused: 403, unclear: 422, unavailable: 502 };

function send(res, r, okCode = 200) {
  if (r.ok) return res.status(okCode).json(r);
  return res.status(STATUS[r.kind] || 400).json({ error: r.says, kind: r.kind });
}

function serve(res, f) {
  const inline = f.kind === 'photo';
  const ascii = f.name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.status(200).set({
    'Content-Type': f.mime,
    'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + ascii
      + '"; filename*=UTF-8\'\'' + encodeURIComponent(f.name),
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  }).send(f.data);
}

router.get('/', authenticate, asyncHandler(async (req, res) => {
  if (!req.query.business_id) throw new ApiError(400, 'Which business?');
  send(res, await F.list(req.user, String(req.query.business_id)));
}));

router.post('/', authenticate,
  express.raw({ type: () => true, limit: F.MAX_BYTES + 1024 }),
  asyncHandler(async (req, res) => {
    const business_id = String(req.query.business_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(business_id)) throw new ApiError(400, 'Which business?');
    let name = req.get('X-File-Name') || 'file';
    try { name = decodeURIComponent(name); } catch (_) { /* keep as sent */ }
    let description = req.get('X-File-Description') || null;
    if (description) { try { description = decodeURIComponent(description); } catch (_) {} }
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    send(res, await F.upload(req.user, { business_id, name, buffer: buf, description }), 201);
  }));

router.get('/:id/download', authenticate, asyncHandler(async (req, res) => {
  const g = await F.fileFor(req.user, req.params.id, 'view');
  if (!g.ok) return send(res, g);
  serve(res, g.file);
}));

router.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  send(res, await F.update(req.user, req.params.id, {
    name: typeof b.name === 'string' ? b.name : undefined,
    description: typeof b.description === 'string' ? b.description : undefined,
  }));
}));

router.post('/:id/describe', authenticate, asyncHandler(async (req, res) => {
  send(res, await F.redescribe(req.user, req.params.id));
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  send(res, await F.remove(req.user, req.params.id));
}));

router.post('/:id/share', authenticate, asyncHandler(async (req, res) => {
  const b = req.body || {};
  send(res, await F.share(req.user, req.params.id, { days: b.days, shared_with: b.shared_with }), 201);
}));

router.delete('/shares/:shareId', authenticate, asyncHandler(async (req, res) => {
  send(res, await F.revoke(req.user, req.params.shareId));
}));

// Opening a shared link. No login: the token is the permission, and it ends.
const opener = express.Router();
opener.get('/:token', asyncHandler(async (req, res) => {
  const r = await F.openShared(req.params.token);
  if (!r.ok) {
    return res.status(404).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow' })
      .send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" '
        + 'content="width=device-width, initial-scale=1"><title>Link not available</title></head>'
        + '<body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5"><main>'
        + '<h1>This link is not available</h1><p>It may have expired or been stopped by the person '
        + 'who shared it. Ask them for a new one.</p></main></body></html>');
  }
  serve(res, r.file);
}));

module.exports = router;
module.exports.opener = opener;
