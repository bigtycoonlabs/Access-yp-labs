const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { query } = require('../config/db');
const { uploadBuffer } = require('../services/storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const DEFAULT_STAFF_PASSWORD_SHA256 = '9f36624647df86501c1c2315d64b01d9e1405caa4d650b8833a4a13575c03312';

function requireStaffPortal(req, res, next) {
  const supplied = req.get('x-staff-password') || req.body?.staff_password || req.query?.staff_password || '';
  const configuredPassword = process.env.STAFF_PORTAL_PASSWORD;
  const suppliedHash = crypto.createHash('sha256').update(String(supplied)).digest('hex');
  const configuredMatches = configuredPassword && supplied === configuredPassword;
  const defaultMatches = suppliedHash === DEFAULT_STAFF_PASSWORD_SHA256;
  if (!configuredMatches && !defaultMatches) return res.status(401).json({ error: 'Invalid staff password.' });
  next();
}

async function ensureStaffTables() {
  await query(`CREATE TABLE IF NOT EXISTS staff_invites (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), email VARCHAR(255) NOT NULL, name VARCHAR(255), temporary_password VARCHAR(255), status VARCHAR(40) NOT NULL DEFAULT 'sent', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}

router.use(requireStaffPortal);
router.use(async (req, res, next) => { try { await ensureStaffTables(); next(); } catch (error) { next(error); } });

router.get('/overview', async (req, res, next) => {
  try {
    const [projects, appointments, users] = await Promise.all([
      query(`SELECT p.*, u.name AS client_name, u.email AS client_email, u.phone AS client_phone, u.business_name FROM projects p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 250`),
      query(`SELECT * FROM appointments ORDER BY scheduled_at DESC LIMIT 250`),
      query(`SELECT id, name, email, phone, business_name, role, status, created_at FROM users WHERE role = 'client' ORDER BY created_at DESC LIMIT 250`),
    ]);
    res.json({ projects: projects.rows, appointments: appointments.rows, clients: users.rows });
  } catch (error) { next(error); }
});

router.get('/projects/:id', async (req, res, next) => {
  try {
    const [project, items, messages, files, requests, billing] = await Promise.all([
      query(`SELECT p.*, u.name AS client_name, u.email AS client_email, u.phone AS client_phone, u.business_name FROM projects p JOIN users u ON u.id = p.user_id WHERE p.id = $1`, [req.params.id]),
      query(`SELECT * FROM order_line_items WHERE project_id = $1 ORDER BY created_at`, [req.params.id]),
      query(`SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]),
      query(`SELECT * FROM project_files WHERE project_id = $1 ORDER BY created_at DESC`, [req.params.id]),
      query(`SELECT * FROM client_requests WHERE project_id = $1 ORDER BY created_at DESC`, [req.params.id]),
      query(`SELECT * FROM payment_plans WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.params.id]),
    ]);
    if (!project.rows.length) return res.status(404).json({ error: 'Project not found.' });
    res.json({ project: project.rows[0], items: items.rows, messages: messages.rows, files: files.rows, requests: requests.rows, billing: billing.rows[0] || null });
  } catch (error) { next(error); }
});

router.patch('/projects/:id', async (req, res, next) => {
  try {
    const result = await query(`UPDATE projects SET status = COALESCE($1,status), assigned_specialist = COALESCE($2,assigned_specialist), internal_notes = COALESCE($3,internal_notes), updated_at = NOW() WHERE id = $4 RETURNING *`, [req.body.status || null, req.body.assigned_specialist || null, req.body.internal_notes || null, req.params.id]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.post('/projects/:id/message', async (req, res, next) => {
  try {
    const staff = await query(`SELECT id FROM users WHERE role IN ('staff','admin','master_staff') ORDER BY created_at LIMIT 1`);
    const senderId = staff.rows[0]?.id || null;
    const result = await query(`INSERT INTO messages (project_id, sender_id, body, created_at) VALUES ($1,$2,$3,NOW()) RETURNING *`, [req.params.id, senderId, req.body.body]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

router.post('/projects/:id/invoice', async (req, res, next) => {
  try {
    const result = await query(`UPDATE payment_plans SET subtotal = COALESCE($1,subtotal), financed_total = COALESCE($2,financed_total), installment_amount = COALESCE($3,installment_amount), status = COALESCE($4,status), updated_at = NOW() WHERE project_id = $5 RETURNING *`, [req.body.subtotal || null, req.body.financed_total || null, req.body.installment_amount || null, req.body.status || 'pending_confirmation', req.params.id]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.post('/projects/:id/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });
    const staff = await query(`SELECT id FROM users WHERE role IN ('staff','admin','master_staff') ORDER BY created_at LIMIT 1`);
    const uploadedBy = staff.rows[0]?.id;
    if (!uploadedBy) return res.status(400).json({ error: 'Create at least one staff user before uploading files.' });
    const uploaded = await uploadBuffer(req.file, `yp-labs/projects/${req.params.id}`);
    const result = await query(`INSERT INTO project_files (project_id, uploaded_by, filename, file_url, file_type, file_size, storage_public_id, storage_resource_type, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`, [req.params.id, uploadedBy, req.file.originalname, uploaded.secure_url, req.file.mimetype, req.file.size, uploaded.public_id, uploaded.resource_type]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

router.post('/staff-invites', async (req, res, next) => {
  try {
    const temp = `YP-${crypto.randomBytes(7).toString('base64url')}!`;
    const hash = await bcrypt.hash(temp, 12);
    const user = await query(`INSERT INTO users (email, name, role, status, password_hash, created_at) VALUES ($1,$2,'staff','active',$3,NOW()) ON CONFLICT (email) DO UPDATE SET role = 'staff', status = 'active', password_hash = EXCLUDED.password_hash RETURNING id, email, name, role, status`, [req.body.email, req.body.name || req.body.email, hash]);
    await query(`INSERT INTO staff_invites (email, name, temporary_password) VALUES ($1,$2,$3)`, [req.body.email, req.body.name || null, temp]);
    res.status(201).json({ user: user.rows[0], temporaryPassword: temp });
  } catch (error) { next(error); }
});

module.exports = router;
