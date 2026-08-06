const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate, authorize } = require('../middleware/auth');
const { sendEmail } = require('../services/email');

// THE PEOPLE ON THE PLATFORM — a staff view of who is here, so the owners can see accounts, reach
// someone, or stop someone.
//
// The care here is not about the code, it is about the fact that every row is a person:
//   * SUSPENDING is the normal tool and it is reversible. It is already enforced everywhere —
//     sign-in, token refresh, and every authenticated request — so it takes effect immediately.
//   * DELETING is genuinely permanent and is REFUSED when the account has any money history.
//     Orders and payouts are records we may need years from now, for the other side of the
//     transaction as much as for us; erasing a counterparty is not ours to do on a whim.
//   * Nobody can suspend or delete THEMSELVES or another owner by accident.
//   * Contacting someone sends a real email from a real person, and says who it is from.

const router = express.Router();
const staffOnly = [authenticate, authorize('staff', 'admin', 'master_staff')];
const ownerOnly = [authenticate, authorize('master_staff')];

// GET /api/admin/users — everyone, with enough context to judge who they are.
router.get('/', staffOnly, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [];
  let where = '';
  if (q) {
    params.push('%' + q.toLowerCase() + '%');
    where = `WHERE lower(u.email) LIKE $1 OR lower(coalesce(u.name,'')) LIKE $1
             OR lower(coalesce(u.display_name,'')) LIKE $1 OR coalesce(u.phone,'') LIKE $1`;
  }
  const r = await query(
    `SELECT u.id, u.email, u.name, u.display_name, u.phone, u.role, u.status, u.created_at,
            (SELECT count(*) FROM concepts c WHERE c.owner_id = u.id)::int AS projects,
            (SELECT count(*) FROM listings l JOIN concepts c ON c.id = l.concept_id
              WHERE c.owner_id = u.id AND l.status = 'live')::int AS live_listings,
            (SELECT count(*) FROM orders_transfers o
              WHERE o.seller_id = u.id OR o.buyer_id = u.id)::int AS orders,
            (SELECT COALESCE(SUM(o.amount_cents),0) FROM orders_transfers o
              WHERE o.seller_id = u.id AND o.status = 'released')::int AS earned_cents,
            EXISTS (SELECT 1 FROM subscriptions s
                     WHERE s.user_id = u.id AND s.status = 'active') AS paying
       FROM users u
       ${where}
      ORDER BY u.created_at DESC
      LIMIT 200`, params);
  res.json({ users: r.rows });
}));

// Shared guard: you may not act on yourself, and only an owner may act on another owner.
async function targetFor(req) {
  const r = await query('SELECT id, email, name, role, status FROM users WHERE id=$1', [req.params.id]);
  const target = r.rows[0];
  if (!target) throw new ApiError(404, 'No account with that id.');
  if (target.id === req.user.id) {
    throw new ApiError(400, 'You cannot do that to your own account.');
  }
  if (target.role === 'master_staff' && req.user.role !== 'master_staff') {
    throw new ApiError(403, 'Only an owner can act on another owner.');
  }
  return target;
}

// POST /api/admin/users/:id/suspend — the reversible one. Blocks sign-in immediately and stops
// every authenticated request; nothing they made is touched or deleted.
router.post('/:id/suspend', ownerOnly, asyncHandler(async (req, res) => {
  const target = await targetFor(req);
  if (target.status === 'suspended') return res.json({ status: 'suspended', already: true });
  await query(`UPDATE users SET status='suspended', updated_at=now() WHERE id=$1`, [target.id]);
  res.json({
    status: 'suspended',
    message: `${target.name || target.email} can no longer sign in. Nothing of theirs has been deleted, `
      + 'and you can restore them at any time.',
  });
}));

// POST /api/admin/users/:id/restore — undo it.
router.post('/:id/restore', ownerOnly, asyncHandler(async (req, res) => {
  const target = await targetFor(req);
  await query(`UPDATE users SET status='active', updated_at=now() WHERE id=$1`, [target.id]);
  res.json({ status: 'active', message: `${target.name || target.email} can sign in again.` });
}));

// POST /api/admin/users/:id/message — reach someone directly.
router.post('/:id/message', ownerOnly, [
  body('subject').isString().isLength({ min: 3, max: 150 }),
  body('body').isString().isLength({ min: 10, max: 4000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const r = await query('SELECT email, name FROM users WHERE id=$1', [req.params.id]);
  if (!r.rows.length) throw new ApiError(404, 'No account with that id.');
  const target = r.rows[0];

  // Signed by a person, not by "the team". Someone receiving a message about their account should
  // know a human sent it and be able to reply to one.
  const out = await sendEmail({
    to: target.email,
    subject: req.body.subject,
    text: `Hi ${target.name || 'there'},\n\n${req.body.body}\n\n— ${req.user.name || 'Access YP Labs'}, Access YP Labs`,
  });
  const sent = !!(out && out.sent !== false);
  res.json({
    sent,
    message: sent
      ? `Sent to ${target.email}.`
      : `That did not send. Nothing reached ${target.email} — you may want to contact them another way.`,
  });
}));

// DELETE /api/admin/users/:id — permanent, and deliberately restricted.
router.delete('/:id', ownerOnly, asyncHandler(async (req, res) => {
  const target = await targetFor(req);

  // Money history is not ours to erase. If this person has ever been part of an order, the record
  // belongs to the other side of that transaction too, and to us for years afterwards. Suspend
  // instead — it achieves the same practical result without destroying evidence of a real sale.
  const orders = await query(
    `SELECT count(*)::int AS n FROM orders_transfers WHERE seller_id=$1 OR buyer_id=$1`, [target.id]);
  if (orders.rows[0].n > 0) {
    throw new ApiError(409,
      'This account has money history — it has been part of at least one order — so it cannot be '
      + 'deleted. Those records belong to the other side of the transaction as well. Suspend the '
      + 'account instead: they lose access immediately and nothing is destroyed.');
  }

  await query('DELETE FROM users WHERE id=$1', [target.id]);
  res.json({
    deleted: true,
    message: `${target.name || target.email} has been permanently deleted, along with their projects `
      + 'and anything attached to them. This cannot be undone.',
  });
}));

module.exports = router;
