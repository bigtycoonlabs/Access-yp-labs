const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const { sendEmail } = require('../services/email');

// THE LAUNCH PARTNER BOARD — for projects that are NOT for sale.
//
// Most people building anything are doing it alone, and being alone is what usually stops them. A
// creator posts what they're building and the help they want; anyone can raise their hand; the
// creator decides. For an unlisted project the two settle their own terms — money, equity, hours,
// nothing at all — privately between themselves. The platform introduces them and is not a party to
// whatever they agree.
//
// Three rules hold this together:
//   1. NOBODY'S CONTACT DETAILS MOVE BY BROWSING. Emails are exchanged only when a creator accepts.
//   2. The board shows pen names, not real names — the same private identity used across the market.
//   3. It is not a feed. One ask per project, one hand per person, no comments. Almost nothing to
//      moderate, by design.

const router = express.Router();

const NEEDS = ['marketing', 'development', 'design', 'business advice', 'coaching',
  'training', 'staffing', 'operations', 'sales', 'something else'];
const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

function cleanNeeds(input) {
  if (!Array.isArray(input)) return [];
  return input.map((x) => String(x || '').toLowerCase().trim()).filter((x) => NEEDS.includes(x)).slice(0, 6);
}

// GET /api/partners/needs — the vocabulary, so the client and Clay stay in step with the server.
router.get('/needs', (req, res) => res.json({ needs: NEEDS }));

// GET /api/partners/board — open asks. Public to signed-in people; pen names only, no contact details.
router.get('/board', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT pr.id, pr.needs, pr.summary, pr.arrangement, pr.created_at,
            c.title, c.category,
            COALESCE(NULLIF(u.display_name,''), 'A creator') AS creator,
            (pr.owner_id = $1) AS mine,
            EXISTS (SELECT 1 FROM partner_interest pi
                     WHERE pi.request_id = pr.id AND pi.user_id = $1) AS already_raised,
            (SELECT count(*) FROM partner_interest pi WHERE pi.request_id = pr.id)::int AS hands
       FROM partner_requests pr
       JOIN concepts c ON c.id = pr.concept_id
       JOIN users u    ON u.id = pr.owner_id
      WHERE pr.status = 'open'
      ORDER BY pr.created_at DESC
      LIMIT 60`, [req.user.id]);
  res.json({ requests: r.rows });
}));

// POST /api/partners/requests — post (or revise) the ask for one of your own projects.
router.post('/requests', authenticate, [
  body('concept_id').isUUID(),
  body('summary').isString().isLength({ min: 20, max: 2000 }),
  body('arrangement').optional().isString().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const own = await query('SELECT id, title FROM concepts WHERE id=$1 AND owner_id=$2',
    [req.body.concept_id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'That project is not yours, or does not exist.');

  const needs = cleanNeeds(req.body.needs);
  if (!needs.length) throw new ApiError(400, 'Choose at least one kind of help you are looking for.');

  const r = await query(
    `INSERT INTO partner_requests (concept_id, owner_id, needs, summary, arrangement, status)
     VALUES ($1,$2,$3,$4,$5,'open')
     ON CONFLICT (concept_id) DO UPDATE SET
       needs=EXCLUDED.needs, summary=EXCLUDED.summary, arrangement=EXCLUDED.arrangement,
       status='open', updated_at=now()
     RETURNING id, status`,
    [req.body.concept_id, req.user.id, needs, req.body.summary.trim(),
     (req.body.arrangement || '').trim() || null]);
  res.status(201).json({ request: r.rows[0] });
}));

// POST /api/partners/requests/:id/close — take your ask down.
router.post('/requests/:id/close', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE partner_requests SET status='closed', updated_at=now()
      WHERE id=$1 AND owner_id=$2 RETURNING id`, [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'That ask is not yours, or is already closed.');
  res.json({ closed: r.rows[0].id });
}));

