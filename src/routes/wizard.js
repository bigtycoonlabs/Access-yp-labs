const express = require('express');
const { body, validationResult } = require('express-validator');
const { getClient } = require('../config/db');
const { calculateQuote, SERVICE_CATALOG } = require('../services/pricing');

const router = express.Router();
const NOTIFY_EMAIL = process.env.NOTIFICATION_EMAIL_TO || 'Success@accessyourplace.com';

function timelineFor(track, cart = []) {
  const count = track === 'A' ? 7 : [...new Set(cart || [])].length;
  if (track === 'A' || count > 3) return '7 to 14 business days for a full technology package or custom buildout.';
  return '24 to 72 hours for one to three focused modules after onboarding assets are received.';
}

function recommendedModules(answers = {}, track, cart = []) {
  const selected = new Set(cart || []);
  if (track === 'A') ['marketing_site','booking_engine','ai_concierge','web_portal','sop_manual','va_dashboard'].forEach((x) => selected.add(x));
  if (answers.lead_strategies === 'ota_only') selected.add('booking_engine');
  if (answers.has_va === 'no' || answers.guest_comm_struggle === 'yes') selected.add('ai_concierge');
  if (answers.has_systems === 'no') { selected.add('sop_manual'); selected.add('va_dashboard'); }
  if (Number(answers.units || 0) >= 5) selected.add('web_portal');
  return [...selected].filter((id) => SERVICE_CATALOG[id]).map((id) => ({ id, label: SERVICE_CATALOG[id].label }));
}

function buildBusinessPlan({ contact, housing_type, channel, mission, answers, track, cart, quote }) {
  const modules = recommendedModules(answers, track, cart);
  const unitCount = Number(answers.units || 0);
  const summary = `${contact.business_name || contact.name}'s blueprint is focused on converting the housing operation from platform-dependent lead flow into an owned business engine with direct lead capture, AI-assisted communication, documented operations, and dashboard visibility.`;
  const gaps = [];
  if (answers.has_systems === 'no') gaps.push('daily operations need documented SOPs and clearer task ownership');
  if (answers.has_va === 'no') gaps.push('guest communication coverage is not yet delegated or systemized');
  if (answers.lead_strategies === 'ota_only') gaps.push('lead generation is too dependent on online travel agencies');
  if (answers.local_partnerships === 'no') gaps.push('local partnerships and sponsorship opportunities are not being fully leveraged');
  if (!gaps.length) gaps.push('existing systems should be connected into a cleaner growth stack');
  return {
    summary,
    company: contact.business_name || null,
    housing_type,
    portfolio_units: unitCount,
    housing_mix: answers.housing_mix || null,
    current_channels: channel || answers.ota_channels || null,
    biggest_struggle: answers.biggest_struggle || mission || null,
    operational_gaps: gaps,
    recommended_modules: modules,
    buildout_scope: [
      'Review current lead sources, portfolio model, guest communication workflow, and daily operations.',
      'Map the direct booking and lead generation path, including Google-ready business and lead capture infrastructure where appropriate.',
      'Configure recommended technology modules, AI receptionist workflows, SOP assets, and dashboard access.',
      'Prepare client workspace for messages, files, invoice updates, and implementation milestones.',
      'Schedule strategy call so the team can confirm scope, timeline, and execution priorities.'
    ],
    execution_timeline: timelineFor(track, cart),
    estimated_setup: quote.subtotal,
    estimated_monthly: quote.monthlyMaintenance,
    finance_option: quote.installmentAmount ? `${quote.installmentMonths} payments of approximately $${quote.installmentAmount}` : null,
  };
}

async function ensureBlueprintColumns(client) {
  await client.query(`ALTER TABLE wizard_submissions ADD COLUMN IF NOT EXISTS answers JSONB`);
  await client.query(`ALTER TABLE wizard_submissions ADD COLUMN IF NOT EXISTS business_plan JSONB`);
  await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS business_plan JSONB`);
  await client.query(`CREATE TABLE IF NOT EXISTS notification_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), event_type VARCHAR(80) NOT NULL, recipient VARCHAR(255) NOT NULL, subject TEXT NOT NULL, payload JSONB, status VARCHAR(40) NOT NULL DEFAULT 'queued', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}

async function queueNotification(client, eventType, subject, payload) {
  await client.query(`INSERT INTO notification_events (event_type, recipient, subject, payload) VALUES ($1,$2,$3,$4)`, [eventType, NOTIFY_EMAIL, subject, payload]);
}

