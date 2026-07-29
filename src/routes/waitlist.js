const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const router = express.Router();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function refCode() { return crypto.randomUUID().replace(/-/g, '').slice(0, 8); }

// A concept accepts public waitlist signups only once it is publicly discoverable
// (it has a live listing) — that's where the public page lives, and it keeps
// people from spraying signups at arbitrary concept ids.
async function conceptIsPublic(conceptId) {
  const r = await query("SELECT 1 FROM listings WHERE concept_id=$1 AND status='live' LIMIT 1", [conceptId]);
  return r.rows.length > 0;
}

// POST /api/waitlist/:conceptId  { email, name?, ref? }  — PUBLIC, no account.
// Someone raising their hand for the business this concept describes.
router.post('/:conceptId', asyncHandler(async (req, res) => {
  const conceptId = req.params.conceptId;
  const email = (req.body && typeof req.body.email === 'string') ? req.body.email.trim().toLowerCase() : '';
  const name = (req.body && typeof req.body.name === 'string') ? req.body.name.trim().slice(0, 80) : null;
  const ref = (req.body && typeof req.body.ref === 'string') ? req.body.ref.trim().slice(0, 16) : null;
  if (!EMAIL_RE.test(email) || email.length > 200) throw new ApiError(400, 'Please enter a valid email address.');
  if (!(await conceptIsPublic(conceptId))) throw new ApiError(404, 'This concept is not open for signups.');

  // Idempotent: a repeat signup is not an error — we just tell them they're in.
  const ins = await query(
    `INSERT INTO waitlist_signups (concept_id, email, name, ref_code, referred_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (concept_id, email) DO NOTHING
     RETURNING ref_code`,
    [conceptId, email, name || null, refCode(), ref || null]);
  const already = ins.rows.length === 0;
  const myCode = already
    ? (await query('SELECT ref_code FROM waitlist_signups WHERE concept_id=$1 AND email=$2', [conceptId, email])).rows[0].ref_code
    : ins.rows[0].ref_code;
  const cnt = await query('SELECT COUNT(*)::int AS n FROM waitlist_signups WHERE concept_id=$1', [conceptId]);
  res.status(already ? 200 : 201).json({
    joined: true,
    already,
    count: cnt.rows[0].n,
    ref_code: myCode,
    message: already ? "You're already on this waitlist." : "You're on the waitlist.",
  });
}));

// GET /api/waitlist/:conceptId/count  — PUBLIC. Aggregate only, never emails.
router.get('/:conceptId/count', asyncHandler(async (req, res) => {
  const conceptId = req.params.conceptId;
  if (!(await conceptIsPublic(conceptId))) return res.json({ count: 0, public: false });
  const cnt = await query('SELECT COUNT(*)::int AS n FROM waitlist_signups WHERE concept_id=$1', [conceptId]);
  res.json({ count: cnt.rows[0].n, public: true });
}));

// GET /api/waitlist/:conceptId  — OWNER ONLY. The captured demand, as an asset.
// Scoped by concept ownership, so when a concept is sold the new owner sees the
// waitlist automatically — the demand travels with the concept.
router.get('/:conceptId', authenticate, asyncHandler(async (req, res) => {
  const conceptId = req.params.conceptId;
  const own = await query('SELECT 1 FROM concepts WHERE id=$1 AND owner_id=$2', [conceptId, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  const rows = await query(
    `SELECT email, name, referred_by, created_at
     FROM waitlist_signups WHERE concept_id=$1 ORDER BY created_at DESC`, [conceptId]);
  res.json({ count: rows.rows.length, signups: rows.rows });
}));

module.exports = router;
module.exports.EMAIL_RE = EMAIL_RE;
module.exports.refCode = refCode;
