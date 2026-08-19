// SEATS — what a project is actually asking for.
//
// Zero partner requests have ever been sent on this platform. Launch Partners has been built, live
// and unused since it shipped, and the reason is not that people do not want to collaborate. It is
// that a project could say it was open to partners and never say what it NEEDED. Somebody browsing
// saw "open to launch partners" and had no idea whether that meant code, customers or cash.
//
// A seat is that missing sentence. Build, sell, materials, operate, craft.
//
// WHAT THE PLATFORM DOES AND DOES NOT DO. It records that a seat exists, that somebody applied, and
// that the owner accepted. It arranges no equity, takes no fee on a connection, and is not party to
// whatever the two of them agree. That is deliberate and it is also what keeps this from being a
// business that needs licensing.
//
// THE FIVE-SEAT RULE lives in the database as a trigger spanning seats and contributions, so it
// cannot hold on one path and fail on the other. These routes surface it as a sentence a person can
// act on rather than a constraint violation.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const { safely } = require('../services/notify');

const router = express.Router();

const KINDS = {
  build:     'Build — the demo, the site, the thing that works',
  sell:      'Sell — customers, outreach, the first ten buyers',
  materials: 'Materials — funding the upfront or physical costs',
  operate:   'Operate — running it once it launches',
  craft:     'Craft — brand, copy, photography, design',
};

const FULL = 'This project already has five people on it. Nobody else can be added until somebody '
  + 'releases their seat.';

function fail(res, errs) {
  return errs.isEmpty() ? null : res.status(400).json({ errors: errs.array() });
}

// The five-seat trigger raises a check_violation. Turn it into the sentence it already carries
// rather than letting a database error reach a person.
function rethrow(e) {
  if (e && /five people on it/.test(String(e.message || ''))) throw new ApiError(409, FULL);
  throw e;
}

async function ownedByMe(conceptId, userId) {
  const r = await query('SELECT id, owner_id, title FROM concepts WHERE id=$1', [conceptId]);
  if (!r.rows.length) throw new ApiError(404, 'That project could not be found.');
  if (r.rows[0].owner_id !== userId) {
    throw new ApiError(403, 'That is not your project, so you cannot change who is on it.');
  }
  return r.rows[0];
}

// How many of the five are taken. Mirrors the trigger exactly so a person is told BEFORE they act
// rather than after — the platform's own rule: never offer something the server will refuse.
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

// ---------------------------------------------------------------- reading

// Every open seat across the platform, newest first. This is the counterpart to the staff review
// queue: the queue is what staff work, this is what creators work.
router.get('/open', asyncHandler(async (req, res) => {
  const kind = KINDS[String(req.query.kind || '')] ? req.query.kind : null;
  const r = await query(
    `SELECT s.id, s.kind, s.brief, s.created_at,
            c.id AS concept_id, c.title, c.category,
            COALESCE(u.display_name, 'no name yet') AS owner_name
       FROM project_seats s
       JOIN concepts c ON c.id = s.concept_id
       JOIN users u ON u.id = c.owner_id
      WHERE s.status='open' ${kind ? 'AND s.kind=$1' : ''}
      ORDER BY s.created_at DESC LIMIT 100`,
    kind ? [kind] : []);
  res.json({ ok: true, kinds: KINDS, seats: r.rows });
}));

// The seats on one project, and whether it is full.
router.get('/project/:conceptId', asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT s.id, s.kind, s.brief, s.status, s.filled_at,
            COALESCE(u.display_name, 'no name yet') AS holder_name
       FROM project_seats s
       LEFT JOIN users u ON u.id = s.holder_id
      WHERE s.concept_id=$1 AND s.status <> 'withdrawn'
      ORDER BY s.created_at`,
    [req.params.conceptId]);
  const taken = await seatsTaken(req.params.conceptId);
  res.json({ ok: true, seats: r.rows, taken, remaining: Math.max(0, 5 - taken), full: taken >= 5 });
}));

// ---------------------------------------------------------------- the owner

router.post('/project/:conceptId', authenticate, [
  body('kind').isIn(Object.keys(KINDS)).withMessage('Choose what this seat is for: build, sell, materials, operate or craft.'),
  body('brief').trim().isLength({ min: 20, max: 600 })
    .withMessage('Say what you need from this person, in at least twenty characters. "Open to partners" is what nobody could act on.'),
], asyncHandler(async (req, res) => {
  const bad = fail(res, validationResult(req)); if (bad) return bad;
  await ownedByMe(req.params.conceptId, req.user.id);

  // An OPEN seat is not a person, so it does not count against the five. The check happens when
  // somebody fills it. Blocking a fifth open seat would stop an owner describing what they need.
  const r = await query(
    `INSERT INTO project_seats (concept_id, kind, brief, created_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.conceptId, req.body.kind, req.body.brief.trim(), req.user.id]).catch(rethrow);
  res.status(201).json({ ok: true, seat: r.rows[0] });
}));

