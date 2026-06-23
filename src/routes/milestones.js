// ─────────────────────────────────────────────
// milestones.js
// ─────────────────────────────────────────────
const express = require('express');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { requireProjectAccess } = require('../middleware/projectAccess');

const milestones = express.Router();

milestones.get('/:projectId', authenticate, requireProjectAccess, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM milestones WHERE project_id = $1 ORDER BY sort_order, created_at',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

milestones.post('/:projectId', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res, next) => {
  const { title, estimated_date, status = 'queued' } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required.' });
  if (!['queued', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid milestone status.' });
  }
  try {
    const result = await query(
      `INSERT INTO milestones (project_id, title, estimated_date, status, created_at)
       VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,
      [req.params.projectId, title, estimated_date || null, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

milestones.patch('/:projectId/:id', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res) => {
  const { status, title, estimated_date } = req.body;
  const completedAt = status === 'completed' ? 'NOW()' : 'NULL';
  const result = await query(
    `UPDATE milestones SET
       status = COALESCE($1, status),
       title = COALESCE($2, title),
       estimated_date = COALESCE($3, estimated_date),
       completed_at = ${completedAt},
       updated_at = NOW()
     WHERE id = $4 AND project_id = $5 RETURNING *`,
    [status || null, title || null, estimated_date || null, req.params.id, req.params.projectId]
  ).catch(err => { throw err; });
  res.json(result.rows[0] || { error: 'Milestone not found.' });
});

module.exports = milestones;
