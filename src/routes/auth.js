const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const generateTokens = (user) => {
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ id: user.id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN });
  return { accessToken, refreshToken };
};

// POST /api/auth/register  (client self-registration after wizard submission)
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password, name } = req.body;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password_hash, name, role, status, created_at)
       VALUES ($1, $2, $3, 'client', 'active', NOW())
       ON CONFLICT (email) DO UPDATE SET
         password_hash = CASE WHEN users.status = 'pending' AND users.password_hash IS NULL
           THEN EXCLUDED.password_hash ELSE users.password_hash END,
         name = CASE WHEN users.status = 'pending' AND users.password_hash IS NULL
           THEN EXCLUDED.name ELSE users.name END,
         status = CASE WHEN users.status = 'pending' AND users.password_hash IS NULL
           THEN 'active' ELSE users.status END
       RETURNING id, email, name, role, status, password_hash`,
      [email, passwordHash, name]
    );
    const user = result.rows[0];
    if (user.password_hash !== passwordHash) {
      return res.status(409).json({ error: 'Account already exists.' });
    }
    delete user.password_hash;
    const tokens = generateTokens(user);
    res.status(201).json({ user, ...tokens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  try {
    const result = await query(
      'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
      [email]
    );
    if (!result.rows.length || !result.rows[0].password_hash) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    const tokens = generateTokens(user);
    delete user.password_hash;
    res.json({ user, ...tokens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token required.' });
  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const result = await query('SELECT id, email, name, role FROM users WHERE id = $1', [decoded.id]);
    if (!result.rows.length) return res.status(401).json({ error: 'User not found.' });
    const tokens = generateTokens(result.rows[0]);
    res.json(tokens);
  } catch (err) {
    res.status(401).json({ error: 'Invalid refresh token.' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

module.exports = router;
