const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const { sendEmail } = require('../services/email');
const { welcomeEmail } = require('../services/welcomeEmail');
const { parseCookies } = require('../lib/cookies');
const COOKIE_V = 'ypl_v';

const router = express.Router();

async function recordLogin(req, { userId = null, email, success, reason = null }) {
  try {
    await query(
      `INSERT INTO login_activity (user_id, email, success, ip_address, user_agent, reason)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, email || null, success, req.ip || null, req.get('user-agent') || null, reason]
    );
  } catch (e) { console.error('login_activity insert failed:', e.message); }
}

function issueTokens(user) {
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  return {
    accessToken: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '2h' }),
    refreshToken: jwt.sign({ id: user.id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d' }),
  };
}

// POST /api/auth/register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password, name } = req.body;
  const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
  if (existing.rows.length) return res.status(409).json({ error: 'Account already exists.' });

  const passwordHash = await bcrypt.hash(password, 12);

  // Create the user and their profile atomically — a failure on either side must
  // never leave a half-created account (as a missing table grant once did).
  const client = await getClient();
  let user;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO users (email, password_hash, name, role, status, created_at)
       VALUES ($1,$2,$3,'member','active',NOW())
       RETURNING id, email, name, role, status`,
      [email, passwordHash, name]
    );
    user = result.rows[0];
    await client.query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  await recordLogin(req, { userId: user.id, email, success: true, reason: 'register' });

  // Carry in the idea this visitor handed Clay before they had an account, if any.
  // Best-effort — it never blocks or fails signup.
  try {
    const token = parseCookies(req)[COOKIE_V];
    if (token) {
      const spark = await query(
        'SELECT idea FROM anon_sparks WHERE token=$1 AND claimed_by IS NULL ORDER BY created_at DESC LIMIT 1', [token]);
      if (spark.rows.length) {
        await query('UPDATE users SET pending_idea=$2 WHERE id=$1', [user.id, spark.rows[0].idea]);
        await query('UPDATE anon_sparks SET claimed_by=$2 WHERE token=$1 AND claimed_by IS NULL', [token, user.id]);
        user.pending_idea = spark.rows[0].idea;
      }
    }
  } catch (e) { console.error('spark carry-in failed:', e.message); }

  // Best-effort welcome email from Clay — never blocks or fails signup.
  try {
    const msg = welcomeEmail(user.name);
    const sent = await sendEmail({ to: user.email, subject: msg.subject, html: msg.html, text: msg.text });
    if (!sent || !sent.sent) console.error('welcome email not sent:', sent && sent.reason);
    await query(
      `INSERT INTO email_log (to_email, kind, sent, reason, provider_id)
       VALUES ($1,'welcome',$2,$3,$4)`,
      [user.email, !!(sent && sent.sent), (sent && sent.reason) || null, (sent && sent.id) || null]
    ).catch((e) => console.error('email_log insert failed:', e.message));
  } catch (e) { console.error('welcome email error:', e.message); }

  res.status(201).json({ user, ...issueTokens(user) });
}));

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  const result = await query('SELECT id,email,name,role,status,password_hash FROM users WHERE email=$1', [email]);
  const user = result.rows[0];
  if (!user || !user.password_hash) {
    await recordLogin(req, { email, success: false, reason: 'no_user' });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await recordLogin(req, { userId: user.id, email, success: false, reason: 'bad_password' });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended.' });
  delete user.password_hash;
  await recordLogin(req, { userId: user.id, email, success: true });
  res.json({ user, ...issueTokens(user) });
}));

// POST /api/auth/refresh
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required.' });
  let decoded;
  try { decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET); }
  catch (_) { return res.status(401).json({ error: 'Invalid or expired refresh token.' }); }
  const r = await query('SELECT id,email,name,role FROM users WHERE id=$1', [decoded.id]);
  if (!r.rows.length) return res.status(401).json({ error: 'Account not found.' });
  res.json(issueTokens(r.rows[0]));
}));

// GET /api/auth/me
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT u.id,u.email,u.name,u.role,u.status,
            p.about_me,p.show_concepts,p.show_completed,p.show_listings
     FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=$1`, [req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Not found.' });
  res.json({ user: r.rows[0] });
}));

// POST /api/auth/logout  (stateless JWT — client discards tokens)
router.post('/logout', authenticate, (req, res) => res.json({ ok: true }));

module.exports = router;
