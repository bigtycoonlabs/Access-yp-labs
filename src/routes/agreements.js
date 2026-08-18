// AGREEMENTS — the split a team writes for itself.
//
// The platform does not decide what people's work is worth to each other. Earlier drafts had it
// computing weights from asset kinds, and that was wrong: a team knows what the demo was worth
// against the marketing better than any table does.
//
// What the platform guarantees is narrow and absolute:
//
//   the shares add up to the whole seller side, no more and no less
//   every member has signed
//   nobody is below a floor, because a 0.5% share is a way of getting work for nothing
//     while looking fair
//   the terms were readable before anybody joined
//   once the listing is live, nothing changes — the split a buyer sees is the split that pays
//
// Everything else is theirs. A team that wants an even split gets one; a team that wants to give
// the person who built the demo half of it can do that, and the platform's job is to make sure
// everyone signed it knowing.
//
// SUGGESTED, NEVER IMPOSED. There is a proposed starting point below and it is a starting point.
// Most teams will take it. The ones who do not have a reason, and it is theirs to have.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// A share this small is not participation. It is a way of getting somebody's work for nothing while
// the paperwork looks fair, and it is the single most likely way this mechanic gets abused.
const FLOOR_BP = 100;   // 1%

function fail(res, errs) {
  return errs.isEmpty() ? null : res.status(400).json({ errors: errs.array() });
}

async function conceptOf(id) {
  const r = await query('SELECT id, owner_id, title FROM concepts WHERE id=$1', [id]);
  if (!r.rows.length) throw new ApiError(404, 'That project could not be found.');
  return r.rows[0];
}

// Everybody with a stake: the owner, whoever holds a seat, and whoever has had work accepted.
// ONE ROW PER PERSON, not one per way they are involved.
//
// Caught by reading the rendered team space: somebody holding a seat who also had work accepted
// appeared twice — "ts1a holds a seat" AND "ts1a contributed work". Cosmetic on the screen and
// serious underneath, because this list is what the agreement validator uses to decide who must be
// named and who must sign. A duplicated person would have been asked to sign twice and had their
// shares counted twice against the 100%.
//
// The DISTINCT did not help: the rows differ by role, so both survived it. Roles are ranked instead
// and the strongest one wins, owner over seat over contributor.
async function teamOf(conceptId) {
  const r = await query(
    `SELECT DISTINCT ON (u.id) u.id, COALESCE(u.display_name, u.name, 'no name yet') AS name, r.role
       FROM (
         SELECT owner_id AS uid, 'owner' AS role FROM concepts WHERE id=$1
         UNION
         SELECT holder_id, 'seat' FROM project_seats
          WHERE concept_id=$1 AND status='filled' AND holder_id IS NOT NULL
         UNION
         SELECT contributor_id, 'contributor' FROM contributions
          WHERE concept_id=$1 AND state IN ('accepted','superseded')
       ) r JOIN users u ON u.id = r.uid
      ORDER BY u.id, CASE r.role WHEN 'owner' THEN 1 WHEN 'seat' THEN 2 ELSE 3 END`,
    [conceptId]);
  return r.rows;
}

// Is this project's split locked? A listing that is live or sold cannot have its terms rewritten:
// the split a buyer sees is the split that pays, and nothing changes mid-sale.
async function isLocked(conceptId) {
  const r = await query(
    `SELECT 1 FROM listings WHERE concept_id=$1 AND status IN ('live','sold') LIMIT 1`, [conceptId]);
  return r.rows.length > 0;
}

// A starting point, not a rule. Even across everyone who has a stake, which is the split most teams
// mean when they say "fair" and the one they can most easily argue away from.
function suggest(team) {
  if (!team.length) return [];
  const each = Math.floor(10000 / team.length);
  const shares = team.map((m) => ({ user_id: m.id, role: m.role, share_bp: each }));
  shares[0].share_bp += 10000 - each * team.length;   // the remainder goes somewhere, visibly
  return shares;
}

// ---------------------------------------------------------------- reading

router.get('/project/:conceptId', authenticate, asyncHandler(async (req, res) => {
  await conceptOf(req.params.conceptId);
  const team = await teamOf(req.params.conceptId);
  const cur = await query(
    `SELECT * FROM team_agreements WHERE concept_id=$1 ORDER BY version DESC LIMIT 1`,
    [req.params.conceptId]);
  const history = await query(
    `SELECT id, version, state, created_at FROM team_agreements
      WHERE concept_id=$1 ORDER BY version DESC`, [req.params.conceptId]);

  let signatures = [];
  if (cur.rows.length) {
    const s = await query(
      `SELECT g.user_id, g.signed_at, COALESCE(u.display_name, u.name) AS name
         FROM agreement_signatures g JOIN users u ON u.id = g.user_id
        WHERE g.agreement_id=$1`, [cur.rows[0].id]);
    signatures = s.rows;
  }

  const signed = new Set(signatures.map((s) => s.user_id));
  res.json({
    ok: true,
    team,
    agreement: cur.rows[0] || null,
    signatures,
    // Named, not counted. "Waiting on 2 people" is a fact nobody can act on; "waiting on Rel and
    // Tonya" is one somebody can go and chase.
    waiting_on: cur.rows.length && cur.rows[0].state === 'proposed'
      ? team.filter((m) => !signed.has(m.id)).map((m) => m.name) : [],
    history: history.rows,
    locked: await isLocked(req.params.conceptId),
    suggested: suggest(team),
    floor_bp: FLOOR_BP,
  });
}));

// ---------------------------------------------------------------- proposing

