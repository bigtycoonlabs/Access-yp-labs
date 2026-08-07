const express = require('express');
const { body, validationResult } = require('express-validator');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate, authorize } = require('../middleware/auth');
const weekly = require('../services/clay/weekly');
const subscribers = require('../services/clay/weeklySubscribers');
const announce = require('../services/clay/announce');

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
  if (!out.ok && out.reason === 'nothing_delivered') {
    return res.status(409).json({ error: out.message, detail: out });
  }
  res.json(out);
}));


// GET /api/weekly/announcement/:key — read the exact message before anyone sends it.
router.get('/announcement/:key', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const a = announce.preview(req.params.key);
  if (!a) throw new ApiError(404, 'No announcement by that name.');
  res.json({ announcement: a, already_sent: await announce.alreadySent(req.params.key) });
}));

// POST /api/weekly/announcement/:key/send — mail it to every account holder, once.
// An announcement is an ACCOUNT NOTICE (what you pay, what you own), so it goes to everyone —
// including people who left the magazine. Opting out of a newsletter is not opting out of being
// told your terms changed. It can never be sent twice.
router.post('/announcement/:key/send', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const out = await announce.send(req.params.key);
  if (!out.ok) {
    const why = {
      unknown_announcement: 'No announcement by that name.',
      already_sent: 'That announcement has already gone out. It will not be sent twice.',
      no_recipients: 'There is nobody to send it to.',
      nothing_delivered: 'Nothing was delivered — nobody has been told. It has not been marked as sent, so you can try again.',
    }[out.reason] || 'It could not be sent.';
    return res.status(409).json({ error: why, detail: out });
  }
  res.json(out);
}));


// POST /api/weekly/:id/reject — send an issue back to draft, with a reason.
router.post('/:id/reject', authenticate, authorize('master_staff'), [
  body('reason').optional().isString().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const out = await weekly.reject(req.params.id, req.body.reason || null);
  if (!out.ok) throw new ApiError(out.reason === 'not_found' ? 404 : 409, out.message || 'Could not send it back.');
  res.json(out);
}));

// POST /api/weekly/:id/recompose — throw the draft away and have Clay write the week again.
router.post('/:id/recompose', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const out = await weekly.recompose(req.params.id);
  if (!out.ok) throw new ApiError(out.reason === 'not_found' ? 404 : 409, out.message || 'Could not rewrite it.');
  res.json(out);
}));

// DELETE /api/weekly/:id — remove an issue that was never sent.
router.delete('/:id', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const out = await weekly.remove(req.params.id);
  if (!out.ok) throw new ApiError(out.reason === 'not_found' ? 404 : 409, out.message || 'Could not delete it.');
  res.json(out);
}));


// GET /api/weekly/subscribers — how the list is doing, and the links to share.
router.get('/subscribers', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  const site = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');
  // A link per channel, so a share can be judged on whether it actually brought anyone — otherwise
  // 'we posted it somewhere' is all anyone ever knows.
  const links = ['instagram', 'facebook', 'linkedin', 'x', 'tiktok', 'youtube', 'email', 'card']
    .map((c) => ({ channel: c, url: `${site}/weekly/subscribe?from=${c}` }));
  res.json({ stats: await subscribers.stats(), plain_link: `${site}/weekly/subscribe`, links });
}));

module.exports = router;
