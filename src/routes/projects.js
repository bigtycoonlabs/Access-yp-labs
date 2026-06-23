const express = require('express');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/projects  — client sees their own; staff sees all
router.get('/', authenticate, async (req, res) => {
  try {
    const isStaff = ['staff', 'admin', 'master_staff'].includes(req.user.role);
    const result = isStaff
      ? await query(`
          SELECT p.*, u.name AS client_name, u.email AS client_email
          FROM projects p JOIN users u ON p.user_id = u.id
          ORDER BY p.created_at DESC
        `)
      : await query(
          'SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
          [req.user.id]
        );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects.' });
  }
});

// GET /api/projects/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, u.name AS client_name, u.email AS client_email
       FROM projects p JOIN users u ON p.user_id = u.id
       WHERE p.id = $1`, [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Project not found.' });
    const project = result.rows[0];
    const isOwner = project.user_id === req.user.id;
    const isStaff = ['staff', 'admin', 'master_staff'].includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'Access denied.' });

    // Fetch line items
    const items = await query(
      'SELECT * FROM order_line_items WHERE project_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    project.line_items = items.rows;
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project.' });
  }
});

// PATCH /api/projects/:id  — staff only: update status, assigned_specialist, notes
router.patch('/:id', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res) => {
  const { status, assigned_specialist, internal_notes } = req.body;
  const updates = [];
  const values = [];
  let idx = 1;

  if (status) { updates.push(`status = $${idx++}`); values.push(status); }
  if (assigned_specialist) { updates.push(`assigned_specialist = $${idx++}`); values.push(assigned_specialist); }
  if (internal_notes !== undefined) { updates.push(`internal_notes = $${idx++}`); values.push(internal_notes); }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });

  updates.push(`updated_at = NOW()`);
  values.push(req.params.id);

  try {
    const result = await query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Project not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update project.' });
  }
});

module.exports = router;
