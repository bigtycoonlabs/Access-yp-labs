const express = require('express');
const { body, validationResult } = require('express-validator');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate, authorize } = require('../middleware/auth');
const weekly = require('../services/clay/weekly');

// Staff controls for Clay Weekly. Every step that reaches a real person — asking a creator for
// permission, publishing an issue, mailing it to everyone — requires a human here. Clay assembles;
// an owner decides.

const router = express.Router();

// GET /api/weekly — recent issues and their state (staff).
router.get('/', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  res.json({ issues: await weekly.listForStaff(10) });
}));

// GET /api/weekly/candidates — projects Clay could feature, with the signals behind each.
router.get('/candidates', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  const rows = await weekly.sponsorCandidates(8);
  res.json({
    candidates: rows.map((c) => ({
      concept_id: c.id, title: c.title, owner_name: c.owner_name,
      signals: [c.listed ? 'listed in the Dream Market' : null,
        c.has_site ? 'has a working site' : null,
        c.movement_state ? 'creator says: ' + c.movement_state : null].filter(Boolean),
    })),
  });
}));

// POST /api/weekly/compose — assemble (or rebuild) this week's DRAFT. Never publishes, never sends.
router.post('/compose', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  res.json(await weekly.composeIssue({ weekStart: req.body && req.body.week_start }));
}));

// POST /api/weekly/sponsor — ASK a creator if they want the sponsored slot. Sends them an email
// with accept and decline links; nobody is featured without saying yes.
router.post('/sponsor', authenticate, authorize('master_staff'), [
  body('concept_id').isUUID(),
  body('reason').optional().isString().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const out = await weekly.offerSponsorship({ conceptId: req.body.concept_id, reason: req.body.reason });
  if (!out.ok) throw new ApiError(404, 'That project could not be found.');
  res.json(out);
}));

// POST /api/weekly/:id/approve — an owner approves the issue's content.
router.post('/:id/approve', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const out = await weekly.approve(req.params.id, req.user.id);
  if (!out) throw new ApiError(409, 'That issue is not a draft — it may already be approved or published.');
  res.json({ approved: out });
}));

// POST /api/weekly/:id/publish — make it public. Still does NOT email anyone.
router.post('/:id/publish', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const out = await weekly.publish(req.params.id);
  if (!out) throw new ApiError(409, 'That issue is not approved yet.');
  res.json({ published: out, note: 'It is public now. Sending it by email is a separate, deliberate step.' });
}));

// POST /api/weekly/:id/send — mail a published issue to everyone who wants it. Deliberately
// separate from publishing, and it reports only what the mail provider actually accepted.
router.post('/:id/send', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const out = await weekly.sendIssue(req.params.id);
  if (!out.ok) {
    const why = {
      not_found: 'That issue does not exist.',
      not_published: 'Publish the issue first — only a published issue can be mailed.',
      already_sent: 'That issue has already been sent. It will not be sent twice.',
      no_recipients: 'Nobody is currently subscribed to Clay Weekly, so nothing was sent.',
    }[out.reason] || 'It could not be sent.';
    return res.status(409).json({ error: why, detail: out });
  }
  res.json(out);
}));

module.exports = router;
