// CONTRIBUTIONS — somebody else's work, merged into a project.
//
// THE PROJECT OWNER DECIDES. Not staff, not Clay. It is their project and nobody else can judge
// whether a contribution fits what they are building. Clay screens first for obvious junk, which is
// speed and not authority.
//
// The share is fixed at acceptance and never recalculated. A contributor knows what they earned the
// day they earned it, rather than discovering months later that it was diluted by everyone who came
// after. That dilution is what turned Quirky's community from proud to resentful: on their single
// biggest product ever, 1,005 contributors averaged about $992 each.
//
// A REJECTION MUST TEACH, NOT STING. It carries a reason the contributor reads, and it costs them
// nothing — no penalty, no mark. This platform needs people trying far more than it needs people
// cautious.
//
// Nothing here touches money. A share is recorded; it is paid out of a completed sale, after the
// Stripe webhook confirms it, and it reverses if the sale reverses.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const { safely } = require('../services/notify');

const router = express.Router();

const FULL = 'This project already has five people on it. Nobody else can be added until somebody '
  + 'releases their seat.';

function fail(res, errs) {
  return errs.isEmpty() ? null : res.status(400).json({ errors: errs.array() });
}

function rethrow(e) {
  if (e && /five people on it/.test(String(e.message || ''))) throw new ApiError(409, FULL);
  throw e;
}

async function conceptOf(id) {
  const r = await query('SELECT id, owner_id, title FROM concepts WHERE id=$1', [id]);
  if (!r.rows.length) throw new ApiError(404, 'That project could not be found.');
  return r.rows[0];
}

// Mirrors the database trigger, so a person is told the project is full BEFORE they spend an
// evening on a contribution that could never be accepted.
async function seatsTaken(conceptId) {
  const r = await query(
    `SELECT
       (SELECT count(DISTINCT holder_id) FROM project_seats
         WHERE concept_id=$1 AND status='filled' AND holder_id IS NOT NULL)
     + (SELECT count(DISTINCT c.contributor_id) FROM contributions c
         WHERE c.concept_id=$1 AND c.state IN ('accepted','superseded')
           AND c.contributor_id NOT IN (
             SELECT holder_id FROM project_seats
              WHERE concept_id=$1 AND status='filled' AND holder_id IS NOT NULL)) AS taken`,
    [conceptId]);
  return Number(r.rows[0].taken || 0);
}

// Somebody already on the team is not a sixth person. Without this, a contributor who holds a seat
// could be blocked from contributing to the project they are already on.
async function alreadyOnTeam(conceptId, userId) {
  const r = await query(
    `SELECT 1 FROM project_seats WHERE concept_id=$1 AND holder_id=$2 AND status='filled'
      UNION ALL
     SELECT 1 FROM contributions WHERE concept_id=$1 AND contributor_id=$2 AND state IN ('accepted','superseded')
      LIMIT 1`, [conceptId, userId]);
  return r.rows.length > 0;
}

// ---------------------------------------------------------------- offering

router.post('/project/:conceptId', authenticate, [
  body('kind').trim().isLength({ min: 2, max: 60 }).withMessage('Say what kind of thing you built.'),
  body('note').trim().isLength({ min: 20, max: 1200 })
    .withMessage('Say what you did and why it helps, in at least twenty characters. The owner is '
      + 'deciding whether it fits what they are building.'),
  body('asset_id').optional({ nullable: true }).isUUID(),
], asyncHandler(async (req, res) => {
  const bad = fail(res, validationResult(req)); if (bad) return bad;
  const concept = await conceptOf(req.params.conceptId);

  // Contributing to your own project is just building it. The seller side is already yours.
  if (concept.owner_id === req.user.id) {
    throw new ApiError(400, 'This is your own project. Anything you add to it is yours already — '
      + 'contributions are for work somebody else brings.');
  }

  // Say it is full before they do the work, not after they submit it.
  if (!(await alreadyOnTeam(req.params.conceptId, req.user.id))) {
    if (await seatsTaken(req.params.conceptId) >= 5) throw new ApiError(409, FULL);
  }

  const dupe = await query(
    `SELECT 1 FROM contributions WHERE concept_id=$1 AND contributor_id=$2 AND state='offered'`,
    [req.params.conceptId, req.user.id]);
  if (dupe.rows.length) {
    throw new ApiError(409, 'You already have something waiting on this project. Give the owner a '
      + 'chance to look at it before offering another.');
  }

  const r = await query(
    `INSERT INTO contributions (concept_id, contributor_id, kind, note, asset_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.conceptId, req.user.id, req.body.kind.trim(), req.body.note.trim(),
      req.body.asset_id || null]).catch(rethrow);

  // The owner has to learn this without opening the page. Nothing built this week is worth
  // anything if the person who has to act finds out by chance.
  safely({
    userId: concept.owner_id,
    kind: 'contribution_offered',
    headline: (req.user.display_name || req.user.name || 'Somebody')
      + ' offered to help with ' + (concept.title || 'your project'),
    body: req.body.note.trim().slice(0, 240),
    conceptId: concept.id,
    actorId: req.user.id,
    url: '/concept.html?id=' + concept.id,
    dedupeKey: 'contrib_offered:' + r.rows[0].id,
  });

  res.status(201).json({ ok: true, contribution: r.rows[0],
    message: 'Offered. ' + (concept.title || 'The owner') + ' will decide whether it fits, and you '
      + 'will see their answer either way.' });
}));

// Withdraw your own offer, while it is still waiting.
router.post('/:id/withdraw', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE contributions SET state='rejected', decision_reason='Withdrawn by the contributor.',
            decided_at=NOW(), decided_by=$2
      WHERE id=$1 AND contributor_id=$2 AND state='offered' RETURNING *`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) {
    throw new ApiError(404, 'Nothing of yours is waiting on that project — it may already have been decided.');
  }
  res.json({ ok: true, contribution: r.rows[0] });
}));

