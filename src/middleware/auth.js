const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

/**
 * Verify JWT, enforce account suspension in real time, and reflect the current
 * role from the database (so promotions/suspensions take effect immediately).
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required.' });
  }
  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
  try {
    const u = await query('SELECT status, role, billing_test FROM users WHERE id=$1', [decoded.id]);
    if (!u.rows.length) return res.status(401).json({ error: 'Account not found.' });
    if (u.rows[0].status === 'suspended') return res.status(403).json({ error: 'Your account is suspended.' });
    decoded.role = u.rows[0].role;
    decoded.billing_test = u.rows[0].billing_test === true;
  } catch (e) {
    // If the status check itself fails (transient DB issue), fall back to the
    // verified token rather than locking everyone out.
  }
  req.user = decoded;
  next();
};

/** Restrict to specific roles. Usage: authorize('staff','admin','master_staff') */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions.' });
  }
  next();
};

module.exports = { authenticate, authorize };
