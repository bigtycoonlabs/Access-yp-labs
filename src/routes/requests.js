const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { requireProjectAccess } = require('../middleware/projectAccess');
const { uploadBuffer } = require('../services/storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/requests/:projectId
router.get('/:projectId', authenticate, requireProjectAccess, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM client_requests WHERE project_id = $1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests.' });
  }
});

// POST /api/requests/:projectId  — staff creates a request for client
router.post('/:projectId', authenticate, authorize('staff', 'admin', 'master_staff'), [
  body('title').trim().notEmpty(),
  body('description').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const result = await query(
      `INSERT INTO client_requests (project_id, created_by, title, description, status, created_at)
       VALUES ($1,$2,$3,$4,'open',NOW()) RETURNING *`,
      [req.params.projectId, req.user.id, req.body.title, req.body.description]
    );
    // TODO: notify client via dashboard + email
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create request.' });
  }
});

// POST /api/requests/:projectId/:requestId/respond  — client uploads response
router.post('/:projectId/:requestId/respond', authenticate, requireProjectAccess,
  upload.array('files', 10), async (req, res) => {
    try {
      const uploaded = await Promise.all((req.files || []).map((file) =>
        uploadBuffer(file, `yp-labs/requests/${req.params.projectId}`)
      ));
      const fileUrls = uploaded.map((file) => file.secure_url);
      await query(
        `UPDATE client_requests SET status='client_responded', response_note=$1,
           response_files=$2, responded_at=NOW() WHERE id=$3 AND project_id=$4`,
        [req.body.note || null, JSON.stringify(fileUrls), req.params.requestId, req.params.projectId]
      );
      // TODO: notify staff
      res.json({ message: 'Response submitted.' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit response.' });
    }
  }
);

// PATCH /api/requests/:projectId/:requestId  — staff closes/cancels
router.patch('/:projectId/:requestId', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res) => {
  const { status } = req.body; // 'closed' | 'cancelled'
  if (!['closed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid request status.' });
  }
  try {
    const result = await query(
      `UPDATE client_requests SET status=$1, updated_at=NOW()
       WHERE id=$2 AND project_id=$3 RETURNING *`,
      [status, req.params.requestId, req.params.projectId]
    );
    res.json(result.rows[0] || { error: 'Request not found.' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

module.exports = router;