// ---------------------------------------------------------------- deciding

router.get('/project/:conceptId', authenticate, asyncHandler(async (req, res) => {
  const concept = await conceptOf(req.params.conceptId);
  const mine = concept.owner_id === req.user.id;
  const r = await query(
    `SELECT c.id, c.kind, c.note, c.state, c.share_bp, c.decided_at, c.decision_reason, c.created_at,
            COALESCE(u.display_name, 'no name yet') AS contributor_name,
            (c.contributor_id = $2) AS is_mine
       FROM contributions c JOIN users u ON u.id = c.contributor_id
      WHERE c.concept_id=$1
        ${mine ? '' : 'AND (c.contributor_id = $2 OR c.state IN (\'accepted\',\'superseded\'))'}
      ORDER BY c.created_at DESC`,
    [req.params.conceptId, req.user.id]);
  const taken = await seatsTaken(req.params.conceptId);
  res.json({ ok: true, contributions: r.rows, can_decide: mine,
    taken, remaining: Math.max(0, 5 - taken), full: taken >= 5 });
}));

router.post('/:id/accept', authenticate, [
  body('share_bp').isInt({ min: 0, max: 10000 })
    .withMessage('Say what share of the seller side this is worth, in basis points. 1,000 is ten percent.'),
], asyncHandler(async (req, res) => {
  const bad = fail(res, validationResult(req)); if (bad) return bad;

  const c = await query('SELECT * FROM contributions WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'That contribution could not be found.');
  const contribution = c.rows[0];
  if (contribution.state !== 'offered') {
    throw new ApiError(409, 'That has already been decided.');
  }

  const concept = await conceptOf(contribution.concept_id);
  if (concept.owner_id !== req.user.id) {
    throw new ApiError(403, 'Only the person whose project this is can accept work into it.');
  }

  // The shares on a project cannot exceed the seller side. Checked here rather than at payout,
  // because discovering at the point of sale that the team promised 130% is the worst possible
  // moment to find out.
  const sum = await query(
    `SELECT COALESCE(SUM(share_bp),0) AS total FROM contributions
      WHERE concept_id=$1 AND state IN ('accepted','superseded')`, [contribution.concept_id]);
  const total = Number(sum.rows[0].total) + Number(req.body.share_bp);
  if (total > 10000) {
    throw new ApiError(409, 'That would promise more than the whole seller side. '
      + Number(sum.rows[0].total) / 100 + '% is already committed to other people, so there is '
      + (10000 - Number(sum.rows[0].total)) / 100 + '% left. Nothing was changed.');
  }

  const r = await query(
    `UPDATE contributions SET state='accepted', share_bp=$2, decided_by=$3, decided_at=NOW()
      WHERE id=$1 AND state='offered' RETURNING *`,
    [req.params.id, req.body.share_bp, req.user.id]).catch(rethrow);
  if (!r.rows.length) throw new ApiError(409, 'That was decided while you were looking at it.');

  safely({
    userId: contribution.contributor_id,
    kind: 'contribution_accepted',
    headline: (concept.title || 'A project') + ' accepted your ' + contribution.kind,
    body: 'You hold ' + (Number(req.body.share_bp) / 100) + '% of the seller side. That share is '
      + 'fixed and will not shrink if other people join later.',
    conceptId: concept.id,
    actorId: req.user.id,
    url: '/concept.html?id=' + concept.id,
    dedupeKey: 'contrib_accepted:' + r.rows[0].id,
  });

  res.json({ ok: true, contribution: r.rows[0],
    message: 'Accepted at ' + (Number(req.body.share_bp) / 100) + '% of the seller side. That share '
      + 'is fixed now and will not change if other people join later.' });
}));

router.post('/:id/reject', authenticate, [
  body('reason').trim().isLength({ min: 15, max: 800 })
    .withMessage('Say why, in at least fifteen characters. They will read it, and a reason they can '
      + 'learn from is the difference between a no and a door closing.'),
], asyncHandler(async (req, res) => {
  const bad = fail(res, validationResult(req)); if (bad) return bad;

  const c = await query('SELECT * FROM contributions WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'That contribution could not be found.');
  if (c.rows[0].state !== 'offered') throw new ApiError(409, 'That has already been decided.');

  const concept = await conceptOf(c.rows[0].concept_id);
  if (concept.owner_id !== req.user.id) {
    throw new ApiError(403, 'Only the person whose project this is can decide work offered to it.');
  }

  const r = await query(
    `UPDATE contributions SET state='rejected', decision_reason=$2, decided_by=$3, decided_at=NOW()
      WHERE id=$1 AND state='offered' RETURNING *`,
    [req.params.id, req.body.reason.trim(), req.user.id]);

  // A no has to arrive as reliably as a yes, and carrying the reason is the whole point. Somebody
  // left wondering why is worse off than somebody told plainly.
  safely({
    userId: c.rows[0].contributor_id,
    kind: 'contribution_declined',
    headline: (concept.title || 'A project') + ' turned down your ' + c.rows[0].kind,
    body: req.body.reason.trim() + ' — this costs you nothing, and you can offer something else.',
    conceptId: concept.id,
    actorId: req.user.id,
    url: '/seats.html',
    dedupeKey: 'contrib_declined:' + r.rows[0].id,
  });

  res.json({ ok: true, contribution: r.rows[0],
    message: 'Turned down, with your reason sent to them. It costs them nothing — no mark, no '
      + 'penalty — and they can offer something else.' });
}));

// Supersede: something better replaced it. The share STAYS, because it was in the project when it
// was accepted and the work was genuinely used. Taking it back later would make every acceptance
// provisional, and a provisional share is not worth contributing for.
router.post('/:id/supersede', authenticate, asyncHandler(async (req, res) => {
  const c = await query('SELECT * FROM contributions WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'That contribution could not be found.');
  if (c.rows[0].state !== 'accepted') {
    throw new ApiError(409, 'Only something already accepted can be superseded.');
  }
  const concept = await conceptOf(c.rows[0].concept_id);
  if (concept.owner_id !== req.user.id) throw new ApiError(403, 'That is not your project.');

  const r = await query(
    `UPDATE contributions SET state='superseded' WHERE id=$1 AND state='accepted' RETURNING *`,
    [req.params.id]);
  res.json({ ok: true, contribution: r.rows[0],
    message: 'Marked as replaced. Their share stays — it was in the project when you accepted it.' });
}));

// ---------------------------------------------------------------- what somebody holds

// A person's portfolio: every position they hold across every project. This is the thing that makes
// a daily return worth making — one project has one thing to check, a portfolio has something
// happening most days.
router.get('/mine', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT c.id, c.kind, c.state, c.share_bp, c.created_at, c.decided_at, c.decision_reason,
            k.id AS concept_id, k.title,
            l.status AS listing_status, l.price_cents
       FROM contributions c
       JOIN concepts k ON k.id = c.concept_id
       LEFT JOIN listings l ON l.concept_id = k.id AND l.status IN ('live','in_review','sold')
      WHERE c.contributor_id=$1
      ORDER BY c.created_at DESC`, [req.user.id]);
  const held = r.rows.filter((x) => x.state === 'accepted' || x.state === 'superseded');
  res.json({ ok: true, contributions: r.rows,
    positions: held.length,
    // Deliberately no estimated value. A share of something unsold is not money, and putting a
    // number on it would be the platform forecasting a sale that has not happened.
    note: held.length
      ? 'You hold ' + held.length + ' position' + (held.length === 1 ? '' : 's') + ' across projects here.'
      : 'You do not hold a position in anything yet.' });
}));

module.exports = router;
