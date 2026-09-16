// ONBOARDING — the conversation that replaces the setup screen.
//
// This is where the rule engine stops being data and becomes the reason somebody keeps the product.
// Before this route existed, fifty-one jurisdictions of compliance rules were reachable by nobody: a
// person could sign up, and the only way to get an obligation onto their list was to POST one by
// hand. The engine was built and unreachable, which is the same as unbuilt.
//
// WHAT THIS IS NOT. It is not a wizard. There are no steps, no progress bar, no required fields
// beyond a name. A form that demands entity type and formation state before it will save anything is
// how somebody bounces on day one — and a wizard is worse for a screen-reader user, who cannot tell
// how much is left or go back without losing their place.
//
// Penny asks in ordinary words, the answers arrive here in one shape, and the workspace configures
// itself. Anything not known yet is simply absent and gets filled in later.
//
// THE CLAIM THIS HAS TO MAKE TRUE: under five minutes from signing up to seeing something true about
// your own business. Not a tour. An answer.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const compliance = require('../services/clay/compliance');
const R = require('../lib/ranking');

const router = express.Router();

router.post('/', authenticate, [
  body('name').isString().trim().isLength({ min: 1, max: 120 })
    .withMessage('What is the business called?'),
  body('entity_type').optional({ values: 'falsy' }).isIn(
    ['sole_proprietor', 'llc', 's_corp', 'c_corp', 'partnership', 'nonprofit', 'other']),
  body('formation_state').optional({ values: 'falsy' }).isString().trim().isLength({ max: 2 }),
  body('operating_states').optional().isArray(),
  body('formed_on').optional({ values: 'falsy' }).isISO8601(),
  body('trade').optional({ values: 'falsy' }).isString().trim().isLength({ max: 120 }),
  body('has_contractors').optional().isBoolean(),
  body('has_employees').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, e.array()[0].msg);
  const b = req.body;

  const formation = b.formation_state ? String(b.formation_state).toUpperCase() : null;
  const operating = (Array.isArray(b.operating_states) && b.operating_states.length
    ? b.operating_states : (formation ? [formation] : []))
    .map((s) => String(s).toUpperCase());

  const biz = await query(
    `INSERT INTO businesses (owner_id, name, legal_name, entity_type, formation_state,
        operating_states, trade, formed_on, headcount, stage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'running')) RETURNING *`,
    [req.user.id, b.name.trim(), b.legal_name || null, b.entity_type || null, formation,
      operating, b.trade || null, b.formed_on || null, b.has_employees ? 1 : 0, b.stage || null]);
  const business = biz.rows[0];

  // The owner is a relationship too, so permission checks have one path rather than a special case
  // that can rot. forBusiness() short-circuits on ownership anyway; this keeps the team screen honest.
  await query(
    `INSERT INTO relationships (business_id, user_id, display_name, kind)
     VALUES ($1,$2,$3,'owner') ON CONFLICT (business_id, user_id) DO NOTHING`,
    [business.id, req.user.id, req.user.name || 'Owner']);

  // THE MOMENT THIS EXISTS FOR.
  const found = compliance.rulesFor(business, {
    has_contractors: !!b.has_contractors,
    has_employees: !!b.has_employees,
  });

  const written = [];
  for (const o of found.obligations) {
    // An obligation with no date is still worth recording — a standing condition, or an anniversary
    // state whose formation date we do not have yet. It carries its reason instead of a fake date.
    const row = await query(
      `INSERT INTO obligations (business_id, kind, title, detail, counterparty, counterparty_kind,
          due_at, recurs_every, cost_if_missed_cents, cost_basis, cost_note, consequence,
          source, source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'rule_engine',$13) RETURNING *`,
      [business.id, o.kind, o.title, o.due_note || null, o.counterparty, o.counterparty_kind,
        o.due_at || null, o.recurs_every || null, o.cost_if_missed_cents ?? null,
        o.cost_basis || null, o.cost_note || null, o.consequence, o.source_ref]);
    written.push(row.rows[0]);
  }

  // WHAT SHE SAYS BACK. Found, assumed, missing — kept separate, never blended into one confident
  // summary. A plan half-understood and stated confidently is worse than no plan.
  // NOT rankedToday. That answers "what needs you in the next 45 days", and onboarding is asking a
  // different question: "what did I just find". The first version used it and produced "One thing
  // needs you" directly above a list of three — because the Florida report was 228 days out and the
  // 1099 was 138. Two statements from the same assistant disagreeing is where trust ends, and it is
  // exactly the failure this estate has already had once.
  const byCost = written.slice().sort((a, c) =>
    (c.cost_if_missed_cents || 0) - (a.cost_if_missed_cents || 0));
  const missing = [];
  if (!b.entity_type) missing.push('whether it is an LLC or you are operating as yourself');
  if (!formation) missing.push('which state it is registered in');
  // Only ask for the formation date when a state actually needs it. The first version asked whenever
  // ANY obligation had no date, which caught Ohio's statutory agent and the W-9 — both standing
  // conditions with no date by design. Asking for something that would not change the answer is how
  // an assistant teaches people that its questions are noise.
  //
  // `detail` carries the due_note, and only an anniversary-timed state sets one.
  if (!b.formed_on && written.some((w) => w.detail && /anniversary/i.test(w.detail))) {
    missing.push('when the company was formed, which some states use to set your filing date');
  }

  res.status(201).json({
    business,
    // Deliberately the ranked sentence rather than a count. "Three things need you, the one that
    // costs most is..." is an answer; "3 obligations created" is a receipt.
    summary: written.length
      ? (written.length === 1 ? 'One thing so far' : written.length + ' things so far')
        + ', and the one that costs most is ' + byCost[0].title
        + (byCost[0].cost_if_missed_cents
          ? ' at ' + R.money(byCost[0].cost_if_missed_cents)
            + (byCost[0].cost_basis === 'estimated' ? ', roughly' : '') : '')
        + '.'
      : 'I did not find anything you owe yet, which is either good news or a sign I do not know '
        + 'enough about the business. Tell me more and I will check again.',
    found: written.map((w) => ({
      id: w.id, title: w.title, due_at: w.due_at,
      says: R.explain(Object.assign({}, w, { overdue: false })),
    })),
    // Absence is an answer. Telling somebody they do NOT owe an annual report is worth as much as
    // telling them they do, because people pay for filings they never needed.
    notes: found.notes,
    missing,
    coverage: compliance.coverageNote(business),
  });
}));

module.exports = router;
