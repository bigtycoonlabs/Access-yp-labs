// KEYS ENDPOINTS. A key goes in; nothing but its last four characters ever comes back out.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const K = require('../services/clay/keys');

const router = express.Router();
const STATUS = { refused: 403, unclear: 422, unavailable: 502 };
function send(res, r, okCode = 200) {
  res.set('Cache-Control', 'no-store');
  if (r.ok) return res.status(okCode).json(r);
  return res.status(STATUS[r.kind] || 400).json({ error: r.says, kind: r.kind });
}

router.get('/', authenticate, asyncHandler(async (req, res) => {
  if (!req.query.business_id) throw new ApiError(400, 'Which business?');
  send(res, await K.list(req.user, String(req.query.business_id)));
}));

router.post('/', authenticate, [
  body('business_id').isUUID().withMessage('Which business?'),
  body('service').isIn(Object.keys(K.SERVICES)).withMessage('Keys holds GitHub, Railway and Supabase keys for now.'),
  body('value').isString().withMessage('Paste the key.'),
], asyncHandler(async (req, res) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, e.array()[0].msg);
  const b = req.body;
  send(res, await K.save(req.user, b.business_id, { service: b.service, value: b.value, label: b.label, via: 'person' }), 201);
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  send(res, await K.remove(req.user, req.params.id));
}));

module.exports = router;
