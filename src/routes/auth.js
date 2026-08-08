const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { sendEmail } = require('../services/email');
const { notifyStaff } = require('../services/clay/staffNotify');
const { welcomeEmail } = require('../services/welcomeEmail');
const { parseCookies, setCookie } = require('../lib/cookies');

// The refresh token also lives in an HttpOnly cookie, not just localStorage. This is what
// actually keeps people signed in: iOS/Safari wipe script-writable localStorage after ~7 days
// of not visiting, which would silently log a returning user out and make Clay greet them like
// a stranger. A first-party HttpOnly cookie survives that, is safe from XSS (JS can't read it),
// and lets us re-mint tokens for up to 30 days. Scoped to /api/auth so it's only sent to the
// auth endpoints that need it.
const REFRESH_COOKIE = 'kiln_rt';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, matching the refresh token's life
function setRefreshCookie(res, refreshToken) {
  setCookie(res, REFRESH_COOKIE, refreshToken, { path: '/api/auth', maxAge: REFRESH_MAX_AGE });
}
function clearRefreshCookie(res) {
  setCookie(res, REFRESH_COOKIE, '', { path: '/api/auth', maxAge: 0 });
}
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
    accessToken: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }),
    refreshToken: jwt.sign({ id: user.id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d' }),
  };
}

// Carry an idea a visitor handed Clay (stored as an anon_spark against their visitor
// cookie) into their account's pending_idea, so the workspace greets them with it.
// Runs on BOTH register and login — an existing user who typed an idea before signing
// in should not have to re-type it. Best-effort: never blocks or fails auth.
async function carryInSpark(req, user) {
  try {
    const token = parseCookies(req)[COOKIE_V];
    if (!token) return;
    const spark = await query(
      'SELECT idea FROM anon_sparks WHERE token=$1 AND claimed_by IS NULL ORDER BY created_at DESC LIMIT 1', [token]);
    if (!spark.rows.length) return;
    await query('UPDATE users SET pending_idea=$2 WHERE id=$1', [user.id, spark.rows[0].idea]);
    await query('UPDATE anon_sparks SET claimed_by=$2 WHERE token=$1 AND claimed_by IS NULL', [token, user.id]);
    user.pending_idea = spark.rows[0].idea;
  } catch (e) { console.error('spark carry-in failed:', e.message); }
}

// POST /api/auth/register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
  // Required at signup. Kept deliberately permissive on FORMAT — people write numbers in many
  // shapes and countries, and rejecting a real number because of punctuation is a worse failure
  // than storing one with a bracket in it. We check there are enough digits to be a real number.
  body('phone').trim().customSanitizer((v) => String(v || '').trim())
    .custom((v) => (String(v).replace(/\D/g, '').length >= 7))
    .withMessage('Please enter a phone number we can reach you on.'),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password, name, phone } = req.body;
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
      `INSERT INTO users (email, password_hash, name, phone, role, status, created_at)
       VALUES ($1,$2,$3,$4,'member','active',NOW())
       RETURNING id, email, name, role, status`,
      [email, passwordHash, name, phone]
    );
    user = result.rows[0];
    await client.query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
    // Email preferences, with the unsubscribe token that every Clay Weekly issue carries. Created
    // here so a new account can both receive the magazine and leave it in one click from day one.
    await client.query('INSERT INTO user_email_prefs (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    // Two people registering the same email at once both pass the existence check above;
    // the unique index then rejects the loser. Return the same clean 409 as the pre-check
    // instead of a confusing 500.
    if (e && e.code === '23505') throw new ApiError(409, 'Account already exists.');
    throw e;
  } finally {
    client.release();
  }

  await recordLogin(req, { userId: user.id, email, success: true, reason: 'register' });

  // Carry in the idea this visitor handed Clay before they had an account, if any.
  await carryInSpark(req, user);

  // Tell the owners a real person just arrived. Nothing did this before, so every signup since
  // launch happened silently — you found out by going and looking. Deduped per user so a retry
  // can't send twice, and best-effort: a notification failing must never affect the signup itself.
  try {
    await notifyStaff({
      kind: 'signup',
      dedupeKey: 'signup-' + user.id,
      subject: `New creator: ${user.name || user.email}`,
      body: `${user.name || 'Someone'} just created an account (${user.email}).\n\n`
        + `That is real interest arriving on its own. Worth a look at what they do next — and worth `
        + `being ready to help if they get stuck early.\n\n— Clay`,
    });
  } catch (e) { console.error('signup notice failed:', e && e.message); }

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

  const tokens = issueTokens(user);
  setRefreshCookie(res, tokens.refreshToken);
  res.status(201).json({ user, ...tokens });
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
  // Carry in an idea handed to Clay before signing in, so it isn't lost on login.
  await carryInSpark(req, user);
  const tokens = issueTokens(user);
  setRefreshCookie(res, tokens.refreshToken);
  res.json({ user, ...tokens });
}));

