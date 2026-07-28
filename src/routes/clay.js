const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { MODES, CATEGORIES, PLATFORMS, SOCIAL_GOALS } = require('../services/clay/tools');
const spine = require('../services/clay/spine');
const clay = require('../services/clay');
const agent = require('../services/clay/agent');
const image = require('../services/image');
const { sendEmail } = require('../services/email');
const protect = require('../lib/protect');
const router = express.Router();

// Persist a full Clay result: concept (create) or new assets (enhance) + a
// generations row recording the honest result_status. Uses a transaction so a
// partial/failed generation never leaves half-written data.
async function persistResult(ownerId, result, { conceptId = null, mode, category, prompt }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    let concept;
    if (conceptId) {
      const c = await client.query('SELECT * FROM concepts WHERE id=$1 AND owner_id=$2', [conceptId, ownerId]);
      if (!c.rows.length) throw new ApiError(404, 'Concept not found.');
      concept = c.rows[0];
      if (result.risk_summary) {
        await client.query('UPDATE concepts SET risk_summary=$2, updated_at=NOW() WHERE id=$1',
          [concept.id, result.risk_summary]);
      }
    } else {
      const c = await client.query(
        `INSERT INTO concepts (owner_id, title, mode, category, risk_summary)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [ownerId, result.title || 'Untitled concept', mode,
         result.inferred_category || category || null, result.risk_summary || null]);
      concept = c.rows[0];
    }
    for (const a of (result.assets || [])) {
      let scanStatus = 'not_required', scanDetail = null;
      if (protect.needsScan(a.type)) {
        const sc = protect.scanCode(a.body);
        scanStatus = sc.status; scanDetail = sc.detail;
      }
      // Versioning: a new asset of an existing type supersedes the prior current
      // one (kept as history: is_current=false) and increments the version.
      const prev = await client.query(
        'SELECT COALESCE(MAX(version),0) AS maxv FROM assets WHERE concept_id=$1 AND type=$2',
        [concept.id, a.type]);
      const nextVersion = prev.rows[0].maxv + 1;
      if (nextVersion > 1) {
        await client.query(
          'UPDATE assets SET is_current=false WHERE concept_id=$1 AND type=$2 AND is_current=true',
          [concept.id, a.type]);
      }
      await client.query(
        `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, scan_detail, version, is_current)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [concept.id, a.type, a.label, a.body,
         ['business_plan', 'marketing_strategy'].includes(a.type), scanStatus, scanDetail, nextVersion]);
    }
    await client.query(
      `INSERT INTO generations (concept_id, prompt, result_status) VALUES ($1,$2,$3)`,
      [concept.id, prompt || null, result.result_status]);
    await client.query('COMMIT');
    return concept;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// POST /api/clay/generate  { mode, category?, prompt, concept_id? }
router.post('/generate', authenticate, [
  body('mode').isIn(MODES),
  body('category').optional().isIn(CATEGORIES),
  body('prompt').isString().isLength({ min: 3 }),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { mode, category, prompt, concept_id } = req.body;

  const result = await clay.generate({ mode, category, prompt });

  // Honest non-answers: record the run against a concept if we have one, and
  // return the status + message WITHOUT inventing a package.
  if (result.result_status !== 'answered') {
    if (concept_id) {
      await query('INSERT INTO generations (concept_id, prompt, result_status) VALUES ($1,$2,$3)',
        [concept_id, prompt, result.result_status]).catch(() => {});
    }
    return res.status(200).json({
      status: result.result_status,
      redirect: result.redirect || null,
      message: result.message,
      inferred_category: result.inferred_category || null,
    });
  }

  const concept = await persistResult(req.user.id, result, { conceptId: concept_id, mode, category, prompt });
  const assets = await query('SELECT id,type,title,is_baseline FROM assets WHERE concept_id=$1 ORDER BY created_at', [concept.id]);

  // Dual-channel delivery: email the package too. Best-effort; if it doesn't
  // send, we say so honestly rather than claiming a delivery that didn't happen.
  let emailed = { sent: false };
  try {
    emailed = await sendEmail({
      to: req.user.email,
      subject: 'Your concept from Clay: ' + (result.title || 'new concept'),
      html: buildPackageEmail(result.title || concept.title, result.coverage, result.assets),
    });
  } catch (e) { emailed = { sent: false, reason: e.message }; }

  res.status(201).json({
    status: 'answered',
    concept,
    assets: assets.rows,
    coverage: result.coverage,
    emailed: emailed.sent,
    message: result.message + (emailed.sent ? ' A copy was emailed to you.' : ''),
  });
}));

