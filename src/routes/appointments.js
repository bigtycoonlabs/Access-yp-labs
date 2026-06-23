// ─────────────────────────────────────────────
// appointments.js
// ─────────────────────────────────────────────
const express = require('express');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const appointments = express.Router();

appointments.get('/', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM appointments ORDER BY scheduled_at ASC');
    res.json(result.rows);
  } catch (error) { next(error); }
});

appointments.post('/', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res, next) => {
  const { lead_name, lead_email, scheduled_at, duration_minutes, type, platform, project_id } = req.body;
  if (!lead_name || !scheduled_at) return res.status(400).json({ error: 'Name and time required.' });
  try {
    const result = await query(
      `INSERT INTO appointments (lead_name, lead_email, scheduled_at, duration_minutes, type, platform, project_id, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
      [lead_name, lead_email || null, scheduled_at, duration_minutes || 30,
       type || 'new_lead', platform || 'google_meet', project_id || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

appointments.patch('/:id', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res, next) => {
  const { scheduled_at, status } = req.body;
  if (status && !['scheduled', 'completed', 'cancelled', 'no_show'].includes(status)) {
    return res.status(400).json({ error: 'Invalid appointment status.' });
  }
  try {
    const result = await query(
      `UPDATE appointments SET scheduled_at=COALESCE($1,scheduled_at), status=COALESCE($2,status), updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [scheduled_at || null, status || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Appointment not found.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

module.exports = appointments;
