// OBLIGATIONS — everything owed to anyone, and the one list that ranks it.
//
// GET /api/obligations/today is the endpoint the product is for. It answers the question an owner is
// actually asking at 7am, which is not "what are my tasks" but "what happens if I do not get to all
// of this".
//
// Every response here carries the SENTENCE as well as the numbers. A client that has to assemble
// "costs $2,400 and it was due 19 days ago" from four fields will assemble it differently in three
// places, and one of them will round. The prose is generated once, in one place, and read aloud
// identically wherever it appears.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const P = require('../lib/permissions');
const R = require('../lib/ranking');

const router = express.Router();

const bad = (req) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, e.array()[0].msg);
};

const decorate = (rows) => rows.map((r) => Object.assign({}, r, { says: R.explain(r) }));

// THE MORNING. Cross-business by default, because an owner's morning is not divided by entity.
router.get('/today', authenticate, asyncHandler(async (req, res) => {
  const businessIds = req.query.business_id ? [req.query.business_id] : null;
  const horizon = Math.min(365, Math.max(1, parseInt(req.query.horizon_days, 10) || R.DEFAULT_HORIZON_DAYS));
  const rows = await R.rankedToday(req.user.id, { businessIds, horizonDays: horizon });
  res.json({
    summary: R.summarise(rows),
    count: rows.length,
    overdue: rows.filter((r) => r.overdue).length,
    horizon_days: horizon,
    items: decorate(rows),
  });
}));

// The next thirty days, ordered by date rather than cost — this is a calendar question.
router.get('/coming', authenticate, asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const businessIds = req.query.business_id ? [req.query.business_id] : null;
  const rows = await R.coming(req.user.id, { days, businessIds });
  res.json({ days, count: rows.length, items: decorate(rows) });
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  if (!req.query.business_id) throw new ApiError(400, 'Which business?');
  const gate = await P.forBusiness(req.user.id, req.query.business_id);
  if (!gate) throw new ApiError(404, 'No such business, or you do not have access to it.');

  // Only the areas this person can actually see. The list endpoint has the same obligation as the
  // ranked one: filtering by business and then showing everything inside it is the bug this
  // codebase already found once.
  const areas = Object.keys(gate.areas).filter((a) => gate.areas[a] !== 'none');
  const kinds = Object.keys(R.KIND_AREA).filter((k) => gate.isOwner || areas.includes(R.KIND_AREA[k]));
  if (!kinds.length) return res.json({ items: [], note: 'You do not have access to anything on this business yet.' });

  const status = ['open', 'done', 'waived', 'superseded'].includes(req.query.status)
    ? req.query.status : 'open';
  const r = await query(
    `SELECT o.*, b.name AS business_name,
            (o.due_at IS NOT NULL AND o.due_at < now() AND o.status='open') AS overdue
       FROM obligations o JOIN businesses b ON b.id=o.business_id
      WHERE o.business_id=$1 AND o.status=$2 AND o.kind = ANY($3)
      ORDER BY o.due_at ASC NULLS LAST LIMIT 200`,
    [req.query.business_id, status, kinds]);
  res.json({ status, count: r.rows.length, items: decorate(r.rows) });
}));

router.post('/', authenticate, [
  body('business_id').isUUID().withMessage('Which business?'),
  body('kind').isIn(['filing', 'licence', 'permit', 'registration', 'insurance', 'tax',
    'task', 'promise', 'invoice_out', 'invoice_in', 'renewal', 'meeting', 'other']),
  body('title').isString().trim().isLength({ min: 1, max: 200 }).withMessage('It needs a title.'),
  body('cost_if_missed_cents').optional({ nullable: true }).isInt({ min: 0 }),
  body('cost_basis').optional({ values: 'falsy' }).isIn(['known', 'estimated', 'unknown']),
], asyncHandler(async (req, res) => {
  bad(req);
  const b = req.body;
  const area = R.KIND_AREA[b.kind] || 'projects';
  const gate = await P.can(req.user.id, b.business_id, area, 'act');
  if (!gate.ok) {
    throw new ApiError(gate.reason === 'no_access' ? 404 : 403,
      P.refusalLine(gate, area, gate.perms && gate.perms.business.name));
  }

  // A cost with no basis is refused by the database. Catching it here means the person gets a
  // sentence instead of a constraint violation, and the constraint still holds if this is missed.
  if (b.cost_if_missed_cents != null && !b.cost_basis) {
    throw new ApiError(400,
      'If you are putting a number on it, say whether that is known or an estimate. '
      + 'A cost nobody can explain is a cost nobody should trust.');
  }

  const r = await query(
    `INSERT INTO obligations (business_id, subject_id, kind, title, detail, counterparty,
        counterparty_kind, due_at, recurs_every, cost_if_missed_cents, cost_basis, cost_note,
        consequence, assigned_to, source, source_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,'stated'),$16)
     RETURNING *`,
    [b.business_id, b.subject_id || null, b.kind, b.title.trim(), b.detail || null,
      b.counterparty || null, b.counterparty_kind || null, b.due_at || null,
      b.recurs_every || null, b.cost_if_missed_cents ?? null, b.cost_basis || null,
      b.cost_note || null, b.consequence || null, b.assigned_to || null,
      b.source || null, b.source_ref || null]);

  const row = Object.assign({}, r.rows[0],
    { overdue: r.rows[0].due_at && new Date(r.rows[0].due_at) < new Date() });
  res.status(201).json({ obligation: Object.assign(row, { says: R.explain(row) }) });
}));