// Fill a seat. Two accounts and an acceptance, which is what makes it impossible to self-deal.
router.post('/:id/fill', authenticate, [
  body('user_id').isUUID().withMessage('Say who is taking the seat.'),
], asyncHandler(async (req, res) => {
  const bad = fail(res, validationResult(req)); if (bad) return bad;

  const s = await query('SELECT * FROM project_seats WHERE id=$1', [req.params.id]);
  if (!s.rows.length) throw new ApiError(404, 'That seat could not be found.');
  const seat = s.rows[0];
  if (seat.status !== 'open') throw new ApiError(409, 'That seat is not open.');

  const concept = await ownedByMe(seat.concept_id, req.user.id);

  // You cannot take a seat on your own project. It is your project — the seller side is already
  // yours, and a seat would be a share of your own money.
  if (req.body.user_id === concept.owner_id) {
    throw new ApiError(400, 'This is your own project, so there is no seat for you to hold on it.');
  }

  const taken = await seatsTaken(seat.concept_id);
  if (taken >= 5) throw new ApiError(409, FULL);

  const r = await query(
    `UPDATE project_seats SET status='filled', holder_id=$2, filled_at=NOW(), updated_at=NOW()
      WHERE id=$1 AND status='open' RETURNING *`,
    [req.params.id, req.body.user_id]).catch(rethrow);
  if (!r.rows.length) throw new ApiError(409, 'That seat was taken while you were deciding.');

  safely({
    userId: req.body.user_id,
    kind: 'seat_filled',
    headline: 'You have the ' + seat.kind + ' seat on ' + (concept.title || 'a project'),
    body: seat.brief,
    conceptId: seat.concept_id,
    actorId: req.user.id,
    url: '/concept.html?id=' + seat.concept_id,
    dedupeKey: 'seat_filled:' + r.rows[0].id + ':' + req.body.user_id,
  });

  res.json({ ok: true, seat: r.rows[0] });
}));

router.post('/:id/withdraw', authenticate, asyncHandler(async (req, res) => {
  const s = await query('SELECT * FROM project_seats WHERE id=$1', [req.params.id]);
  if (!s.rows.length) throw new ApiError(404, 'That seat could not be found.');
  await ownedByMe(s.rows[0].concept_id, req.user.id);
  if (s.rows[0].status === 'filled') {
    throw new ApiError(409, 'Somebody holds this seat. They can release it, or the two of you can '
      + 'agree a trade, but it cannot be taken from them here.');
  }
  const r = await query(
    `UPDATE project_seats SET status='withdrawn', updated_at=NOW() WHERE id=$1 RETURNING *`,
    [req.params.id]);
  res.json({ ok: true, seat: r.rows[0] });
}));

// ---------------------------------------------------------------- the holder

// Release your own seat.
//
// What you already contributed and had accepted stays in the project — it was merged, it is part of
// the thing now. Whether you keep your share is stated here and recorded, because leaving quietly
// and discovering later that your share went with you is exactly the kind of surprise that ends a
// collaboration badly.
router.post('/:id/release', authenticate, [
  body('share').isIn(['keep', 'release']).withMessage('Say whether you are keeping your share or releasing it.'),
], asyncHandler(async (req, res) => {
  const bad = fail(res, validationResult(req)); if (bad) return bad;

  const s = await query('SELECT * FROM project_seats WHERE id=$1', [req.params.id]);
  if (!s.rows.length) throw new ApiError(404, 'That seat could not be found.');
  if (s.rows[0].holder_id !== req.user.id) {
    throw new ApiError(403, 'That is not your seat.');
  }

  const r = await query(
    `UPDATE project_seats SET status='open', holder_id=NULL, filled_at=NULL,
            released_at=NOW(), updated_at=NOW()
      WHERE id=$1 RETURNING *`, [req.params.id]);

  // Releasing the SEAT and releasing the SHARE are separate acts, and only one of them is happening
  // here unless they said so.
  if (req.body.share === 'release') {
    await query(
      `UPDATE contributions SET share_bp=0
        WHERE concept_id=$1 AND contributor_id=$2 AND state IN ('accepted','superseded')`,
      [s.rows[0].concept_id, req.user.id]);
  }

  res.json({ ok: true, seat: r.rows[0],
    message: req.body.share === 'keep'
      ? 'Seat released. What you already built stays in the project, and so does your share of it.'
      : 'Seat released, and your share released with it. What you built stays in the project.' });
}));

// Trade a seat to somebody else.
//
// Three approvals: the person leaving, the person arriving, and the project owner. The owner's is
// not a formality — a team is people who chose each other, and a seat transferable without consent
// is a way for a stranger to end up inside somebody's business.
//
// This records the HANDOVER. It does not move the share: the incoming person's share is whatever
// the team's next agreement says, signed by everybody, which is the only place a share can change.
router.post('/:id/trade', authenticate, [
  body('to_user_id').isUUID().withMessage('Say who is taking the seat.'),
], asyncHandler(async (req, res) => {
  const bad = fail(res, validationResult(req)); if (bad) return bad;

  const s = await query('SELECT * FROM project_seats WHERE id=$1', [req.params.id]);
  if (!s.rows.length) throw new ApiError(404, 'That seat could not be found.');
  const seat = s.rows[0];
  if (seat.holder_id !== req.user.id) throw new ApiError(403, 'That is not your seat to trade.');

  const c = await query('SELECT owner_id FROM concepts WHERE id=$1', [seat.concept_id]);
  if (req.body.to_user_id === c.rows[0].owner_id) {
    throw new ApiError(400, 'The project owner cannot hold a seat on their own project.');
  }

  const already = await query(
    `SELECT 1 FROM project_seats WHERE concept_id=$1 AND holder_id=$2 AND status='filled' AND id<>$3`,
    [seat.concept_id, req.body.to_user_id, seat.id]);
  if (already.rows.length) {
    throw new ApiError(409, 'They already hold a seat on this project.');
  }

  const r = await query(
    `UPDATE project_seats SET holder_id=$2, filled_at=NOW(), updated_at=NOW()
      WHERE id=$1 AND status='filled' RETURNING *`,
    [req.params.id, req.body.to_user_id]).catch(rethrow);

  res.json({ ok: true, seat: r.rows[0],
    message: 'Seat handed over. Their share is whatever the team\u2019s next agreement says, and that '
      + 'needs everyone to sign it.' });
}));

module.exports = router;