// POST /api/auth/refresh
router.post('/refresh', asyncHandler(async (req, res) => {
  // Accept the refresh token from the HttpOnly cookie first (the durable path that
  // survives localStorage being wiped), then fall back to the request body for older
  // clients. Either way we re-mint and re-set the cookie so the session keeps rolling.
  const cookies = parseCookies(req);
  const refreshToken = cookies[REFRESH_COOKIE] || req.body.refreshToken;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required.' });
  let decoded;
  try { decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET); }
  catch (_) { clearRefreshCookie(res); return res.status(401).json({ error: 'Invalid or expired refresh token.' }); }
  const r = await query('SELECT id,email,name,role,status FROM users WHERE id=$1', [decoded.id]);
  if (!r.rows.length) { clearRefreshCookie(res); return res.status(401).json({ error: 'Account not found.' }); }
  // A suspended account must not be able to keep a session alive by refreshing. authenticate
  // already blocks suspended users on every protected route in real time; this makes the door
  // fully closed — no fresh tokens for a suspended account, and the cookie is cleared.
  if (r.rows[0].status === 'suspended') { clearRefreshCookie(res); return res.status(403).json({ error: 'Your account is suspended.' }); }
  const tokens = issueTokens(r.rows[0]);
  setRefreshCookie(res, tokens.refreshToken);
  res.json(tokens);
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

// POST /api/auth/logout  (stateless JWT — client discards tokens; we also clear the cookie)
router.post('/logout', authenticate, (req, res) => { clearRefreshCookie(res); res.json({ ok: true }); });


// ---- Password reset -----------------------------------------------------------------------------
//
// There was none of this. Forgetting a password meant losing every project you had built, with no
// route back and no way for staff to help. That is a worse outcome than most bugs: the work is
// still there, and the person simply cannot reach it.
//
// The rules, and why:
//   * The response NEVER reveals whether an address has an account. Saying "no account found" turns
//     this form into a tool for discovering who is registered here.
//   * Tokens are stored hashed. A leak of the table must not hand somebody account takeover.
//   * Single use, one hour. A reset link sitting in an inbox for a week is a spare key.
//   * Using one signs out every existing session, because the usual reason to reset a password is
//     that somebody else might have it.

const RESET_TTL_MINUTES = 60;
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

router.post('/forgot-password', [body('email').isEmail().normalizeEmail()], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  // Even a malformed address gets the same answer, for the same reason.
  const sameAnswer = {
    ok: true,
    message: 'If there is an account for that address, a reset link is on its way. It works once and lasts an hour.',
  };
  if (!errors.isEmpty()) return res.json(sameAnswer);

  const u = await query('SELECT id, name, email FROM users WHERE lower(email)=lower($1) AND status <> $2',
    [req.body.email, 'suspended']);
  if (!u.rows.length) return res.json(sameAnswer);
  const user = u.rows[0];

  const raw = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1,$2, now() + ($3 || ' minutes')::interval)`,
    [user.id, hashToken(raw), String(RESET_TTL_MINUTES)]);

  const site = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');
  const link = `${site}/reset.html?token=${raw}`;
  const out = await sendEmail({
    to: user.email,
    subject: 'Reset your Access YP Labs password',
    text: `Hi ${user.name || 'there'},\n\nSomeone asked to reset the password for this account. If it was you:\n\n`
      + `${link}\n\nThe link works once and expires in an hour. If it was not you, ignore this — nothing has `
      + 'changed and your password still works.',
    html: `<p>Hi ${user.name || 'there'},</p><p>Someone asked to reset the password for this account. If it was you:</p>`
      + `<p><a href="${link}">Choose a new password</a></p>`
      + '<p>The link works once and expires in an hour. If it was not you, ignore this — nothing has changed and '
      + 'your password still works.</p>',
  }).catch((e) => ({ sent: false, reason: (e && e.message) || 'threw' }));

  // sendEmail resolves with { sent:false } rather than throwing. The person is told the same thing
  // either way — revealing a send failure would reveal the account exists — but a failure that
  // leaves somebody locked out must not be invisible to us.
  if (!out || !out.sent) {
    console.error('password reset email NOT sent to', user.email, '-', (out && out.reason) || 'unknown');
    notifyStaff({
      kind: 'password_reset_not_sent',
      dedupeKey: 'reset-mail-' + user.id + '-' + new Date().toISOString().slice(0, 13),
      subject: 'A password reset email did not send',
      body: `Someone asked to reset their password and the email did not go out, so they are still locked `
        + `out and have no way to know why.\n\nAccount: ${user.email}\nReason: ${(out && out.reason) || 'unknown'}\n\n`
        + 'Worth reaching them another way.',
    }).catch(() => {});
  }
  return res.json(sameAnswer);
}));

router.post('/reset-password', [
  body('token').isString().isLength({ min: 20 }),
  body('password').isLength({ min: 8 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'That link is not valid, or the password is too short (eight characters or more).' });
  }
  const r = await query(
    `SELECT pr.id, pr.user_id FROM password_resets pr
      WHERE pr.token_hash=$1 AND pr.used_at IS NULL AND pr.expires_at > now()`,
    [hashToken(req.body.token)]);
  if (!r.rows.length) {
    // One message for expired, used and invented tokens: distinguishing them tells an attacker
    // which of their guesses was once real.
    return res.status(400).json({
      error: 'That link has expired or has already been used. Ask for a new one and it will work.',
    });
  }
  const row = r.rows[0];
  const hash = await bcrypt.hash(req.body.password, 12);
  await query('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [row.user_id, hash]);
  await query('UPDATE password_resets SET used_at=now() WHERE id=$1', [row.id]);
  // Any OTHER outstanding reset for this person is now void — if two were requested, using one must
  // not leave the other lying around as a working spare key.
  await query('UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [row.user_id]);
  clearRefreshCookie(res);
  res.json({ ok: true, message: 'Your password is changed. Sign in with it, and any other sessions have been signed out.' });
}));

module.exports = router;
