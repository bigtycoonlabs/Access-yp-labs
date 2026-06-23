const express = require('express');
const multer = require('multer');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { requireProjectAccess } = require('../middleware/projectAccess');
const { uploadBuffer, deleteAsset } = require('../services/storage');

const router = express.Router();

// Multer buffers each validated upload briefly before the signed provider upload.
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip','application/x-zip-compressed',
      'text/plain','text/html','text/css',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type ${file.mimetype} not allowed.`));
  },
});

// GET /api/files/:projectId
router.get('/:projectId', authenticate, requireProjectAccess, async (req, res) => {
  try {
    const result = await query(
      `SELECT f.*, u.name AS uploaded_by_name
       FROM project_files f JOIN users u ON f.uploaded_by = u.id
       WHERE f.project_id = $1
       ORDER BY f.created_at DESC`,
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch files.' });
  }
});

// POST /api/files/:projectId  — staff only (upload deliverables)
router.post('/:projectId', authenticate, authorize('staff', 'admin', 'master_staff'),
  upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });
    try {
      const uploaded = await uploadBuffer(req.file, `yp-labs/projects/${req.params.projectId}`);

      const result = await query(
        `INSERT INTO project_files
           (project_id, uploaded_by, filename, file_url, file_type, file_size,
            storage_public_id, storage_resource_type, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
        [req.params.projectId, req.user.id, req.file.originalname,
         uploaded.secure_url, req.file.mimetype, req.file.size,
         uploaded.public_id, uploaded.resource_type]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Upload failed.' });
    }
  }
);

// DELETE /api/files/:projectId/:fileId  — staff only
router.delete('/:projectId/:fileId', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM project_files WHERE id = $1 AND project_id = $2
       RETURNING storage_public_id, storage_resource_type`,
      [req.params.fileId, req.params.projectId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'File not found.' });
    await deleteAsset(result.rows[0].storage_public_id, result.rows[0].storage_resource_type);
    res.json({ message: 'File deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