// Done. Recurring things reappear rather than vanishing — an annual report completed this year is
// owed again next year, and a compliance product that forgets that is worse than a calendar.
router.post('/:id/done', authenticate, asyncHandler(async (req, res) => {
  const cur = await query('SELECT * FROM obligations WHERE id=$1', [req.params.id]);
  if (!cur.rows.length) throw new ApiError(404, 'No such obligation.');
  const o = cur.rows[0];
  const area = R.KIND_AREA[o.kind] || 'projects';
  const gate = await P.can(req.user.id, o.business_id, area, 'act');
  if (!gate.ok) {
    throw new ApiError(gate.reason === 'no_access' ? 404 : 403,
      P.refusalLine(gate, area, gate.perms && gate.perms.business.name));
  }
  if (o.status === 'done') return res.json({ obligation: o, note: 'That was already done.' });

  await query('UPDATE obligations SET status=$1, completed_at=now(), updated_at=now() WHERE id=$2',
    ['done', o.id]);

  let next = null;
  if (o.recurs_every && o.due_at) {
    const n = await query(
      `INSERT INTO obligations (business_id, subject_id, kind, title, detail, counterparty,
          counterparty_kind, due_at, recurs_every, cost_if_missed_cents, cost_basis, cost_note,
          consequence, source, source_ref)
       SELECT business_id, subject_id, kind, title, detail, counterparty, counterparty_kind,
              due_at + recurs_every, recurs_every, cost_if_missed_cents, cost_basis, cost_note,
              consequence, source, source_ref
         FROM obligations WHERE id=$1 RETURNING *`, [o.id]);
    next = n.rows[0];
  }
  res.json({
    done: true,
    next_due: next ? next.due_at : null,
    note: next ? 'Done. The next one is on ' + new Date(next.due_at).toISOString().slice(0, 10) + '.' : 'Done.',
  });
}));

// EXPORT. Never blocked, and always logged. A client who cannot get their data out was never really
// given a choice, which is the opposite of what this product claims to be.
router.get('/export', authenticate, asyncHandler(async (req, res) => {
  if (!req.query.business_id) throw new ApiError(400, 'Which business?');
  const gate = await P.can(req.user.id, req.query.business_id, 'export', 'manage');
  if (!gate.ok) {
    throw new ApiError(gate.reason === 'no_access' ? 404 : 403,
      gate.reason === 'no_access' ? 'No such business, or you do not have access to it.'
        : 'You do not have permission to export data from this business. The owner can grant it.');
  }
  const r = await query(
    `SELECT o.kind, o.title, o.counterparty, o.due_at, o.cost_if_missed_cents, o.cost_basis,
            o.consequence, o.status, o.completed_at, o.source, o.created_at
       FROM obligations o WHERE o.business_id=$1 ORDER BY o.created_at ASC`,
    [req.query.business_id]);

  // Two things found by opening the file rather than by checking it returned 200.
  //
  // Dates went out as JavaScript's default Date.toString() — "Sun Sep 27 2026 09:00:00 GMT+0000
  // (Coordinated Universal Time)" — which Excel will not parse into a date and which no accountant
  // should have to look at. ISO, so it sorts and imports.
  //
  // And the cost went out in cents. Somebody opening this in Excel sees 2500 against an Ohio annual
  // report and reads two and a half thousand dollars. It is $25. The column is now dollars and says
  // so in its name.
  const esc = (v) => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cols = ['kind', 'title', 'counterparty', 'due_at', 'cost_if_missed_usd', 'cost_basis',
    'consequence', 'status', 'completed_at', 'source', 'created_at'];
  const csv = [cols.join(',')].concat(r.rows.map((row) => cols.map((c) => {
    if (c === 'cost_if_missed_usd') {
      return row.cost_if_missed_cents == null ? '' : (row.cost_if_missed_cents / 100).toFixed(2);
    }
    return esc(row[c]);
  }).join(','))).join('\n');

  // Logged after the rows exist, never before. A logged export that failed is a worse record.
  await P.logExport(req.query.business_id, req.user.id, 'obligations', r.rows.length);
  res.type('text/csv').attachment('obligations.csv').send(csv);
}));

module.exports = router;
