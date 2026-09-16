// LAUNCH ENDPOINTS. Each step is its own request, because each is its own yes.
const express = require('express');
const { asyncHandler } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const L = require('../services/clay/launcher');

const router = express.Router();
const STATUS = { refused: 403, unclear: 422, unavailable: 502 };
function send(res, r, okCode = 200) {
  if (r.ok) return res.status(okCode).json(r);
  return res.status(STATUS[r.kind] || 400).json({ error: r.says, kind: r.kind });
}

router.get('/:buildId', authenticate, asyncHandler(async (req, res) => send(res, await L.status(req.user, req.params.buildId))));
router.post('/:buildId/code', authenticate, asyncHandler(async (req, res) => {
  send(res, await L.pushCode(req.user, req.params.buildId, { repo_name: (req.body || {}).repo_name }), 201);
}));
router.post('/:buildId/hosting', authenticate, asyncHandler(async (req, res) => send(res, await L.host(req.user, req.params.buildId), 201)));
router.post('/:buildId/check', authenticate, asyncHandler(async (req, res) => send(res, await L.check(req.user, req.params.buildId))));

module.exports = router;
