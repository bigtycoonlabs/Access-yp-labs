// ─────────────────────────────────────────────
// billing.js
// ─────────────────────────────────────────────
const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { requireProjectAccess } = require('../middleware/projectAccess');

const billing = express.Router();

function stripeForm(fields) {
  const form = new URLSearchParams();
  Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
  return form;
}

async function stripeRequest(path, fields, idempotencyKey) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: stripeForm(fields),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Stripe request failed.');
  return data;
}

// GET /api/billing/:projectId
billing.get('/:projectId', authenticate, requireProjectAccess, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM payment_plans WHERE project_id = $1',
      [req.params.projectId]
    );
    res.json(result.rows[0] || null);
  } catch (error) { next(error); }
});

billing.post('/:projectId/checkout', authenticate, requireProjectAccess, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT pp.*, p.user_id, u.email
       FROM payment_plans pp
       JOIN projects p ON p.id = pp.project_id
       JOIN users u ON u.id = p.user_id
       WHERE pp.project_id = $1`,
      [req.params.projectId]
    );
    const plan = result.rows[0];
    if (!plan) return res.status(404).json({ error: 'Payment plan not found.' });
    if (plan.status === 'paid') return res.status(409).json({ error: 'This project is already paid.' });

    const amount = plan.plan_type === 'financed' ? plan.installment_amount : plan.subtotal;
    const baseUrl = (process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const session = await stripeRequest('checkout/sessions', {
      mode: 'payment',
      customer_email: plan.email,
      success_url: `${baseUrl}/dashboard.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/dashboard.html?payment=cancelled`,
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': Math.round(Number(amount) * 100),
      'line_items[0][price_data][product_data][name]': plan.plan_type === 'financed'
        ? 'YP Labs Arbo + Equity access installment'
        : 'YP Labs Arbo + Equity access',
      'metadata[project_id]': req.params.projectId,
      'metadata[plan_type]': plan.plan_type,
    }, `yp-labs-${req.params.projectId}-${plan.installments_paid}`);

    await query(
      'UPDATE payment_plans SET stripe_checkout_session_id = $1, updated_at = NOW() WHERE project_id = $2',
      [session.id, req.params.projectId]
    );
    return res.status(201).json({ checkout_url: session.url });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/billing/:projectId  — staff confirms payment arrangement
billing.patch('/:projectId', authenticate, authorize('staff', 'admin', 'master_staff'), async (req, res) => {
  const { status, installments_paid } = req.body;
  const result = await query(
    `UPDATE payment_plans SET
       status=COALESCE($1,status),
       installments_paid=COALESCE($2,installments_paid),
       updated_at=NOW()
     WHERE project_id=$3 RETURNING *`,
    [status || null, installments_paid || null, req.params.projectId]
  ).catch(err => { throw err; });
  res.json(result.rows[0] || { error: 'Not found.' });
});

module.exports = billing;

module.exports.webhook = async function webhook(req, res) {
  const signature = req.get('stripe-signature') || '';
  const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  const expected = crypto
    .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET || '')
    .update(`${timestamp}.${req.body.toString('utf8')}`)
    .digest('hex');
  const supplied = parts.v1 || '';
  const valid = supplied.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  const event = JSON.parse(req.body.toString('utf8'));
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const projectId = session.metadata?.project_id;
    if (projectId) {
      const inserted = await query(
        `INSERT INTO stripe_events (id, event_type) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [event.id, event.type]
      );
      if (inserted.rows.length) {
        await query(
          `UPDATE payment_plans SET
             installments_paid = installments_paid + 1,
             status = CASE WHEN plan_type = 'one_time' OR installments_paid + 1 >= installments_total
               THEN 'paid' ELSE 'active' END,
             updated_at = NOW()
           WHERE project_id = $1`,
          [projectId]
        );
      }
    }
  }
  return res.json({ received: true });
};
