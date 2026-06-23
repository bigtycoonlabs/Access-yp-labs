const { query } = require('../config/db');

const STAFF_ROLES = new Set(['staff', 'admin', 'master_staff']);

async function requireProjectAccess(req, res, next) {
  if (STAFF_ROLES.has(req.user.role)) return next();

  try {
    const projectId = req.params.projectId || req.params.id;
    const result = await query(
      'SELECT 1 FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user.id]
    );
    if (!result.rows.length) return res.status(403).json({ error: 'Access denied.' });
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { STAFF_ROLES, requireProjectAccess };