router.post('/project/:conceptId', authenticate, [
  body('terms').isArray({ min: 1 }).withMessage('An agreement needs at least one person in it.'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 2000 }),
], asyncHandler(async (req, res) => {
  const bad = fail(res, validationResult(req)); if (bad) return bad;

  const concept = await conceptOf(req.params.conceptId);
  const team = await teamOf(req.params.conceptId);
  const isMember = team.some((m) => m.id === req.user.id);
  if (!isMember) throw new ApiError(403, 'Only somebody on this project can propose its terms.');

  if (await isLocked(req.params.conceptId)) {
    throw new ApiError(409, 'This project is live on the Exchange, so its split is locked. The split '
      + 'a buyer sees is the split that pays. Take the listing down first if the team needs to '
      + 'change it.');
  }

  const terms = req.body.terms;
  const ids = terms.map((t) => t.user_id);
  const teamIds = new Set(team.map((m) => m.id));

  // Nobody with a stake can be left out, and nobody outside the team can be written in.
  for (const id of ids) {
    if (!teamIds.has(id)) throw new ApiError(400, 'That agreement names somebody who is not on this project.');
  }
  for (const m of team) {
    if (!ids.includes(m.id)) {
      throw new ApiError(400, m.name + ' is on this project and is not in the agreement. Everybody '
        + 'with a stake has to be named, even at zero, so nobody is left out silently.');
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(400, 'Somebody appears twice in that agreement.');
  }

  const total = terms.reduce((a, t) => a + Number(t.share_bp || 0), 0);
  if (total !== 10000) {
    throw new ApiError(400, 'The shares add up to ' + (total / 100) + '% of the seller side. They '
      + 'have to add up to exactly 100%, no more and no less. Nothing was saved.');
  }

  const low = terms.find((t) => Number(t.share_bp) > 0 && Number(t.share_bp) < FLOOR_BP);
  if (low) {
    const who = (team.find((m) => m.id === low.user_id) || {}).name || 'Somebody';
    throw new ApiError(400, who + ' is down for ' + (Number(low.share_bp) / 100) + '%. Anything '
      + 'under ' + (FLOOR_BP / 100) + '% is not really a share — if they are on this project, give '
      + 'them a real one, and if they are not, take them off it.');
  }

  const v = await query(
    'SELECT COALESCE(MAX(version),0) + 1 AS next FROM team_agreements WHERE concept_id=$1',
    [req.params.conceptId]);

  await query(
    `UPDATE team_agreements SET state='superseded'
      WHERE concept_id=$1 AND state IN ('proposed','signed')`, [req.params.conceptId]);

  const r = await query(
    `INSERT INTO team_agreements (concept_id, version, terms, note, proposed_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.conceptId, v.rows[0].next, JSON.stringify(terms),
      (req.body.note || '').trim() || null, req.user.id]);

  // The proposer has signed by proposing. Everyone else has to say yes for themselves.
  await query(
    'INSERT INTO agreement_signatures (agreement_id, user_id) VALUES ($1,$2)',
    [r.rows[0].id, req.user.id]);

  res.status(201).json({ ok: true, agreement: r.rows[0],
    message: 'Proposed, and you have signed it. It takes effect when everybody else has too. Any '
      + 'earlier version stays readable, so the team can always see what was agreed and when.' });
}));

// ---------------------------------------------------------------- signing

router.post('/:id/sign', authenticate, asyncHandler(async (req, res) => {
  const a = await query('SELECT * FROM team_agreements WHERE id=$1', [req.params.id]);
  if (!a.rows.length) throw new ApiError(404, 'That agreement could not be found.');
  const agreement = a.rows[0];
  if (agreement.state === 'superseded') {
    throw new ApiError(409, 'That version has been replaced by a newer one. Read the current one '
      + 'before you sign anything.');
  }
  if (agreement.state === 'withdrawn') throw new ApiError(409, 'That agreement was withdrawn.');

  const team = await teamOf(agreement.concept_id);
  if (!team.some((m) => m.id === req.user.id)) {
    throw new ApiError(403, 'Only somebody on this project can sign its terms.');
  }

  await query(
    `INSERT INTO agreement_signatures (agreement_id, user_id) VALUES ($1,$2)
     ON CONFLICT (agreement_id, user_id) DO NOTHING`, [agreement.id, req.user.id]);

  const s = await query(
    'SELECT user_id FROM agreement_signatures WHERE agreement_id=$1', [agreement.id]);
  const signed = new Set(s.rows.map((x) => x.user_id));
  const missing = team.filter((m) => !signed.has(m.id));

  if (!missing.length) {
    await query(`UPDATE team_agreements SET state='signed' WHERE id=$1`, [agreement.id]);
  }

  res.json({ ok: true,
    signed_by_everyone: !missing.length,
    waiting_on: missing.map((m) => m.name),
    message: missing.length
      ? 'Signed. Still waiting on ' + missing.map((m) => m.name).join(' and ') + '.'
      : 'Signed by everyone. These are the team\u2019s terms now.' });
}));

// A proposer can pull their own proposal back while people are still reading it. Nobody can
// withdraw one that everybody already signed — that would be changing terms under people.
router.post('/:id/withdraw', authenticate, asyncHandler(async (req, res) => {
  const a = await query('SELECT * FROM team_agreements WHERE id=$1', [req.params.id]);
  if (!a.rows.length) throw new ApiError(404, 'That agreement could not be found.');
  if (a.rows[0].proposed_by !== req.user.id) {
    throw new ApiError(403, 'Only the person who proposed this can pull it back.');
  }
  if (a.rows[0].state !== 'proposed') {
    throw new ApiError(409, 'That is already settled. Propose a new version instead, and everybody '
      + 'signs again.');
  }
  const r = await query(
    `UPDATE team_agreements SET state='withdrawn' WHERE id=$1 RETURNING *`, [req.params.id]);
  res.json({ ok: true, agreement: r.rows[0] });
}));

module.exports = router;