// POST /api/clay/social  { concept_id, platforms[], goal, count? }
// Generates social content (posts, image prompts, video scripts, templates,
// calendar) for a concept you own. Building is free; export/download stays
// gated like any other asset.
router.post('/social', authenticate, [
  body('concept_id').isUUID(),
  body('platforms').isArray({ min: 1 }),
  body('platforms.*').isIn(PLATFORMS),
  body('goal').isIn(SOCIAL_GOALS),
  body('count').optional().isInt({ min: 1, max: 30 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { concept_id, platforms, goal } = req.body;
  const count = req.body.count || 6;

  // Spine guardrail check (enum membership + required params) before acting.
  const check = spine.validateParams('generate_social_content', { concept_id, platforms, goal });
  if (!check.ok) throw new ApiError(400, check.errors.join(' '));

  const c = await query('SELECT id, title, category, risk_summary FROM concepts WHERE id=$1 AND owner_id=$2',
    [concept_id, req.user.id]);
  if (!c.rows.length) throw new ApiError(404, 'Concept not found.');
  const concept = c.rows[0];

  const result = await clay.generateSocial({ concept, platforms, goal, count });

  if (result.result_status !== 'answered') {
    await query('INSERT INTO generations (concept_id, prompt, result_status) VALUES ($1,$2,$3)',
      [concept_id, 'social:' + goal, result.result_status]).catch(() => {});
    return res.status(200).json({ status: result.result_status, message: result.message });
  }

  await persistResult(req.user.id, result,
    { conceptId: concept_id, mode: 'enhance', category: null, prompt: 'social:' + goal + ':' + platforms.join(',') });
  const assets = await query(
    `SELECT id, type, title FROM assets WHERE concept_id=$1 AND is_current=true
     AND type IN ('social_post','image_prompt','video_script','social_template','content_calendar')
     ORDER BY created_at`, [concept_id]);
  res.status(201).json({
    status: 'answered', concept_id, assets: assets.rows, coverage: result.coverage,
    message: result.message,
  });
}));

// POST /api/clay/render-image  { concept_id, prompt }
// Renders a photo/image from a prompt IF an image provider is configured, then
// has Clay DESCRIBE it in plain words for accessibility and verification. Until
// a provider key is set this returns an honest 'unavailable' — nothing faked.
router.post('/render-image', authenticate, [
  body('concept_id').isUUID(),
  body('prompt').isString().isLength({ min: 3 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { concept_id, prompt } = req.body;
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');

  const rendered = await image.renderImage({ prompt });
  if (rendered.status !== 'answered') {
    return res.status(200).json({ status: rendered.status, message: rendered.message });
  }
  // Accessibility: describe the actual rendered pixels so a blind builder can
  // verify the image matches the intent before using it.
  let description = '';
  if (rendered.image_base64) {
    const d = await clay.describeMedia({ imageBase64: rendered.image_base64, mediaType: rendered.media_type });
    description = d.description || '';
  }
  res.status(200).json({
    status: 'answered',
    image_base64: rendered.image_base64 || null,
    url: rendered.url || null,
    media_type: rendered.media_type,
    description,
    message: description
      ? 'Image rendered. Here is a plain description so you can verify it: ' + description
      : 'Image rendered.',
  });
}));

// ---- Conversational, tool-calling Clay (spine-driven) ----
// Reversible tools execute here; irreversible ones (money/publish/delete) can
// never run without explicit confirmation via /chat/confirm.
function buildExecutors(user) {
  return {
    generate_concept: async ({ prompt, category }) => {
      const result = await clay.generate({ mode: 'create', category, prompt });
      if (result.result_status !== 'answered') return { status: result.result_status, message: result.message };
      const concept = await persistResult(user.id, result, { conceptId: null, mode: 'create', category, prompt });
      return { status: 'answered', concept_id: concept.id, title: concept.title, coverage: result.coverage, message: result.message };
    },
    enhance_concept: async ({ concept_id, prompt }) => {
      const result = await clay.generate({ mode: 'enhance', prompt });
      if (result.result_status !== 'answered') return { status: result.result_status, message: result.message };
      const concept = await persistResult(user.id, result, { conceptId: concept_id, mode: 'enhance', category: null, prompt });
      return { status: 'answered', concept_id: concept.id, coverage: result.coverage, message: result.message };
    },
    generate_social_content: async ({ concept_id, platforms, goal, count }) => {
      const c = await query('SELECT id,title,category,risk_summary FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!c.rows.length) return { status: 'error', message: 'Concept not found.' };
      const result = await clay.generateSocial({ concept: c.rows[0], platforms, goal, count: count || 6 });
      if (result.result_status !== 'answered') return { status: result.result_status, message: result.message };
      await persistResult(user.id, result, { conceptId: concept_id, mode: 'enhance', category: null, prompt: 'social:' + goal });
      return { status: 'answered', concept_id, coverage: result.coverage, message: result.message };
    },
  };
}

// POST /api/clay/chat  { messages: [...] }
router.post('/chat', authenticate, [body('messages').isArray({ min: 1 })], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const out = await agent.runChat({ messages: req.body.messages, executors: buildExecutors(req.user) });
  res.json(out);
}));

// POST /api/clay/chat/confirm  { tool, params }  — run a confirmed action.
// Money and publishing hand off to the vetted UI flows; delete executes here.
router.post('/chat/confirm', authenticate, [
  body('tool').isString(), body('params').isObject(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { tool, params } = req.body;
  const plan = agent.planToolInvocation(tool, params, { confirmed: true });
  if (plan.action === 'reject') throw new ApiError(400, plan.reason);

  if (tool === 'list_on_marketplace') {
    return res.json({ status: 'handoff', action: 'list', url: '/sell.html',
      message: 'Opening the listing flow so you can review and publish it yourself.' });
  }
  if (tool === 'purchase_concept') {
    return res.json({ status: 'handoff', action: 'purchase',
      url: '/listing.html?id=' + encodeURIComponent(params.listing_id || ''),
      message: 'Opening the listing so you can complete the purchase.' });
  }
  if (tool === 'remove_concept') {
    const r = await query('DELETE FROM concepts WHERE id=$1 AND owner_id=$2 RETURNING id', [params.concept_id, req.user.id]);
    if (!r.rows.length) throw new ApiError(404, 'Concept not found.');
    return res.json({ status: 'done', message: 'Concept deleted.' });
  }
  const exec = buildExecutors(req.user)[tool];
  if (exec) return res.json({ status: 'done', result: await exec(params) });
  throw new ApiError(400, 'Unknown action.');
}));

// GET /api/clay/status — is generation actually available right now? (honest)
router.get('/status', authenticate, (req, res) => {
  const available = !!process.env.ANTHROPIC_API_KEY;
  res.json({ available, model: clay.MODEL, image_rendering: image.configured(),
    message: available ? 'Clay is ready.' : 'Clay generation is not configured yet.' });
});


function escapeHtml(t){return String(t==null?'':t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function buildPackageEmail(title, coverage, assets){
  const parts = (assets||[]).map(a =>
    '<h2 style="color:#7c2d12;font-family:system-ui,sans-serif">'+escapeHtml(a.label||a.type)+'</h2>'+
    '<div style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">'+escapeHtml(a.body)+'</div>');
  const gap = coverage && !coverage.complete ? '<p style="color:#57534e">'+escapeHtml(coverage.gap_description)+'</p>' : '';
  return '<div style="max-width:640px;margin:0 auto">'+
    '<h1 style="font-family:system-ui,sans-serif;color:#1c1917">'+escapeHtml(title)+'</h1>'+
    '<p style="font-family:system-ui,sans-serif">Your concept package from Clay at Access YP Labs. You also have it in your workspace.</p>'+
    gap + parts.join('') +
    '<hr/><p style="color:#57534e;font-size:13px;font-family:system-ui,sans-serif">The Kiln is a neutral marketplace. Concepts are pre-proven starting points, not guarantees of income.</p></div>';
}

module.exports = router;
