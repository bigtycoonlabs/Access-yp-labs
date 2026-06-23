const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { requireProjectAccess } = require('../middleware/projectAccess');

const router = express.Router();

// GET /api/messages/:projectId
router.get('/:projectId', authenticate, requireProjectAccess, async (req, res) => {
  try {
    const result = await query(
      `SELECT m.*, u.name AS sender_name, u.role AS sender_role
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.project_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages.' });
  }
});

// POST /api/messages/:projectId
router.post('/:projectId', authenticate, requireProjectAccess, [
  body('body').trim().notEmpty().isLength({ max: 4000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const result = await query(
      `INSERT INTO messages (project_id, sender_id, body, created_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [req.params.projectId, req.user.id, req.body.body]
    );
    // TODO: push via Supabase Realtime / Pusher, send email notification
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

module.exports = router;
