const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { sendBatch } = require('../services/email');
const router = express.Router();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function refCode() { return crypto.randomUUID().replace(/-/g, '').slice(0, 8); }
function clientUrl() { return (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/$/, ''); }
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A concept accepts public waitlist signups once it is publicly discoverable — either it has a
// live sale listing, OR the creator has published a coming-soon launch page for it. Either way
// there's a real public page raising its hand, so signups are grounded and can't be sprayed at
// arbitrary concept ids.
async function conceptIsPublic(conceptId) {
  const r = await query(
    `SELECT 1 FROM listings WHERE concept_id=$1 AND status='live'
     UNION ALL
     SELECT 1 FROM concepts WHERE id=$1 AND (launch_page->>'enabled')='true'
     LIMIT 1`, [conceptId]);
  return r.rows.length > 0;
}

// POST /api/waitlist/leave  { ref_code }  — PUBLIC unsubscribe. Declared before
// the /:conceptId routes so "leave" isn't captured as a concept id.
router.post('/leave', asyncHandler(async (req, res) => {
  const code = (req.body && typeof req.body.ref_code === 'string') ? req.body.ref_code.trim() : '';
  if (!code) throw new ApiError(400, 'Missing unsubscribe code.');
  await query('DELETE FROM waitlist_signups WHERE ref_code=$1', [code]);
  // Always report success — we don't reveal whether the code existed.
  res.json({ left: true });
}));

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

// POST /api/waitlist/:conceptId/launch  { subject, message, url? }  — OWNER ONLY.
// The payoff: tell everyone who raised their hand that the business is now live.
router.post('/:conceptId/launch', authenticate, asyncHandler(async (req, res) => {
  const conceptId = req.params.conceptId;
  const subject = (req.body && typeof req.body.subject === 'string') ? req.body.subject.trim() : '';
  const message = (req.body && typeof req.body.message === 'string') ? req.body.message.trim() : '';
  const url = (req.body && typeof req.body.url === 'string') ? req.body.url.trim() : '';
  if (subject.length < 3 || subject.length > 150) throw new ApiError(400, 'Give your announcement a subject line (3 to 150 characters).');
  if (message.length < 10 || message.length > 5000) throw new ApiError(400, 'Write a message between 10 and 5000 characters.');
  if (url && !/^https?:\/\//i.test(url)) throw new ApiError(400, 'The link must start with http:// or https://.');

  const own = await query('SELECT title FROM concepts WHERE id=$1 AND owner_id=$2', [conceptId, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');

  // Claim the one-launch-per-concept slot atomically — a double-click or retry
  // can never blast the same list twice.
  const claim = await query(
    `INSERT INTO waitlist_launches (concept_id, sender_id, subject)
     VALUES ($1,$2,$3) ON CONFLICT (concept_id) DO NOTHING RETURNING id`,
    [conceptId, req.user.id, subject]);
  if (!claim.rows.length) throw new ApiError(409, 'You have already sent a launch announcement for this concept.');
  const launchId = claim.rows[0].id;

  const signups = await query('SELECT email, name, ref_code FROM waitlist_signups WHERE concept_id=$1', [conceptId]);
  if (!signups.rows.length) {
    await query('DELETE FROM waitlist_launches WHERE id=$1', [launchId]);
    throw new ApiError(400, 'No one is on this waitlist yet, so there is no one to announce to.');
  }

  const base = clientUrl();
  const safeMsg = escapeHtml(message).replace(/\n/g, '<br>');
  const build = (row) => {
    const greeting = row.name ? `Hi ${escapeHtml(row.name)},` : 'Hi there,';
    const unsub = `${base}/unsubscribe.html?code=${encodeURIComponent(row.ref_code)}`;
    const cta = url ? `<p><a href="${escapeHtml(url)}">Visit it now</a></p>` : '';
    const html = `<div><p>${greeting}</p><p>${safeMsg}</p>${cta}<hr><p style="font-size:12px;color:#666">You're getting this because you joined the waitlist for this idea. <a href="${unsub}">Unsubscribe</a>.</p></div>`;
    const text = `${row.name ? 'Hi ' + row.name : 'Hi there'},\n\n${message}\n\n${url ? 'Visit it now: ' + url + '\n\n' : ''}You joined the waitlist for this idea. Unsubscribe: ${unsub}`;
    return { to: row.email, subject, html, text };
  };

  let sent = 0, failed = 0;
  const rows = signups.rows;
  for (let i = 0; i < rows.length; i += 100) {
    const r = await sendBatch(rows.slice(i, i + 100).map(build));
    sent += r.sent; failed += r.failed;
    if (r.reason === 'email_not_configured') {
      await query('DELETE FROM waitlist_launches WHERE id=$1', [launchId]);
      throw new ApiError(503, 'Email is not configured yet, so nothing was sent and nothing was recorded.');
    }
  }
  if (sent === 0) {
    await query('DELETE FROM waitlist_launches WHERE id=$1', [launchId]);
    throw new ApiError(502, 'The launch email could not be sent right now, so nothing went out and nothing was recorded. Please try again.');
  }

  await query('UPDATE waitlist_launches SET sent_count=$1 WHERE id=$2', [sent, launchId]);
  await query(
    'INSERT INTO email_log (to_email, kind, sent, reason, provider_id) VALUES ($1,$2,$3,$4,$5)',
    [`waitlist:${conceptId}`, 'waitlist_launch', sent > 0, `${sent} sent, ${failed} failed`, null]
  ).catch(() => {});

  res.json({ sent, failed, total: rows.length });
}));

module.exports = router;
module.exports.EMAIL_RE = EMAIL_RE;
module.exports.refCode = refCode;
