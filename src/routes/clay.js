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
const retrieval = require('../services/clay/retrieval');
const health = require('../services/clay/health');
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
    // Drift guard: if the model produces an asset type the DB enum doesn't recognize yet
    // (code/schema drift — exactly what broke a build before), skip that one section
    // rather than crash the whole build. The concept still saves with everything else,
    // and skipping BEFORE any insert keeps the transaction clean. The valid set is read
    // live from the DB, so it's always current.
    const validTypes = new Set((await client.query(
      "SELECT e.enumlabel AS t FROM pg_enum e JOIN pg_type ty ON ty.oid=e.enumtypid JOIN pg_namespace n ON n.oid=ty.typnamespace WHERE ty.typname='asset_type' AND n.nspname='yp_labs'"
    )).rows.map((r) => r.t));
    for (const a of (result.assets || [])) {
      if (!validTypes.has(a.type)) continue;
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
// Background build: writing a full concept takes 1–3 minutes, so we never make the user
// wait on the request. The route returns immediately with a "building" message and this
// runs after — persisting the concept and emailing the finished package (or an honest
// outcome) when done. It handles and reports its own failures; it must never throw out.
async function runBuild({ user, mode, category, prompt, operating, conceptId, buildId = null }) {
  const t0 = Date.now();
  const providerAvailable = provider.available();
  const onProgress = (text) => addBuildNote(buildId, text);
  try {
    // Retrieval grounding: the user's own related prior work (best-effort, never blocks).
    const priorWork = await retrieval.relatedConcepts(user.id, prompt, { limit: 3, excludeId: conceptId || null });
    const result = await clay.generate({ mode, category, prompt, operating, priorWork, onProgress });
    const durationMs = Date.now() - t0;

    // Honest non-answer (redirect / refused / unavailable): record it and email the
    // outcome so the user always hears back — never invent a package.
    if (result.result_status !== 'answered') {
      if (conceptId) {
        await query('INSERT INTO generations (concept_id, prompt, result_status) VALUES ($1,$2,$3)',
          [conceptId, prompt, result.result_status]).catch(() => {});
      }
      await journal.recordRun({ actorId: user.id, kind: 'generate', mode, category,
        conceptId: conceptId || null, resultStatus: result.result_status, providerAvailable,
        grounded: !!result.research_grounded, sourceCount: result.source_count || 0,
        reason: result.message || result.redirect || null, durationMs });
      health.checkAndAlert().catch(() => {});
      { const m = result.message || 'Clay couldn’t complete this one. Nothing was fabricated — try again with a bit more detail.';
        await notifyBuildOutcome(user, m);
        await finishBuild(buildId, { status: 'failed', message: m, note: m }); }
      return;
    }

    // Fail closed: "answered" with no package is not a real answer. Save nothing.
    if (!result.assets || !result.assets.length) {
      await journal.recordRun({ actorId: user.id, kind: 'generate', mode, category,
        conceptId: conceptId || null, resultStatus: 'empty', providerAvailable,
        grounded: !!result.research_grounded, sourceCount: result.source_count || 0,
        reason: 'answered_with_no_assets', durationMs });
      health.checkAndAlert().catch(() => {});
      { const m = 'Clay came back without a complete package, so nothing was saved and nothing was made up. Please try again.';
        await notifyBuildOutcome(user, m);
        await finishBuild(buildId, { status: 'failed', message: m, note: m }); }
      return;
    }

    await onProgress('Saving your concept and its sections…');
    const concept = await persistResult(user.id, result, { conceptId, mode, category, prompt, operating });
    await journal.recordRun({ actorId: user.id, kind: 'generate', mode, category,
      conceptId: concept.id, resultStatus: 'answered', providerAvailable,
      grounded: !!result.research_grounded, sourceCount: result.source_count || 0, durationMs });
    retrieval.embedAndStore(concept.id, [result.title, result.risk_summary, prompt].filter(Boolean).join('. ')).catch(() => {});

    // Email the package — but CHECK the result and be honest. If it didn't send, we say
    // so and point to the Laboratory rather than promising a mail that isn't coming.
    let emailed = { sent: false, reason: 'unknown' };
    try {
      emailed = await sendEmail({
        to: user.email,
        subject: 'Your concept is ready: ' + (result.title || concept.title || 'new concept'),
        html: buildPackageEmail(result.title || concept.title, result.coverage, result.assets, concept.id),
      });
    } catch (e) { emailed = { sent: false, reason: (e && e.message) ? e.message : 'error' }; }
    if (!emailed.sent) console.error('package email NOT sent for concept', concept.id, '- reason:', emailed.reason);
    await logEmail(user.email, 'concept_package', emailed);
    const doneMsg = emailed.sent
      ? 'Your concept is ready — it’s open here, saved in your Laboratory, and on its way to your email.'
      : 'Your concept is ready and saved in your Laboratory. I could not email it this time, so open it right here — nothing was lost.';
    await finishBuild(buildId, { status: 'done', conceptId: concept.id, message: doneMsg,
      note: emailed.sent
        ? 'Done — your concept is ready, and I’ve emailed it to you.'
        : 'Done — your concept is ready. (I couldn’t send the email this time — open it from the link.)' });
  } catch (e) {
    const durationMs = Date.now() - t0;
    await journal.recordRun({ actorId: user.id, kind: 'generate', mode, category,
      conceptId: conceptId || null, resultStatus: 'unavailable', providerAvailable,
      reason: 'build_error: ' + (e && e.message ? e.message : 'unknown'), durationMs }).catch(() => {});
    health.checkAndAlert().catch(() => {});
    { const m = 'Clay hit a snag while building and didn’t finish. Nothing was fabricated — please try again in a moment.';
      await notifyBuildOutcome(user, m);
      await finishBuild(buildId, { status: 'failed', message: m, note: m }); }
  }
}

// POST /api/clay/generate  { mode, category?, prompt, concept_id? }
// Async by design: a full concept takes 1–3 minutes to write, so we confirm immediately
// and email the finished package rather than parking the user on a spinner.
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

  // Fast fail: if the builder isn't connected, say so now — no point promising an email.
  if (!provider.available()) {
    return res.status(200).json({
      status: 'unavailable',
      message: 'Clay’s builder isn’t connected right now, so it can’t create anything — and it never invents, so nothing was made up. This is a setup step on our side, not something you did.',
    });
  }

  // Kick the build off in the background and tell the user right away. runBuild emails
  // the finished package (that's what the email/account is for) and it also lands in the
  // Laboratory. We also open a build record so the user can WATCH Clay work live if they
  // want (the client polls GET /clay/build/:id). Fire-and-forget: runBuild owns its own
  // errors, so we never await it.
  const buildId = await createBuild(req.user.id, 'Got it — starting your build.');
  runBuild({ user: req.user, mode, category, prompt, operating, conceptId: concept_id || null, buildId })
    .catch(() => {});

  return res.status(202).json({
    status: 'building',
    build_id: buildId,
    email: req.user.email,
    eta_seconds: 180,
    message: 'I’m building your concept now. This usually takes 1 to 3 minutes — you don’t need to wait here. I’ll email it to ' + req.user.email + ' the moment it’s ready, and it’ll be waiting in your Laboratory too. You can watch me work below if you like.',
  });
}));