// POST /api/partners/requests/:id/interest — raise your hand. The creator is told; your email is not.
router.post('/requests/:id/interest', authenticate, [
  body('offer').isString().isLength({ min: 20, max: 1500 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const pr = await query(
    `SELECT pr.id, pr.owner_id, c.title, u.email AS owner_email,
            COALESCE(NULLIF(u.name,''),'there') AS owner_name
       FROM partner_requests pr JOIN concepts c ON c.id=pr.concept_id JOIN users u ON u.id=pr.owner_id
      WHERE pr.id=$1 AND pr.status='open'`, [req.params.id]);
  if (!pr.rows.length) throw new ApiError(404, 'That ask is not open.');
  const request = pr.rows[0];
  if (request.owner_id === req.user.id) throw new ApiError(400, 'This is your own project.');

  let row;
  try {
    const r = await query(
      `INSERT INTO partner_interest (request_id, user_id, offer) VALUES ($1,$2,$3) RETURNING id`,
      [req.params.id, req.user.id, req.body.offer.trim()]);
    row = r.rows[0];
  } catch (e) {
    if (e && e.code === '23505') throw new ApiError(409, 'You have already offered to help with this one.');
    throw e;
  }

  // Tell the creator someone raised their hand — WITHOUT handing over the volunteer's contact details.
  await sendEmail({
    to: request.owner_email,
    subject: `Someone wants to help with ${request.title}`,
    text: `Hi ${request.owner_name},\n\nSomeone on Access YP Labs read your ask for ${request.title} and `
      + `offered to help. You decide whether to take them up on it — nothing is shared with them, and no `
      + `contact details are exchanged, unless you accept.\n\nRead what they offered: ${SITE()}/partners.html\n\n— Clay`,
  }).catch(() => {});

  res.status(201).json({ interest: row, note: 'The creator has been told. Your contact details were not shared.' });
}));

// GET /api/partners/mine — your asks with the hands raised, and the offers you have made.
router.get('/mine', authenticate, asyncHandler(async (req, res) => {
  const asks = await query(
    `SELECT pr.id, pr.needs, pr.summary, pr.status, c.title,
            (SELECT count(*) FROM partner_interest pi WHERE pi.request_id=pr.id AND pi.status='pending')::int AS pending
       FROM partner_requests pr JOIN concepts c ON c.id=pr.concept_id
      WHERE pr.owner_id=$1 ORDER BY pr.created_at DESC`, [req.user.id]);

  const offers = await query(
    `SELECT pi.id, pi.offer, pi.status, pi.created_at, c.title
       FROM partner_interest pi
       JOIN partner_requests pr ON pr.id=pi.request_id
       JOIN concepts c ON c.id=pr.concept_id
      WHERE pi.user_id=$1 ORDER BY pi.created_at DESC`, [req.user.id]);

  const hands = await query(
    `SELECT pi.id, pi.offer, pi.status, pi.created_at, pi.request_id, c.title,
            COALESCE(NULLIF(u.display_name,''),'A creator') AS from_creator
       FROM partner_interest pi
       JOIN partner_requests pr ON pr.id=pi.request_id
       JOIN concepts c ON c.id=pr.concept_id
       JOIN users u ON u.id=pi.user_id
      WHERE pr.owner_id=$1 ORDER BY pi.created_at DESC`, [req.user.id]);

  res.json({ asks: asks.rows, offers: offers.rows, hands: hands.rows });
}));

// POST /api/partners/interest/:id/:decision — the creator accepts or declines.
// On ACCEPT, and only then, the two are introduced to each other by email.
router.post('/interest/:id/:decision', authenticate, asyncHandler(async (req, res) => {
  const accept = req.params.decision === 'accept';
  if (!['accept', 'decline'].includes(req.params.decision)) throw new ApiError(400, 'Unknown decision.');

  const found = await query(
    `SELECT pi.id, pi.status, pi.offer, c.title,
            helper.email AS helper_email, COALESCE(NULLIF(helper.display_name,''),'A creator') AS helper_alias,
            owner.email  AS owner_email,  COALESCE(NULLIF(owner.display_name,''),'A creator')  AS owner_alias
       FROM partner_interest pi
       JOIN partner_requests pr ON pr.id = pi.request_id
       JOIN concepts c  ON c.id = pr.concept_id
       JOIN users helper ON helper.id = pi.user_id
       JOIN users owner  ON owner.id  = pr.owner_id
      WHERE pi.id = $1 AND pr.owner_id = $2 AND pi.status = 'pending'`,
    [req.params.id, req.user.id]);
  if (!found.rows.length) throw new ApiError(404, 'That offer is not yours to answer, or has already been answered.');
  const it = found.rows[0];

  await query(`UPDATE partner_interest SET status=$2, responded_at=now() WHERE id=$1`,
    [req.params.id, accept ? 'accepted' : 'declined']);

  if (!accept) {
    await sendEmail({
      to: it.helper_email,
      subject: `About ${it.title}`,
      text: `Hi,\n\nThe creator of ${it.title} has decided not to take up your offer of help this time. `
        + `Nothing was shared about you beyond what you wrote.\n\nThat is not a judgement of you — people `
        + `turn down help for all sorts of reasons. There are other projects looking: ${SITE()}/partners.html\n\n— Clay`,
    }).catch(() => {});
    return res.json({ status: 'declined' });
  }

  // Accepted: introduce them to each other, and be explicit that the terms are theirs alone.
  const terms = `You two arrange how you work together — hours, money, equity, or nothing at all. `
    + `Access YP Labs is not part of that agreement and holds no responsibility for how it goes. `
    + `Put whatever you agree in writing between yourselves.`;
  await sendEmail({
    to: it.owner_email,
    subject: `You accepted help on ${it.title}`,
    text: `Hi,\n\nYou accepted an offer of help on ${it.title} from ${it.helper_alias}. `
      + `You can reach them at ${it.helper_email}.\n\n${terms}\n\n— Clay`,
  }).catch(() => {});
  await sendEmail({
    to: it.helper_email,
    subject: `Your offer to help with ${it.title} was accepted`,
    text: `Hi,\n\n${it.owner_alias} accepted your offer to help with ${it.title}. `
      + `You can reach them at ${it.owner_email}.\n\n${terms}\n\n— Clay`,
  }).catch(() => {});

  res.json({ status: 'accepted', note: 'You have both been introduced by email. The terms are yours to agree.' });
}));

module.exports = router;
