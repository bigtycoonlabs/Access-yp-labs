const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { MODES, CATEGORIES, PLATFORMS, SOCIAL_GOALS } = require('../services/clay/tools');
const spine = require('../services/clay/spine');
const clay = require('../services/clay');
const provider = require('../services/clay/provider');
const journal = require('../services/clay/journal');
const { conceptEntitlement } = require('../lib/entitlement');
const agent = require('../services/clay/agent');
const research = require('../services/clay/research');
const image = require('../services/image');
const video = require('../services/video');
const describe = require('../lib/describe');
const { sendEmail } = require('../services/email');
const protect = require('../lib/protect');
const router = express.Router();

// Persist a full Clay result: concept (create) or new assets (enhance) + a
// generations row recording the honest result_status. Uses a transaction so a
// partial/failed generation never leaves half-written data.
async function persistResult(ownerId, result, { conceptId = null, mode, category, prompt, operating = false }) {
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
      // Proof is a high-water mark: refresh it only when THIS run was grounded,
      // so an ungrounded follow-up edit never erases earned substantiation.
      if (result.research_grounded) {
        await client.query(
          'UPDATE concepts SET research_grounded=true, claims_verified=$2, source_count=$3, updated_at=NOW() WHERE id=$1',
          [concept.id, (typeof result.claims_verified === 'boolean' ? result.claims_verified : null), result.source_count || 0]);
      }
    } else {
      const c = await client.query(
        `INSERT INTO concepts (owner_id, title, mode, category, risk_summary, is_operating,
           research_grounded, claims_verified, source_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ownerId, result.title || 'Untitled concept', mode,
         result.inferred_category || category || null, result.risk_summary || null, !!operating,
         !!result.research_grounded,
         (typeof result.claims_verified === 'boolean' ? result.claims_verified : null),
         result.source_count || 0]);
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
  body('operating').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { mode, category, prompt, concept_id } = req.body;
  const operating = !!req.body.operating;

  const t0 = Date.now();
  const providerAvailable = provider.available();
  const result = await clay.generate({ mode, category, prompt, operating });
  const durationMs = Date.now() - t0;

  // Honest non-answers: record the run against a concept if we have one, and
  // return the status + message WITHOUT inventing a package.
  if (result.result_status !== 'answered') {
    if (concept_id) {
      await query('INSERT INTO generations (concept_id, prompt, result_status) VALUES ($1,$2,$3)',
        [concept_id, prompt, result.result_status]).catch(() => {});
    }
    await journal.recordRun({ actorId: req.user.id, kind: 'generate', mode, category,
      conceptId: concept_id || null, resultStatus: result.result_status, providerAvailable,
      grounded: !!result.research_grounded, sourceCount: result.source_count || 0,
      reason: result.message || result.redirect || null, durationMs });
    return res.status(200).json({
      status: result.result_status,
      redirect: result.redirect || null,
      message: result.message,
      inferred_category: result.inferred_category || null,
    });
  }

  // Fail closed: an "answered" with no actual package is not a real answer. Never
  // persist a hollow concept — record it honestly as empty and invent nothing.
  if (!result.assets || !result.assets.length) {
    await journal.recordRun({ actorId: req.user.id, kind: 'generate', mode, category,
      conceptId: concept_id || null, resultStatus: 'empty', providerAvailable,
      grounded: !!result.research_grounded, sourceCount: result.source_count || 0,
      reason: 'answered_with_no_assets', durationMs });
    return res.status(200).json({
      status: 'empty',
      message: result.message || 'Clay came back without a complete package, so nothing was saved and nothing was made up. Give it another go.',
      inferred_category: result.inferred_category || null,
    });
  }

  const concept = await persistResult(req.user.id, result, { conceptId: concept_id, mode, category, prompt, operating });
  await journal.recordRun({ actorId: req.user.id, kind: 'generate', mode, category,
    conceptId: concept.id, resultStatus: 'answered', providerAvailable,
    grounded: !!result.research_grounded, sourceCount: result.source_count || 0, durationMs });
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

  // Surface entitlement at delivery so Clay can frame it honestly and positively:
  // the build is free to explore; downloading/keeping is where a plan comes in.
  // (Staff and Sculptor users come back entitled, so no upsell is shown to them.)
  const ent = await conceptEntitlement(req.user, concept.id);

  res.status(201).json({
    status: 'answered',
    concept,
    assets: assets.rows,
    entitled: ent.entitled,
    coverage: result.coverage,
    dreamhold_suggestion: result.dreamhold_suggestion || null,
    source_check: result.source_check || null,
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

  const t0 = Date.now();
  const providerAvailable = provider.available();
  const result = await clay.generateSocial({ concept, platforms, goal, count });
  const durationMs = Date.now() - t0;

  if (result.result_status !== 'answered') {
    await query('INSERT INTO generations (concept_id, prompt, result_status) VALUES ($1,$2,$3)',
      [concept_id, 'social:' + goal, result.result_status]).catch(() => {});
    await journal.recordRun({ actorId: req.user.id, kind: 'social', mode: 'enhance', category: concept.category || null,
      conceptId: concept_id, resultStatus: result.result_status, providerAvailable,
      reason: result.message || null, durationMs });
    return res.status(200).json({ status: result.result_status, message: result.message });
  }

  await persistResult(req.user.id, result,
    { conceptId: concept_id, mode: 'enhance', category: null, prompt: 'social:' + goal + ':' + platforms.join(',') });
  await journal.recordRun({ actorId: req.user.id, kind: 'social', mode: 'enhance', category: concept.category || null,
    conceptId: concept_id, resultStatus: 'answered', providerAvailable, durationMs });
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
    list_my_concepts: async () => {
      const r = await query('SELECT id, title, category, stage FROM concepts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 50', [user.id]);
      return { concepts: r.rows };
    },
    get_concept: async ({ concept_id }) => {
      const c = await query('SELECT id, title, category, stage, risk_summary FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!c.rows.length) return { error: 'Concept not found.' };
      const a = await query("SELECT type, title FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at", [concept_id]);
      return { concept: c.rows[0], materials: a.rows };
    },
    search_marketplace: async ({ query: q, category }) => {
      const clauses = ["l.status='live'"]; const args = [];
      if (category) { args.push(category); clauses.push(`c.category=$${args.length}`); }
      if (q) { args.push('%' + q + '%'); clauses.push(`(c.title ILIKE $${args.length} OR c.risk_summary ILIKE $${args.length})`); }
      const r = await query(
        `SELECT l.id, c.title, c.category, l.format, l.price_cents, l.starting_bid_cents
         FROM listings l JOIN concepts c ON c.id=l.concept_id
         WHERE ${clauses.join(' AND ')} ORDER BY l.created_at DESC LIMIT 25`, args);
      return { listings: r.rows };
    },
    get_listing: async ({ listing_id }) => {
      const r = await query(
        `SELECT l.id, l.format, l.price_cents, l.starting_bid_cents, c.title, c.category, c.risk_summary
         FROM listings l JOIN concepts c ON c.id=l.concept_id WHERE l.id=$1 AND l.status='live'`, [listing_id]);
      if (!r.rows.length) return { error: 'Listing not found.' };
      const d = await query(
        `SELECT body FROM assets WHERE concept_id=(SELECT concept_id FROM listings WHERE id=$1)
         AND is_current=true AND type IN ('html_demo','built_site') ORDER BY created_at DESC LIMIT 1`, [listing_id]);
      const demo = d.rows.length ? describe.outline(d.rows[0].body) : null;
      return { listing: r.rows[0], demo_description: demo ? { items: demo.items, accessibility: demo.a11y.summary } : null };
    },
    research: async ({ query: q }) => {
      const r = await research.search(q, { maxResults: 5 });
      if (!r.available) {
        return { available: false, note: 'Live research isn\'t connected, so I can\'t look this up on the web right now — and I won\'t pretend I did. Tell the user plainly, and only offer your own reasoning clearly labelled as such.' };
      }
      if (!r.results.length) {
        return { available: true, query: q, sources: [], note: r.reason === 'empty_query' ? 'No query given.' : 'The search came back empty. Say so; do not invent findings.' };
      }
      return { available: true, query: q, answer: r.answer || null, sources: r.results };
    },
    read_source: async ({ url }) => {
      const r = await research.extract(url);
      if (!r.available) {
        return { available: false, note: 'Live research isn\'t connected, so I can\'t open that source — and I won\'t summarise a page I didn\'t read.' };
      }
      if (!r.content) {
        return { available: true, url, content: '', note: 'I couldn\'t pull readable text from that page. Say so; don\'t invent what it says.' };
      }
      return { available: true, url, content: r.content };
    },
    generate_concept: async ({ prompt, category }) => {
      const result = await clay.generate({ mode: 'create', category, prompt });
      if (result.result_status !== 'answered') return { status: result.result_status, message: result.message };
      const concept = await persistResult(user.id, result, { conceptId: null, mode: 'create', category, prompt });
      return { status: 'answered', concept_id: concept.id, title: concept.title, coverage: result.coverage, source_check: result.source_check || null, message: result.message };
    },
    enhance_concept: async ({ concept_id, prompt }) => {
      const result = await clay.generate({ mode: 'enhance', prompt });
      if (result.result_status !== 'answered') return { status: result.result_status, message: result.message };
      const concept = await persistResult(user.id, result, { conceptId: concept_id, mode: 'enhance', category: null, prompt });
      return { status: 'answered', concept_id: concept.id, coverage: result.coverage, source_check: result.source_check || null, message: result.message };
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

// POST /api/clay/fix-demo  { concept_id }  — Clay repairs the demo's accessibility.
router.post('/fix-demo', authenticate, [body('concept_id').isUUID()], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { concept_id } = req.body;
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  const d = await query(
    `SELECT id, type, title, body FROM assets WHERE concept_id=$1 AND is_current=true
     AND type IN ('html_demo','built_site') ORDER BY created_at DESC LIMIT 1`, [concept_id]);
  if (!d.rows.length) throw new ApiError(404, 'This concept has no demo to fix.');
  const asset = d.rows[0];
  const before = describe.outline(asset.body);
  if (before.a11y.ok) return res.json({ status: 'already_ok', message: 'This demo already passes the accessibility check.', a11y: before.a11y });

  const fixed = await clay.remediateDemo({ html: asset.body, issues: before.a11y.issues });
  if (fixed.status !== 'answered') return res.status(200).json({ status: fixed.status, message: fixed.message });
  const after = describe.outline(fixed.html);

  const prev = await query('SELECT COALESCE(MAX(version),0) AS maxv FROM assets WHERE concept_id=$1 AND type=$2', [concept_id, asset.type]);
  await query('UPDATE assets SET is_current=false WHERE concept_id=$1 AND type=$2 AND is_current=true', [concept_id, asset.type]);
  const ins = await query(
    `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, version, is_current)
     VALUES ($1,$2,$3,$4,false,'not_required',$5,true) RETURNING id`,
    [concept_id, asset.type, asset.title || 'Demo', fixed.html, prev.rows[0].maxv + 1]);
  res.json({ status: 'answered', message: 'Clay repaired the demo. ' + after.a11y.summary,
    before: before.a11y, after: after.a11y, asset_id: ins.rows[0].id });
}));

// POST /api/clay/render-video  { concept_id, prompt }
// Renders a short video from a script/prompt IF a video provider is configured;
// honest 'unavailable' otherwise. (Rendered video isn't auto-described — that
// needs frame extraction; use the video script/storyboard for the spoken version.)
router.post('/render-video', authenticate, [
  body('concept_id').isUUID(),
  body('prompt').isString().isLength({ min: 3 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { concept_id, prompt } = req.body;
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  const rendered = await video.renderVideo({ prompt });
  if (rendered.status !== 'answered') return res.status(200).json({ status: rendered.status, message: rendered.message });
  res.status(200).json({ status: 'answered', url: rendered.url, message: 'Video rendered.' });
}));

// GET /api/clay/status — is generation actually available right now? (honest)
router.get('/status', authenticate, (req, res) => {
  const available = clay.available();
  res.json({ available, provider: clay.providerName(), model: clay.modelName(),
    image_rendering: image.configured(), video_rendering: video.configured(),
    research: research.available(),
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
    '<p style="font-family:system-ui,sans-serif">Your concept package from Clay at Access YP Labs. You also have it in your laboratory.</p>'+
    gap + parts.join('') +
    '<hr/><p style="color:#57534e;font-size:13px;font-family:system-ui,sans-serif">The Dreamhold is a neutral marketplace. Concepts are pre-proven starting points, not guarantees of income.</p></div>';
}

// GET /api/clay/pending-idea — the idea a new user handed Clay before signing up.
// Returned once, then cleared, so the workspace greets them with it exactly once.
router.get('/pending-idea', authenticate, asyncHandler(async (req, res) => {
  const r = await query('SELECT pending_idea FROM users WHERE id=$1', [req.user.id]);
  const idea = r.rows[0] ? r.rows[0].pending_idea : null;
  if (idea) await query('UPDATE users SET pending_idea=NULL WHERE id=$1', [req.user.id]);
  res.json({ idea: idea || null });
}));

// GET /api/clay/journal — staff-only health view over Clay's append-only audit
// trail. Aggregates + the most recent runs, so staff can hear at a glance whether
// Clay is up, answering, and grounding — and catch a bad stretch early. It reports
// only what happened; it never stores or shows the user's idea text.
router.get('/journal', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  const summary = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last_24h,
      COUNT(*) FILTER (WHERE result_status='answered')::int AS answered,
      COUNT(*) FILTER (WHERE result_status='empty')::int AS empty,
      COUNT(*) FILTER (WHERE result_status='unavailable')::int AS unavailable,
      COUNT(*) FILTER (WHERE result_status NOT IN ('answered','empty','unavailable'))::int AS other,
      COUNT(*) FILTER (WHERE grounded)::int AS grounded,
      COUNT(*) FILTER (WHERE provider_available IS TRUE)::int AS provider_up,
      COUNT(*) FILTER (WHERE provider_available IS FALSE)::int AS provider_down,
      COALESCE(ROUND(AVG(duration_ms))::int, 0) AS avg_ms
    FROM clay_runs`);
  const recent = await query(`
    SELECT kind, mode, category, result_status, provider_available, grounded,
           source_count, reason, duration_ms, created_at
    FROM clay_runs ORDER BY created_at DESC LIMIT 50`);
  res.json({ summary: summary.rows[0], recent: recent.rows });
}));

module.exports = router;
