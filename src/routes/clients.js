const express = require('express');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/clients  — full list with project info
router.get('/', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.name, u.email, u.phone, u.business_name, u.referral_source,
             u.created_at, p.id AS project_id, p.status AS project_status,
             p.track, p.subtotal, p.payment_plan, p.assigned_specialist, p.internal_notes
      FROM users u
      LEFT JOIN projects p ON p.user_id = u.id
      WHERE u.role = 'client'
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch clients.' });
  }
});

// GET /api/clients/:id
router.get('/:id', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, email, phone, business_name, referral_source, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Client not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch client.' });
  }
});

// PATCH /api/clients/:id  — update CRM fields
router.patch('/:id', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res) => {
  const { name, phone, business_name, referral_source } = req.body;
  try {
    const result = await query(
      `UPDATE users SET
         name = COALESCE($1, name),
         phone = COALESCE($2, phone),
         business_name = COALESCE($3, business_name),
         referral_source = COALESCE($4, referral_source),
         updated_at = NOW()
       WHERE id = $5 RETURNING id, name, email, phone, business_name, referral_source`,
      [name || null, phone || null, business_name || null, referral_source || null, req.params.id]
    );
    res.json(result.rows[0] || { error: 'Client not found.' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

module.exports = router;
