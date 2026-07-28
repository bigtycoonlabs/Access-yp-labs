// Dreamhold customization — the interests, existing-business context, and launch
// budget Clay collects at the door so the right dreams leap at each user without
// overwhelming them. Read/written only by the signed-in user.
const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { CATEGORIES } = require('../services/clay/tools');

const router = express.Router();

// Human labels for the interest categories (what kind of ideas excite them).
const CATEGORY_LABELS = {
  digital_product_saas: 'Digital products & SaaS',
  online_service_agency: 'Online services & agencies',
  content_creator: 'Content & creator businesses',
  ecommerce_pod: 'E-commerce & print-on-demand',
  ai_product_service: 'AI products & services',
  remote_hybrid_physical: 'Remote/hybrid physical',
  micro_solo: 'Micro & solo businesses',
};
const BUDGETS = [
  { id: 'under_150', label: 'Under $150' },
  { id: 'under_500', label: 'Under $500' },
  { id: 'under_1000', label: 'Under $1,000' },
  { id: 'under_5000', label: 'Under $5,000' },
  { id: 'under_10000', label: 'Under $10,000' },
  { id: 'under_50000', label: 'Under $50,000' },
];
const BUDGET_IDS = BUDGETS.map((b) => b.id);

// Options the onboarding UI renders.
router.get('/options', authenticate, (req, res) => {
  res.json({ categories: CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c] || c })), budgets: BUDGETS });
});

// The signed-in user's saved customization (defaults if none yet).
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const r = await query('SELECT interests, runs_business, business_kind, launch_budget, onboarded FROM user_preferences WHERE user_id=$1', [req.user.id]);
  res.json({ preferences: r.rows[0] || { interests: [], runs_business: false, business_kind: '', launch_budget: '', onboarded: false } });
}));

// Upsert the customization. Validates interests are real categories and the
// budget is a known tier — nothing free-form gets into the personalization.
router.put('/', authenticate, [
  body('interests').optional().isArray(),
  body('runs_business').optional().isBoolean(),
  body('business_kind').optional().isString().isLength({ max: 200 }),
  body('launch_budget').optional().isString(),
  body('onboarded').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const interests = (req.body.interests || []).filter((i) => CATEGORIES.includes(i));
  const runs = !!req.body.runs_business;
  const kind = runs ? String(req.body.business_kind || '').slice(0, 200) : '';
  const budget = req.body.launch_budget && BUDGET_IDS.includes(req.body.launch_budget) ? req.body.launch_budget : '';
  const onboarded = req.body.onboarded === undefined ? true : !!req.body.onboarded;

  const r = await query(
    `INSERT INTO user_preferences (user_id, interests, runs_business, business_kind, launch_budget, onboarded)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET
       interests=EXCLUDED.interests, runs_business=EXCLUDED.runs_business,
       business_kind=EXCLUDED.business_kind, launch_budget=EXCLUDED.launch_budget,
       onboarded=EXCLUDED.onboarded, updated_at=now()
     RETURNING interests, runs_business, business_kind, launch_budget, onboarded`,
    [req.user.id, interests, runs, kind, budget, onboarded]);
  res.json({ preferences: r.rows[0] });
}));

module.exports = router;
module.exports.BUDGETS = BUDGETS;
module.exports.CATEGORY_LABELS = CATEGORY_LABELS;
