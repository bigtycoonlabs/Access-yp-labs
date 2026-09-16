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
const Gen = require('../services/clay/buildGen');
const Scope = require('../services/clay/scope');
const { query } = require('../config/db');
const Perm = require('../lib/permissions');

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

// Ask for something. Nothing starts until the person has said whether they want a mock-up first:
// without mock_first this answers 200 with the question and starts nothing. With 'yes' it starts a
// free mock. With 'no' it starts the real build and records that they chose to skip the mock-up.
// No amount, price or plan is read from the body, so what a build costs cannot be set by a request.
router.post('/', authenticate, [
  body('business_id').isUUID().withMessage('Which business?'),
  body('asked_for').isString().trim().isLength({ min: 1 })
    .withMessage('Tell me what you want it to do.'),
  body('mock_first').optional({ values: 'null' }).isIn(['yes', 'no', true, false])
    .withMessage('Answer yes or no to the mock-up question.'),
  body('edit_of').optional({ values: 'falsy' }).isUUID(),
  body('tier').optional({ values: 'falsy' }).isIn(Scope.TIERS)
    .withMessage('Choose where it should live.'),
  body('kind').optional({ values: 'falsy' })
    .isIn(['page', 'site', 'portal', 'form', 'tool', 'automation', 'other'])
    .withMessage('That is not a kind of thing I build.'),
], asyncHandler(async (req, res) => {
  bad(req);
  const r = await B.start(req.user, {
    business_id: req.body.business_id, asked_for: req.body.asked_for, kind: req.body.kind,
    mock_first: req.body.mock_first, edit_of: req.body.edit_of, tier: req.body.tier,
  });
  if (r.ok && r.build) Gen.kick(r.build.id);
  send(res, r, r.build ? 201 : 200);
}));

// Penny's recommendation for where something should live, before anything is started. Read-only.
router.get('/scope', authenticate, asyncHandler(async (req, res) => {
  const c = Scope.classify(String(req.query.asked_for || ''));
  send(res, { ok: true, recommended: c.recommended, signals: c.signals, says: c.says,
    homes: Scope.TIERS.map((t) => ({ tier: t, what: Scope.WHAT[t], ready: Scope.AVAILABLE[t].ready,
      note: Scope.AVAILABLE[t].says || Scope.AVAILABLE[t].partial || null })) });
}));

// Messages sent from this business's hosted sites, newest first.
router.get('/messages', authenticate, asyncHandler(async (req, res) => {
  const biz = String(req.query.business_id || '');
  if (!biz) throw new ApiError(400, 'Which business?');
  const gate = await Perm.can(req.user.id, biz, 'customers', 'view');
  if (!gate.ok) {
    return send(res, { ok: false, kind: 'refused',
      says: Perm.refusalLine(gate, 'customers', gate.perms && gate.perms.business.name) });
  }
  try {
    const r = await query(
      `SELECT m.id, m.fields, m.created_at, b.published_slug, b.asked_for,
              o.status AS reply_status
         FROM site_messages m JOIN builds b ON b.id=m.build_id
         LEFT JOIN obligations o ON o.id=m.obligation_id
        WHERE m.business_id=$1 ORDER BY m.created_at DESC LIMIT 100`, [biz]);
    const open = r.rows.filter((m) => m.reply_status === 'open').length;
    send(res, { ok: true, messages: r.rows, says: !r.rows.length ? 'No messages from your sites yet.'
      : r.rows.length + (r.rows.length === 1 ? ' message' : ' messages') + ' from your sites'
        + (open ? ', ' + open + ' still waiting for a reply.' : ', all answered.') });
  } catch (e) {
    send(res, { ok: false, kind: 'unavailable', says: 'I could not read your site messages, so I do '
      + 'not know whether any came in. ' + e.message });
  }
}));

// Put a finished Labs site online, or take it offline.
router.post('/:id/publish', authenticate, asyncHandler(async (req, res) => {
  const host = req.get('host');
  const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  send(res, await B.publish(req.user, { build_id: req.params.id, address: (req.body || {}).address,
    origin: proto + '://' + host }));
}));

router.post('/:id/unpublish', authenticate, asyncHandler(async (req, res) => {
  send(res, await B.unpublish(req.user, { build_id: req.params.id }));
}));

// Approve a finished mock. This is the only endpoint in the product that creates a charge, and it
// takes no amount, no price and no plan — what it costs is not something a request can influence.
router.post('/:id/approve', authenticate, asyncHandler(async (req, res) => {
  const r = await B.approve(req.user, { build_id: req.params.id });
  if (r.ok && r.build) Gen.kick(r.build.id);
  send(res, r, 201);
}));

// Tell us what we got wrong. Never chargeable — refused by the database, named by the service.
router.post('/:id/fix', authenticate, [
  body('whats_wrong').optional({ values: 'falsy' }).isString().trim(),
], asyncHandler(async (req, res) => {
  bad(req);
  const r = await B.fix(req.user, { build_id: req.params.id, whats_wrong: req.body.whats_wrong });
  if (r.ok && r.build) Gen.kick(r.build.id);
  send(res, r, 201);
}));

module.exports = router;
