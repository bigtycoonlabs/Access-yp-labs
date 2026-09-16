// THE PUBLIC PREVIEW — the product proving itself before anybody signs up.
//
// Every competitor's homepage is a feature grid. The research on this category is blunt about where
// that leads: "most small businesses choose an all-in-one based on a feature comparison chart, then
// regret it six months later when the workflow does not fit." A grid wins the purchase and loses the
// customer.
//
// So the homepage does not describe the product. It runs it. Somebody picks their state and how the
// business is set up, and gets their actual filings — real dates, real penalties, real sources, from
// the same engine a paying customer uses. No account, no email, nothing stored.
//
// That is also the honest version of a demo: it can only show what the engine genuinely knows, and
// where the engine is unsure it says so on the homepage as readily as inside the product.
//
// WHAT THIS ROUTE MUST NOT DO: write anything, take an email, or know who is asking. It is a pure
// function of two dropdowns.

const express = require('express');
const { query: vquery, validationResult } = require('express-validator');
const { asyncHandler, ApiError } = require('../lib/http');
const compliance = require('../services/clay/compliance');
const states = require('../services/clay/states');
const R = require('../lib/ranking');

const router = express.Router();

// Light in-memory throttle. The route is free, does no work worth stealing and stores nothing, but
// it does run for anybody on the internet.
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, since: now };
  if (now - rec.since > 60000) { rec.n = 0; rec.since = now; }
  rec.n += 1;
  hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();
  return rec.n > 40;
}

router.get('/preview', [
  vquery('state').isString().trim().isLength({ min: 2, max: 2 }),
  vquery('entity_type').optional({ values: 'falsy' }).isIn(
    ['sole_proprietor', 'llc', 's_corp', 'c_corp', 'partnership', 'nonprofit', 'other']),
  vquery('has_contractors').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, 'Pick a state and how the business is set up.');
  if (throttled(req.ip)) throw new ApiError(429, 'Give it a moment and try again.');

  const code = String(req.query.state).toUpperCase();
  if (!states.STATES[code]) throw new ApiError(400, 'I do not recognise that state.');

  // No formation date, deliberately — a stranger has not told us one, and an anniversary state will
  // correctly return no date and say why. That is the honest answer and it is worth showing.
  const business = {
    entity_type: req.query.entity_type || 'llc',
    formation_state: code,
    operating_states: [code],
  };
  const found = compliance.rulesFor(business, { has_contractors: req.query.has_contractors === 'true' });

  const items = found.obligations.map((o) => ({
    title: o.title,
    counterparty: o.counterparty,
    due_at: o.due_at,
    needs_formation_date: !o.due_at && !!o.due_note,
    why_no_date: o.due_note || null,
    cost_if_missed_cents: o.cost_if_missed_cents,
    cost_basis: o.cost_basis,
    confidence: o.confidence || 'verified',
    says: R.explain(Object.assign({}, o, { overdue: false })),
    source_ref: o.source_ref,
  }));

  res.json({
    state: code,
    count: items.length,
    items,
    // Absence is an answer. Six states require nothing, and telling somebody that on the homepage is
    // more persuasive than any feature list — people pay for filings they never needed.
    notes: found.notes,
    coverage: compliance.coverageNote(business),
    // Said on the public page as readily as inside the product.
    unverified: items.some((i) => i.cost_basis === 'estimated'),
  });
}));

module.exports = router;