router.post('/quote', [body('track').isIn(['A', 'B']), body('payment_plan').optional().isIn(['one_time', 'financed'])], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try { res.json(calculateQuote({ track: req.body.track, cart: req.body.cart || [], payment_plan: req.body.payment_plan || 'financed' })); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/submit', [
  body('track').isIn(['A', 'B']),
  body('payment_plan').isIn(['one_time', 'financed']),
  body('contact.name').trim().notEmpty(),
  body('contact.email').isEmail().normalizeEmail(),
  body('contact.phone').optional({ checkFalsy: true }).trim().isLength({ max: 50 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { track, housing_type, channel, mission, brand_color, cart, payment_plan, contact, answers = {}, strategy_call } = req.body;
  let quote;
  try { quote = calculateQuote({ track, cart, payment_plan }); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const businessPlan = buildBusinessPlan({ contact, housing_type, channel, mission, answers, track, cart, quote });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await ensureBlueprintColumns(client);

    let userResult = await client.query('SELECT id FROM users WHERE email = $1', [contact.email]);
    let userId;
    if (!userResult.rows.length) {
      const newUser = await client.query(`INSERT INTO users (email, name, phone, business_name, role, status, created_at) VALUES ($1,$2,$3,$4,'client','pending',NOW()) RETURNING id`, [contact.email, contact.name, contact.phone || null, contact.business_name || answers.company_name || null]);
      userId = newUser.rows[0].id;
    } else {
      userId = userResult.rows[0].id;
      await client.query(`UPDATE users SET name = COALESCE($1,name), phone = COALESCE($2,phone), business_name = COALESCE($3,business_name), updated_at = NOW() WHERE id = $4`, [contact.name || null, contact.phone || null, contact.business_name || answers.company_name || null, userId]);
    }

    const { lineItems, subtotal, financedTotal, installmentAmount, hostingMonthly, installmentMonths } = quote;
    const subResult = await client.query(`INSERT INTO wizard_submissions (user_id, track, housing_type, channel, mission, brand_color, payment_plan, subtotal, answers, business_plan, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`, [userId, track, housing_type || null, channel || answers.ota_channels || null, mission || answers.biggest_struggle || null, brand_color || null, payment_plan, subtotal, answers, businessPlan]);
    const submissionId = subResult.rows[0].id;
    const projResult = await client.query(`INSERT INTO projects (user_id, wizard_submission_id, track, status, payment_plan, subtotal, financed_total, installment_amount, hosting_monthly, business_plan, created_at) VALUES ($1,$2,$3,'awaiting_strategy_call',$4,$5,$6,$7,$8,$9,NOW()) RETURNING id`, [userId, submissionId, track, payment_plan, subtotal, financedTotal, installmentAmount, hostingMonthly, businessPlan]);
    const projectId = projResult.rows[0].id;

    for (const item of lineItems) {
      const deadline = item.sla_hours ? new Date(Date.now() + item.sla_hours * 3600 * 1000) : null;
      await client.query(`INSERT INTO order_line_items (project_id, service_type, label, amount, sla_hours, deadline, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'queued',NOW())`, [projectId, item.type, item.label, item.amount, item.sla_hours, deadline]);
    }
    await client.query(`INSERT INTO payment_plans (project_id, plan_type, subtotal, financed_total, installment_amount, installments_total, installments_paid, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,0,'pending_confirmation',NOW())`, [projectId, payment_plan, subtotal, financedTotal, installmentAmount, payment_plan === 'financed' ? installmentMonths : 1]);

    let appointment = null;
    if (strategy_call?.scheduled_at) {
      const appt = await client.query(`INSERT INTO appointments (lead_name, lead_email, scheduled_at, duration_minutes, type, platform, project_id, created_at) VALUES ($1,$2,$3,$4,'strategy_call','google_meet',$5,NOW()) RETURNING *`, [contact.name, contact.email, strategy_call.scheduled_at, strategy_call.duration_minutes || 30, projectId]);
      appointment = appt.rows[0];
      await queueNotification(client, 'strategy_call_scheduled', `New YP Labs strategy call: ${contact.business_name || contact.name}`, { contact, project_id: projectId, appointment, businessPlan });
    }
    await queueNotification(client, 'new_client_signup', `New YP Labs blueprint request: ${contact.business_name || contact.name}`, { contact, project_id: projectId, submission_id: submissionId, businessPlan });

    await client.query('COMMIT');
    res.status(201).json({ message: 'Blueprint created. Create your client login and schedule or confirm your strategy call.', project_id: projectId, submission_id: submissionId, user_id: userId, quote, business_plan: businessPlan, appointment });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Wizard submission error:', err);
    res.status(500).json({ error: 'Submission failed. Please try again.' });
  } finally { client.release(); }
});

module.exports = router;