// GET /api/clay/build/:id — live progress for a build the user started, so the client can
// show Clay's work as it happens. Owner-scoped; returns notes, status, and (when done)
// the concept id to open.
router.get('/build/:id', authenticate, asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id || '')) throw new ApiError(400, 'Bad build id.');
  const r = await query('SELECT status, notes, concept_id, message FROM clay_builds WHERE id=$1 AND actor_id=$2',
    [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Build not found.');
  const b = r.rows[0];
  res.json({ status: b.status, notes: b.notes || [], concept_id: b.concept_id, message: b.message });
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

// GET /api/clay/diagnose — staff-only LIVE test of Clay's reasoning connection.
// Unlike /status (which only checks that a key env var exists), this makes a real
// call and returns the exact provider error, so the true cause of a build failure
// (invalid key, no access to the chosen model, etc.) is visible without server logs.
router.get('/diagnose', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const model = (typeof req.query.model === 'string' && req.query.model.trim())
      ? req.query.model.trim().slice(0, 100) : null;
    const result = await provider.probe(model);
    res.json(result);
  }));


function escapeHtml(t){return String(t==null?'':t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function buildPackageEmail(title, coverage, assets, conceptId){
  const parts = (assets||[]).map(a =>
    '<h2 style="color:#7c2d12;font-family:system-ui,sans-serif">'+escapeHtml(a.label||a.type)+'</h2>'+
    '<div style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">'+escapeHtml(a.body)+'</div>');
  const gap = coverage && !coverage.complete ? '<p style="color:#57534e">'+escapeHtml(coverage.gap_description)+'</p>' : '';
  const cta = conceptId ? '<p><a href="https://accessyplabs.com/app.html?concept='+encodeURIComponent(conceptId)+'" style="display:inline-block;background:#7c2d12;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-family:system-ui,sans-serif;font-size:16px">Open it in your Laboratory</a></p>' : '';
  return '<div style="max-width:640px;margin:0 auto">'+
    '<h1 style="font-family:system-ui,sans-serif;color:#1c1917">'+escapeHtml(title)+'</h1>'+
    '<p style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5">Your concept is ready — Clay at Access YP Labs finished building it. It’s also waiting in your Laboratory.</p>'+
    cta + gap + parts.join('') +
    '<hr/><p style="color:#57534e;font-size:13px;font-family:system-ui,sans-serif">The Dreamhold is a neutral marketplace. Concepts are pre-proven starting points, not guarantees of income.</p></div>';
}

// Short, honest email for when a build could not finish (redirect, empty, or error).
// The user is never left waiting on an email that only comes on success.
function buildOutcomeEmail(message){
  return '<div style="max-width:640px;margin:0 auto;font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#1c1917">'+
    '<p>'+escapeHtml(message)+'</p>'+
    '<p><a href="https://accessyplabs.com/app.html" style="display:inline-block;background:#7c2d12;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none">Open Clay to try again</a></p>'+
    '<p style="color:#57534e;font-size:13px">— Clay at Access YP Labs</p></div>';
}
async function notifyBuildOutcome(user, message){
  let r = { sent: false, reason: 'unknown' };
  try { r = await sendEmail({ to: user.email, subject: 'About your concept build', html: buildOutcomeEmail(message) }); }
  catch (e) { r = { sent: false, reason: (e && e.message) || 'error' }; }
  await logEmail(user.email, 'build_outcome', r);
  return r;
}

// --- Live build progress -------------------------------------------------------------
// Clay narrates its work so a user can watch it build in real time (or step away and let
// the email catch them). Notes are appended to a clay_builds row the client polls. Every
// write here is best-effort: progress reporting must never affect or slow the build.
async function createBuild(actorId, firstNote){
  try {
    const notes = firstNote ? [{ at: new Date().toISOString(), text: firstNote }] : [];
    const r = await query(
      "INSERT INTO clay_builds (actor_id, status, notes) VALUES ($1,'building',$2::jsonb) RETURNING id",
      [actorId, JSON.stringify(notes)]);
    return r.rows[0].id;
  } catch (_) { return null; }
}
async function addBuildNote(buildId, text){
  if (!buildId) return;
  try {
    await query('UPDATE clay_builds SET notes = notes || $1::jsonb, updated_at=now() WHERE id=$2',
      [JSON.stringify([{ at: new Date().toISOString(), text }]), buildId]);
  } catch (_) { /* progress is best-effort */ }
}
async function finishBuild(buildId, { status, conceptId = null, message = null, note = null }){
  if (!buildId) return;
  try {
    const noteJson = note ? JSON.stringify([{ at: new Date().toISOString(), text: note }]) : '[]';
    await query('UPDATE clay_builds SET status=$1, concept_id=$2, message=$3, notes = notes || $4::jsonb, updated_at=now() WHERE id=$5',
      [status, conceptId, message, noteJson, buildId]);
  } catch (_) {}
}

// Persist every build-email outcome so a silent failure never again leaves zero trace.
// Best-effort: logging must not affect the build.
async function logEmail(toEmail, kind, result){
  try {
    const sent = !!(result && result.sent);
    await query('INSERT INTO email_log (to_email, kind, sent, reason, provider_id) VALUES ($1,$2,$3,$4,$5)',
      [toEmail, kind, sent, sent ? null : ((result && result.reason) || 'unknown'), sent ? (result.id || null) : null]);
  } catch (_) {}
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

// POST /api/clay/health-check — staff-triggered health evaluation. Returns the last
// hour's stats and whether an alert was (or would be) sent. Same honest logic that
// runs automatically after a failed generation; this just lets staff force it.
router.post('/health-check', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  const result = await health.checkAndAlert();
  res.json(result);
}));

module.exports = router;
