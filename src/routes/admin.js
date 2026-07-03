const express = require('express');
const bcrypt = require('bcryptjs');
const nodeCrypto = require('node:crypto');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const ADMIN_ROLES = ['admin', 'master_staff'];
const USER_ROLES = ['client', 'staff', 'admin', 'master_staff'];
const USER_STATUSES = ['pending', 'active', 'suspended'];

async function ensureAdminTables() {
  await query(`CREATE TABLE IF NOT EXISTS login_activity (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID REFERENCES users(id) ON DELETE SET NULL, email VARCHAR(255), success BOOLEAN NOT NULL DEFAULT FALSE, ip_address INET, user_agent TEXT, reason VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await query(`CREATE TABLE IF NOT EXISTS discount_codes (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), code VARCHAR(80) UNIQUE NOT NULL, description TEXT, discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percent','amount')), discount_value NUMERIC(10,2) NOT NULL, max_redemptions INTEGER, redemptions INTEGER NOT NULL DEFAULT 0, starts_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, active BOOLEAN NOT NULL DEFAULT TRUE, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ)`);
  await query(`CREATE TABLE IF NOT EXISTS platform_performance (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID REFERENCES users(id) ON DELETE CASCADE, project_id UUID REFERENCES projects(id) ON DELETE SET NULL, period_start DATE NOT NULL, period_end DATE NOT NULL, reported_profit NUMERIC(12,2) NOT NULL DEFAULT 0, platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0, growth_rate NUMERIC(8,4), notes TEXT, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ)`);
}

router.use(authenticate, authorize(...ADMIN_ROLES));
router.use(async (req, res, next) => { try { await ensureAdminTables(); next(); } catch (error) { next(error); } });

router.get('/overview', async (req, res, next) => {
  try {
    const [users, billing, performance, discounts] = await Promise.all([
      query(`SELECT COUNT(*)::INTEGER AS total_users, COUNT(*) FILTER (WHERE role = 'client')::INTEGER AS clients, COUNT(*) FILTER (WHERE role IN ('staff','admin','master_staff'))::INTEGER AS team_members, COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending_users, COUNT(*) FILTER (WHERE status = 'suspended')::INTEGER AS suspended_users FROM users`),
      query(`SELECT COALESCE(SUM(subtotal) FILTER (WHERE status = 'paid'),0)::NUMERIC AS collected_revenue, COALESCE(SUM(subtotal) FILTER (WHERE status <> 'paid'),0)::NUMERIC AS pending_revenue, COUNT(*) FILTER (WHERE status = 'paid')::INTEGER AS paid_accounts, COUNT(*) FILTER (WHERE status <> 'paid')::INTEGER AS unpaid_accounts FROM payment_plans`),
      query(`SELECT COALESCE(SUM(reported_profit),0)::NUMERIC AS reported_profit, COALESCE(SUM(platform_fee),0)::NUMERIC AS platform_fees, COALESCE(AVG(growth_rate),0)::NUMERIC AS avg_growth_rate FROM platform_performance`),
      query(`SELECT COUNT(*) FILTER (WHERE active = TRUE)::INTEGER AS active_discounts FROM discount_codes`),
    ]);
    res.json({ users: users.rows[0], billing: billing.rows[0], performance: performance.rows[0], discounts: discounts.rows[0], integrations: { stripe: process.env.STRIPE_SECRET_KEY ? 'configured' : 'not_configured', cloudinary: process.env.CLOUDINARY_URL ? 'configured' : 'not_configured', database: process.env.DATABASE_URL ? 'configured' : 'not_configured', email_notifications: process.env.SMTP_HOST ? 'configured' : 'not_configured', pms_integration: 'planned' } });
  } catch (error) { next(error); }
});

router.get('/users', async (req, res, next) => {
  try {
    const result = await query(`SELECT u.id, u.name, u.email, u.phone, u.business_name, u.role, u.status, u.referral_source, u.created_at, u.updated_at, MAX(la.created_at) FILTER (WHERE la.success = TRUE) AS last_login_at, COUNT(la.id) FILTER (WHERE la.success = FALSE AND la.created_at > NOW() - INTERVAL '30 days')::INTEGER AS failed_logins_30d, COUNT(p.id)::INTEGER AS project_count, COALESCE(SUM(pp.subtotal),0)::NUMERIC AS lifetime_billing, COALESCE(SUM(perf.reported_profit),0)::NUMERIC AS reported_profit FROM users u LEFT JOIN login_activity la ON la.user_id = u.id LEFT JOIN projects p ON p.user_id = u.id LEFT JOIN payment_plans pp ON pp.project_id = p.id LEFT JOIN platform_performance perf ON perf.user_id = u.id GROUP BY u.id ORDER BY u.created_at DESC`);
    res.json(result.rows);
  } catch (error) { next(error); }
});

router.patch('/users/:id', [body('role').optional().isIn(USER_ROLES), body('status').optional().isIn(USER_STATUSES), body('name').optional().trim().notEmpty(), body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 50 }), body('business_name').optional({ checkFalsy: true }).trim().isLength({ max: 255 })], async (req, res, next) => {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (req.body.role === 'master_staff' && req.user.role !== 'master_staff') return res.status(403).json({ error: 'Only master staff can assign master staff.' });
  try {
    const result = await query(`UPDATE users SET role = COALESCE($1, role), status = COALESCE($2, status), name = COALESCE($3, name), phone = COALESCE($4, phone), business_name = COALESCE($5, business_name), updated_at = NOW() WHERE id = $6 RETURNING id, name, email, phone, business_name, role, status, updated_at`, [req.body.role || null, req.body.status || null, req.body.name || null, req.body.phone || null, req.body.business_name || null, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const temporaryPassword = `YP-${nodeCrypto.randomBytes(9).toString('base64url')}!`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const result = await query(`UPDATE users SET password_hash = $1, status = 'active', updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role, status`, [passwordHash, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: result.rows[0], temporaryPassword });
  } catch (error) { next(error); }
});

router.get('/login-activity', async (req, res, next) => { try { const result = await query(`SELECT la.*, u.name, u.role FROM login_activity la LEFT JOIN users u ON u.id = la.user_id ORDER BY la.created_at DESC LIMIT 250`); res.json(result.rows); } catch (error) { next(error); } });
router.get('/discounts', async (req, res, next) => { try { const result = await query('SELECT * FROM discount_codes ORDER BY created_at DESC'); res.json(result.rows); } catch (error) { next(error); } });
router.post('/discounts', [body('code').trim().isLength({ min: 2, max: 80 }), body('discount_type').isIn(['percent', 'amount']), body('discount_value').isFloat({ min: 0 }), body('max_redemptions').optional({ nullable: true }).isInt({ min: 1 })], async (req, res, next) => { const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() }); try { const result = await query(`INSERT INTO discount_codes (code, description, discount_type, discount_value, max_redemptions, starts_at, expires_at, active, created_by) VALUES (UPPER($1), $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE), $9) RETURNING *`, [req.body.code, req.body.description || null, req.body.discount_type, req.body.discount_value, req.body.max_redemptions || null, req.body.starts_at || null, req.body.expires_at || null, req.body.active, req.user.id]); res.status(201).json(result.rows[0]); } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Discount code already exists.' }); next(error); } });
router.patch('/discounts/:id', async (req, res, next) => { try { const result = await query(`UPDATE discount_codes SET description = COALESCE($1, description), discount_type = COALESCE($2, discount_type), discount_value = COALESCE($3, discount_value), max_redemptions = COALESCE($4, max_redemptions), starts_at = COALESCE($5, starts_at), expires_at = COALESCE($6, expires_at), active = COALESCE($7, active), updated_at = NOW() WHERE id = $8 RETURNING *`, [req.body.description || null, req.body.discount_type || null, req.body.discount_value || null, req.body.max_redemptions || null, req.body.starts_at || null, req.body.expires_at || null, typeof req.body.active === 'boolean' ? req.body.active : null, req.params.id]); if (!result.rows.length) return res.status(404).json({ error: 'Discount not found.' }); res.json(result.rows[0]); } catch (error) { next(error); } });
router.get('/performance', async (req, res, next) => { try { const result = await query(`SELECT perf.*, u.name, u.email, p.status AS project_status FROM platform_performance perf LEFT JOIN users u ON u.id = perf.user_id LEFT JOIN projects p ON p.id = perf.project_id ORDER BY perf.period_end DESC, perf.created_at DESC LIMIT 250`); res.json(result.rows); } catch (error) { next(error); } });
router.post('/performance', [body('user_id').isUUID(), body('period_start').isISO8601(), body('period_end').isISO8601(), body('reported_profit').isFloat({ min: 0 }), body('platform_fee').optional({ nullable: true }).isFloat({ min: 0 }), body('growth_rate').optional({ nullable: true }).isFloat()], async (req, res, next) => { const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() }); try { const result = await query(`INSERT INTO platform_performance (user_id, project_id, period_start, period_end, reported_profit, platform_fee, growth_rate, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.body.user_id, req.body.project_id || null, req.body.period_start, req.body.period_end, req.body.reported_profit, req.body.platform_fee || 0, req.body.growth_rate || null, req.body.notes || null, req.user.id]); res.status(201).json(result.rows[0]); } catch (error) { next(error); } });

module.exports = router;
