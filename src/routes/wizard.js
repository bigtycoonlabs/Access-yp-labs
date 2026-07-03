const express = require('express');
const { body, validationResult } = require('express-validator');
const { getClient } = require('../config/db');
const { calculateQuote } = require('../services/pricing');

const router = express.Router();

router.post('/submit', [
  body('track').isIn(['A', 'B']),
  body('payment_plan').isIn(['one_time', 'financed']),
  body('contact.name').trim().notEmpty(),
  body('contact.email').isEmail().normalizeEmail(),
  body('contact.phone').optional({ checkFalsy: true }).trim().isLength({ max: 50 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { track, housing_type, channel, mission, brand_color, cart, payment_plan, contact } = req.body;
  let quote;
  try {
    quote = calculateQuote({ track, cart, payment_plan });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    let userResult = await client.query('SELECT id FROM users WHERE email = $1', [contact.email]);
    let userId;
    if (!userResult.rows.length) {
      const newUser = await client.query(
        `INSERT INTO users (email, name, phone, business_name, role, status, created_at) VALUES ($1, $2, $3, $4, 'client', 'pending', NOW()) RETURNING id`,
        [contact.email, contact.name, contact.phone || null, contact.business_name || null]
      );
      userId = newUser.rows[0].id;
    } else {
      userId = userResult.rows[0].id;
    }

    const { lineItems, subtotal, financedTotal, installmentAmount, hostingMonthly, installmentMonths } = quote;
    const subResult = await client.query(
      `INSERT INTO wizard_submissions (user_id, track, housing_type, channel, mission, brand_color, payment_plan, subtotal, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id`,
      [userId, track, housing_type || null, channel || null, mission || null, brand_color || null, payment_plan, subtotal]
    );
    const submissionId = subResult.rows[0].id;
    const projResult = await client.query(
      `INSERT INTO projects (user_id, wizard_submission_id, track, status, payment_plan, subtotal, financed_total, installment_amount, hosting_monthly, created_at) VALUES ($1,$2,$3,'awaiting_specialist_contact',$4,$5,$6,$7,$8,NOW()) RETURNING id`,
      [userId, submissionId, track, payment_plan, subtotal, financedTotal, installmentAmount, hostingMonthly]
    );
    const projectId = projResult.rows[0].id;

    for (const item of lineItems) {
      const deadline = item.sla_hours ? new Date(Date.now() + item.sla_hours * 3600 * 1000) : null;
      await client.query(
        `INSERT INTO order_line_items (project_id, service_type, label, amount, sla_hours, deadline, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'queued',NOW())`,
        [projectId, item.type, item.label, item.amount, item.sla_hours, deadline]
      );
    }

    await client.query(
      `INSERT INTO payment_plans (project_id, plan_type, subtotal, financed_total, installment_amount, installments_total, installments_paid, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,0,'pending_confirmation',NOW())`,
      [projectId, payment_plan, subtotal, financedTotal, installmentAmount, payment_plan === 'financed' ? installmentMonths : 1]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Submission received. A YP Labs specialist will contact you within one business day.', project_id: projectId, submission_id: submissionId, user_id: userId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Wizard submission error:', err);
    res.status(500).json({ error: 'Submission failed. Please try again.' });
  } finally {
    client.release();
  }
});

module.exports = router;
