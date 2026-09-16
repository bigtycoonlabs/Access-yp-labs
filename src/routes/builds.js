// THE BUILD ENDPOINTS.
//
// Thin on purpose. Every rule lives in the database (what can be charged) or the service (what can
// be understood, approved, or called ready). A route that re-implements a rule is a route that will
// disagree with it later, and the version somebody reaches is whichever one they happened to call.
//
// The service returns a shape this translates rather than reinvents:
//   ok true                     -> 200 or 201
//   kind 'refused'              -> 403, they are not allowed or the state does not permit it
//   kind 'unclear'              -> 422, we understood the request and cannot act on it yet
//   kind 'unavailable'          -> 502, something on our side failed and nothing happened
//
// 'unclear' is deliberately NOT an error the person caused. It is the one case where the right
// answer is a question, and giving it a 4xx that reads like a mistake would teach people to phrase
// requests defensively rather than plainly.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const B = require('../services/clay/builder');

const router = express.Router();

const STATUS = { refused: 403, unclear: 422, unavailable: 502 };

// One translation, used everywhere, so a caller never has to guess which endpoint reports how.
function send(res, r, okCode = 200) {
  if (r.ok) return res.status(okCode).json(r);
  return res.status(STATUS[r.kind] || 400).json({
    error: r.says,
    // Named so a client can tell "you cannot" from "not yet" from "we broke". Without it, all three
    // render as the same red box and the person cannot tell whether to rephrase or to wait.
    kind: r.kind,
  });
}

const bad = (req) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, e.array()[0].msg);
};

// What have I asked for.
router.get('/', authenticate, asyncHandler(async (req, res) => {
  if (!req.query.business_id) throw new ApiError(400, 'Which business?');
  send(res, await B.listFor(req.user, req.query.business_id));
}));

// Ask for something. Always a mock, always free — there is no parameter that makes this cost money,
// which is the point: the expensive path cannot be reached by accident or by a crafted request.
router.post('/', authenticate, [
  body('business_id').isUUID().withMessage('Which business?'),
  body('asked_for').isString().trim().isLength({ min: 1 })
    .withMessage('Tell me what you want it to do.'),
], asyncHandler(async (req, res) => {
  bad(req);
  send(res, await B.requestMock(req.user, req.body), 201);
}));

// Approve a finished mock. This is the only endpoint in the product that creates a charge, and it
// takes no amount, no price and no plan — what it costs is not something a request can influence.
router.post('/:id/approve', authenticate, asyncHandler(async (req, res) => {
  send(res, await B.approve(req.user, { build_id: req.params.id }), 201);
}));

// Tell us what we got wrong. Never chargeable — refused by the database, named by the service.
router.post('/:id/fix', authenticate, [
  body('whats_wrong').optional({ values: 'falsy' }).isString().trim(),
], asyncHandler(async (req, res) => {
  bad(req);
  send(res, await B.fix(req.user, { build_id: req.params.id, whats_wrong: req.body.whats_wrong }),
    201);
}));

module.exports = router;
