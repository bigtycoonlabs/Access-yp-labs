const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { MODES, CATEGORIES, PLATFORMS, SOCIAL_GOALS } = require('../services/clay/tools');
const spine = require('../services/clay/spine');
const clay = require('../services/clay');
const seed = require('../services/clay/seed');
const seedScheduler = require('../services/clay/seedScheduler');
const economics = require('../services/clay/economics');
const images = require('../services/clay/images');
const imageBudget = require('../services/clay/imageBudget');
const imageCredits = require('../lib/imageCredits');
const provider = require('../services/clay/provider');
const journal = require('../services/clay/journal');
const retrieval = require('../services/clay/retrieval');
const health = require('../services/clay/health');
const { conceptEntitlement, redactLockedAssets } = require('../lib/entitlement');
const agent = require('../services/clay/agent');
const research = require('../services/clay/research');
const { CLAY_VERSION, CLAY_VERSION_LABEL } = require('../services/clay/version');
const memory = require('../services/clay/memory');
const pacing = require('../services/clay/pacing');
const glossary = require('../services/clay/glossary');
const worked = require('../services/clay/workedExample');
const image = require('../services/image');
const stripe = require('../services/stripe');
const video = require('../services/video');
const describe = require('../lib/describe');
const { sendEmail } = require('../services/email');
const protect = require('../lib/protect');
const ingest = require('../lib/ingest');
const docextract = require('../lib/docextract');
const router = express.Router();

// GET /api/clay/version — PUBLIC. The homepage badge and any surface reads Clay's live
// version from here, so the number lives in exactly one place (see services/clay/version.js).
router.get('/version', (req, res) => {
  res.json({ version: CLAY_VERSION, label: CLAY_VERSION_LABEL });
});

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
      // Refining is returning to the concept: reset its expiry clock and clear any warning.
      await client.query('UPDATE concepts SET last_opened_at=NOW(), expiry_reminded_at=NULL WHERE id=$1', [concept.id]);
      if (result.risk_summary) {
        await client.query('UPDATE concepts SET risk_summary=$2, updated_at=NOW() WHERE id=$1',
          [concept.id, result.risk_summary]);
      }
      // A re-generation refreshes Clay's take and next steps for the concept.
      if (result.clays_take || (Array.isArray(result.next_steps) && result.next_steps.length)) {
        await client.query('UPDATE concepts SET clays_take=$2, next_steps=$3::jsonb, updated_at=NOW() WHERE id=$1',
          [concept.id, result.clays_take || null, JSON.stringify(result.next_steps || [])]);
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
           research_grounded, claims_verified, source_count, clays_take, next_steps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
        [ownerId, result.title || 'Untitled concept', mode,
         result.inferred_category || category || null, result.risk_summary || null, !!operating,
         !!result.research_grounded,
         (typeof result.claims_verified === 'boolean' ? result.claims_verified : null),
         result.source_count || 0,
         result.clays_take || null, JSON.stringify(result.next_steps || [])]);
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
// Gather the extracted content of files the user attached — the ones uploaded for THIS build
// (by id) plus any already attached to the concept being enhanced — dedup by name, and cap
// the total so a big pile of files can't blow the model's context. Best-effort: a failure
// here never blocks the build, it just means no source materials this time.
async function loadClaySources(userId, uploadIds, conceptId) {
  const ids = Array.isArray(uploadIds)
    ? uploadIds.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))
    : [];
  if (!ids.length && !conceptId) return [];
  let rows;
  try {
    rows = (await query(
      `SELECT filename, kind, read_status, extracted_text, created_at
         FROM clay_uploads
        WHERE user_id=$3
          AND ( id = ANY($1::uuid[]) OR ($2::uuid IS NOT NULL AND concept_id=$2) )
        ORDER BY created_at ASC`,
      [ids, conceptId || null, userId])).rows;
  } catch (_) { return []; }
  const seen = new Set();
  const sources = [];
  let total = 0;
  for (const r of rows) {
    const key = r.filename + '|' + r.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    let text = r.extracted_text || '';
    if (total + text.length > ingest.MAX_TOTAL_INJECT_CHARS) {
      text = text.slice(0, Math.max(0, ingest.MAX_TOTAL_INJECT_CHARS - total));
    }
    total += text.length;
    sources.push({ filename: r.filename, kind: r.kind, read_status: r.read_status, text });
    if (total >= ingest.MAX_TOTAL_INJECT_CHARS) break;
  }
  return sources;
}

async function runBuild({ user, mode, category, prompt, operating, conceptId, buildId = null, uploadIds = [] }) {
  const t0 = Date.now();
  const providerAvailable = provider.available();
  const onProgress = (text) => addBuildNote(buildId, text);
  try {
    // Retrieval grounding: the user's own related prior work (best-effort, never blocks).
    const priorWork = await retrieval.relatedConcepts(user.id, prompt, { limit: 3, excludeId: conceptId || null });
    // Files the user attached for this build, plus any already attached to the concept
    // being enhanced — so materials carry forward across enhancements automatically.
    const sources = await loadClaySources(user.id, uploadIds, conceptId);
    const result = await clay.generate({ mode, category, prompt, operating, priorWork, sources, onProgress });
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
    // Attach any newly-uploaded files to this concept so they inform future enhancements too.
    if (uploadIds && uploadIds.length) {
      await query(
        'UPDATE clay_uploads SET concept_id=$1 WHERE id = ANY($2::uuid[]) AND user_id=$3 AND concept_id IS NULL',
        [concept.id, uploadIds, user.id]).catch(() => {});
    }
    await journal.recordRun({ actorId: user.id, kind: 'generate', mode, category,
      conceptId: concept.id, resultStatus: 'answered', providerAvailable,
      grounded: !!result.research_grounded, sourceCount: result.source_count || 0, durationMs });
    retrieval.embedAndStore(concept.id, [result.title, result.risk_summary, prompt].filter(Boolean).join('. ')).catch(() => {});

    // Upgrade the money section from model-written numbers to COMPUTED ones. A bonus step:
    // wrapped so it can never affect the build — if it fails, the concept keeps the written
    // narrative and the package still ships. When it succeeds, patch the in-memory result so
    // the emailed package matches what's saved.
    try {
      await onProgress('Computing the real unit economics…');
      const econ = await economics.computeAndAttach(concept.id);
      if (econ && econ.ok && econ.full) {
        const mf = (result.assets || []).find((a) => a.type === 'money_flow');
        if (mf) mf.body = econ.full;
      }
    } catch (_) { /* economics is a bonus; never fail the build over it */ }

    // Email the package — but CHECK the result and be honest. If it didn't send, we say
    // so and point to the Laboratory rather than promising a mail that isn't coming.
    let emailed = { sent: false, reason: 'unknown' };
    try {
      emailed = await sendEmail({
        to: user.email,
        subject: 'Your concept is ready: ' + (result.title || concept.title || 'new concept'),
        html: buildPackageEmail(result.title || concept.title, result.coverage, result.assets, concept.id, result.clays_take, result.next_steps),
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

    // Sparingly auto-make a couple of key visuals — only on a concept's FIRST build, only within
    // its monthly image budget, and only if image generation is configured. The build is already
    // marked done above, so this is pure bonus: dormant (a no-op) until a key is set, wrapped so a
    // failure can never touch the build's status, the package, or the email.
    try {
      if (image.configured() && !(await imageBudget.hasAutoImages(concept.id))) {
        const [plan, used, purchased] = await Promise.all([
          imageBudget.planFor(user.id),
          imageBudget.usedThisMonth(concept.id),
          imageBudget.purchasedBalance(concept.id),
        ]);
        const n = imageCredits.autoBudget({ plan, usedThisMonth: used, purchased, isFirstBuild: true });
        const kinds = ['logo', 'hero image'];
        for (let i = 0; i < n; i++) {
          await images.generateOne(
            { id: concept.id, owner_id: user.id, title: result.title || concept.title, category },
            { kind: kinds[i] || 'product mockup', source: 'auto', ownerId: user.id });
        }
      }
    } catch (_) { /* images are a bonus; never let them affect the build */ }
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
// POST /api/clay/uploads — files the user wants Clay to use (code, images/graphics, docs,
// any type). We read what we can — text/code directly, images through Clay's vision — and
// store the EXTRACTED content so it can be folded into generation and enhancement. We never
// run code, and we never invent the contents of a file we couldn't read.
router.post('/uploads', authenticate, [
  body('files').isArray({ min: 1, max: 10 }),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const conceptId = req.body.concept_id || null;

  // If attaching to an existing concept, it must belong to the caller.
  if (conceptId) {
    const own = await query('SELECT 1 FROM concepts WHERE id=$1 AND owner_id=$2', [conceptId, req.user.id]);
    if (!own.rows.length) throw new ApiError(404, 'Concept not found.');
  }

  const PER_FILE_BYTES = 6 * 1024 * 1024;   // 6 MB per file
  const BATCH_BYTES = 9 * 1024 * 1024;      // keep the whole batch under the 10 MB body cap
  let totalBytes = 0;
  const out = [];

  for (const f of req.body.files.slice(0, 10)) {
    const filename = String(f && f.filename ? f.filename : 'file').slice(0, 200);
    const mime = f && f.mime_type ? String(f.mime_type).slice(0, 120) : null;
    let buf;
    try { buf = Buffer.from(String(f && f.data ? f.data : ''), 'base64'); } catch (_) { buf = Buffer.alloc(0); }

    if (!buf.length) { out.push({ filename, skipped: 'empty' }); continue; }
    if (buf.length > PER_FILE_BYTES) { out.push({ filename, skipped: 'too_large' }); continue; }
    if (totalBytes + buf.length > BATCH_BYTES) { out.push({ filename, skipped: 'batch_too_large' }); continue; }
    totalBytes += buf.length;

    const kind = ingest.classify(filename, mime, buf);
    let extracted = null;
    let read_status = 'unreadable';

    if (kind === 'image') {
      // Read the image with Clay's own eyes (vision). Honest on failure — never fabricated.
      const mediaType = mime && /^image\//i.test(mime) ? mime : 'image/png';
      const desc = await provider.describeImage({
        imageBase64: buf.toString('base64'),
        mediaType,
        system: 'You are helping a product designer who cannot see. Describe the image precisely and usefully. Never guess at anything not visible.',
        prompt: 'Describe this image in concrete detail for someone building a product from it: overall layout and structure, every piece of visible text (quote it exactly), colors, UI elements/components, imagery and graphics, and the overall style and mood — everything a designer or developer would need to reproduce it or build on it. If something is unclear, say so rather than guessing.',
        maxTokens: 900,
      }).catch(() => ({ ok: false }));
      if (desc && desc.ok && desc.text) { extracted = String(desc.text).slice(0, ingest.MAX_TEXT_CHARS); read_status = 'described'; }
    } else if (kind === 'pdf') {
      const r = await docextract.extractPdf(buf);
      if (r.ok) { extracted = r.text; read_status = 'read'; } // else honest unreadable (scanned/no text layer)
    } else if (kind === 'doc') {
      const r = await docextract.extractDocx(buf);
      if (r.ok) { extracted = r.text; read_status = 'read'; }
    } else if (kind !== 'binary') {
      extracted = ingest.extractText(buf);
      read_status = 'read';
    }

    const ins = await query(
      `INSERT INTO clay_uploads (user_id, concept_id, filename, mime_type, kind, byte_size, extracted_text, read_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user.id, conceptId, filename, mime, kind, buf.length, extracted, read_status]);
    out.push({ id: ins.rows[0].id, filename, kind, read_status, chars: extracted ? extracted.length : 0 });
  }

  const attached = out.filter((o) => o.id);
  const usable = attached.filter((o) => o.read_status === 'read' || o.read_status === 'described');
  res.json({
    uploads: out,
    ids: attached.map((o) => o.id),
    summary: out.map((o) => ingest.outcomeLine(o)),
    message: usable.length
      ? `Attached ${attached.length} file${attached.length === 1 ? '' : 's'}. Clay will use ${usable.length} of them in what it builds.`
      : (attached.length
          ? 'Files attached, but Clay could not read their contents, so it will note them without inventing anything.'
          : 'Nothing was attached.'),
  });
}));

// POST /api/clay/generate  { mode, category?, prompt, concept_id?, upload_ids? }
router.post('/generate', authenticate, [
  body('mode').isIn(MODES),
  body('category').optional().isIn(CATEGORIES),
  body('prompt').isString().isLength({ min: 3 }),
  body('concept_id').optional().isUUID(),
  body('operating').optional().isBoolean(),
  body('upload_ids').optional().isArray(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { mode, category, prompt, concept_id } = req.body;
  const operating = !!req.body.operating;
  const uploadIds = Array.isArray(req.body.upload_ids)
    ? req.body.upload_ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10)
    : [];

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
  runBuild({ user: req.user, mode, category, prompt, operating, conceptId: concept_id || null, buildId, uploadIds })
    .catch(() => {});

  return res.status(202).json({
    status: 'building',
    build_id: buildId,
    email: req.user.email,
    eta_seconds: 180,
    message: 'I’m building your concept now. This usually takes 1 to 3 minutes — you don’t need to wait here. I’ll email it to ' + req.user.email + ' the moment it’s ready, and it’ll be waiting in your Laboratory too. You can watch me work below if you like.',
  });
}));

// POST /api/clay/seed — STAFF ONLY. Ask Clay to invent, build, and post ONE seed concept to
// the Dreamhold FOR REVIEW (never straight to sale). A full build takes 1-3 minutes, so this is
// fire-and-forget: it lands in the moderation queue and emails staff when ready. runSeed owns its
// own errors and never throws, so we never await it. Nothing goes live without a staff approval.
router.post('/seed', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  if (!provider.available()) {
    return res.status(200).json({
      status: 'unavailable',
      message: 'Clay’s builder isn’t connected right now, so it can’t create a seed — and it never invents, so nothing was made up.',
    });
  }
  // Fire-and-forget for a fast response, but never silent: on success runSeed emails staff to
  // review; on failure we email staff the reason, so a manual seed always ends with an answer.
  seed.runSeed()
    .then((r) => { if (r && !r.ok) return seed.emailStaffSeedFailed(r); })
    .catch((e) => seed.emailStaffSeedFailed({ reason: 'error', error: e && e.message }));
  return res.status(202).json({
    status: 'seeding',
    message: 'Clay is inventing and building a seed concept now. It will appear in the review queue and staff will be emailed when it’s ready — or emailed the reason if it can’t finish. Nothing goes live until you approve it.',
  });
}));

// GET /api/clay/seed-schedule — STAFF ONLY. The current auto-seed cadence and how much Clay has
// seeded today / all-time.
router.get('/seed-schedule', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  const s = await seedScheduler.status();
  res.json({ ok: true, schedule: s, image_ready: image.configured() });
}));

// POST /api/clay/seed-schedule  { enabled?, daily_target?, min_gap_minutes? } — STAFF ONLY. Turn
// auto-seeding on/off and tune the cadence. daily_target is clamped to the hard DAILY_CAP; seeds
// still go through moderation, so this only changes how the review queue is fed.
router.post('/seed-schedule', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (body.daily_target != null && Number.isInteger(Number(body.daily_target))) patch.dailyTarget = Number(body.daily_target);
  if (body.min_gap_minutes != null && Number.isInteger(Number(body.min_gap_minutes))) patch.minGapMinutes = Number(body.min_gap_minutes);
  const s = await seedScheduler.configure(patch);
  res.json({ ok: true, schedule: s, image_ready: image.configured(),
    message: s && s.enabled
      ? 'Auto-seeding is ON — Clay will add up to ' + s.daily_target + ' concept' + (s.daily_target === 1 ? '' : 's') + ' a day to the review queue.'
      : 'Auto-seeding is OFF — Clay only seeds when you ask.' });
}));

// POST /api/clay/concept/:id/economics — compute REAL unit economics for a concept and upgrade its
// money_flow section with the computed numbers. Owner or staff. Additive: never touches the build.
router.post('/concept/:id/economics', authenticate, asyncHandler(async (req, res) => {
  const c = await query('SELECT owner_id FROM concepts WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'Concept not found.');
  const isOwner = c.rows[0].owner_id === req.user.id;
  const isStaff = ['staff', 'admin', 'master_staff'].includes(req.user.role);
  if (!isOwner && !isStaff) throw new ApiError(403, 'This isn’t your concept.');
  if (!provider.available()) {
    return res.status(200).json({ ok: false, reason: 'unavailable',
      message: 'Clay’s builder isn’t connected right now, so the numbers can’t be estimated — and Clay never invents figures, so nothing was changed.' });
  }
  const r = await economics.computeAndAttach(req.params.id);
  if (!r.ok) {
    const msg = r.reason === 'unavailable'
      ? 'Clay couldn’t estimate the inputs right now, so nothing was changed and no figures were invented.'
      : 'Couldn’t compute the economics right now, so nothing was changed.';
    return res.status(200).json({ ok: false, reason: r.reason, message: msg });
  }
  res.json({ ok: true, body: r.body,
    message: 'Computed the real unit economics from Clay’s estimates and added them to this concept’s money section.' });
}));

// POST /api/clay/concept/:id/image  { kind? } — generate ONE image for a concept if the monthly
// allowance (or a purchased Extras pack) has room. Owner or staff. Honest + dormant: until an image
// key is configured AND the OpenAI org is verified, it reports 'unavailable' and nothing is charged.
router.post('/concept/:id/image', authenticate, asyncHandler(async (req, res) => {
  const c = await query('SELECT id, owner_id, title, category FROM concepts WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'Concept not found.');
  const concept = c.rows[0];
  const isOwner = concept.owner_id === req.user.id;
  const isStaff = ['staff', 'admin', 'master_staff'].includes(req.user.role);
  if (!isOwner && !isStaff) throw new ApiError(403, 'This isn’t your concept.');
  const kind = (typeof req.body.kind === 'string' && req.body.kind.trim()) ? req.body.kind.trim().slice(0, 40) : 'logo';
  const r = await images.generateOne(concept, { kind, source: 'manual', ownerId: concept.owner_id });
  if (!r.ok) {
    const msgs = {
      unavailable: 'Image generation isn’t switched on yet, so nothing was made and nothing was charged.',
      no_budget: 'This concept has used its image allowance for the month. Buy an Extras pack to make more.',
      no_brief: 'Clay couldn’t compose the image just now, so nothing was made and nothing was charged.',
      empty: 'The image service returned nothing, so nothing was saved.',
    };
    return res.status(200).json({ ok: false, reason: r.reason, message: msgs[r.reason] || ('Couldn’t make the image right now (' + r.reason + ').'), budget: r.budget || null });
  }
  const left = r.budget ? (r.budget.total_remaining + ' image' + (r.budget.total_remaining === 1 ? '' : 's') + ' left this month.') : '';
  res.json({ ok: true, asset_id: r.asset_id, alt: r.alt, billed: r.billed, budget: r.budget,
    message: 'Made a new image and added it to this concept. ' + left });
}));

// GET /api/clay/concept/:id/images — the image budget for a concept (used this month, free
// remaining, purchased balance) plus the Extras packs on offer. Owner or staff.
router.get('/concept/:id/images', authenticate, asyncHandler(async (req, res) => {
  const c = await query('SELECT id, owner_id FROM concepts WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'Concept not found.');
  const concept = c.rows[0];
  const isStaff = ['staff', 'admin', 'master_staff'].includes(req.user.role);
  if (concept.owner_id !== req.user.id && !isStaff) throw new ApiError(403, 'This isn’t your concept.');
  const budget = await imageBudget.budgetFor(concept.id, concept.owner_id);
  res.json({ ok: true, budget, packs: imageCredits.PACKS });
}));

// POST /api/clay/concept/:id/image-pack  { pack_id } — buy an Extras image pack for a concept.
// Standalone one-time purchase; credits are granted by the Stripe webhook on payment. Owner/staff.
router.post('/concept/:id/image-pack', authenticate, asyncHandler(async (req, res) => {
  const pack = imageCredits.packById(String(req.body.pack_id || ''));
  if (!pack) throw new ApiError(400, 'Choose one of the Extras packs.');
  const c = await query('SELECT id, owner_id, title FROM concepts WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'Concept not found.');
  const concept = c.rows[0];
  const isStaff = ['staff', 'admin', 'master_staff'].includes(req.user.role);
  if (concept.owner_id !== req.user.id && !isStaff) throw new ApiError(403, 'This isn’t your concept.');
  const base = (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
  const checkout = await stripe.createImagePackCheckout({
    userId: req.user.id, conceptId: concept.id, pack, email: req.user.email,
    successUrl: `${base}/concept.html?id=${concept.id}&extras=done`,
    cancelUrl: `${base}/concept.html?id=${concept.id}&extras=canceled`,
  });
  if (!checkout.ok) {
    // Record the real Stripe reason for staff (blind operators can't read Railway logs).
    try {
      await query(
        `INSERT INTO checkout_errors (user_id, kind, plan, concept_id, stripe_type, stripe_code, stripe_param, message)
         VALUES ($1,'image_pack',$2,$3,$4,$5,$6,$7)`,
        [req.user.id, pack.id, concept.id,
         checkout.stripe_type || (checkout.reason === 'stripe_not_configured' ? 'not_configured' : null),
         checkout.stripe_code || checkout.detail || null, checkout.stripe_param || null,
         checkout.stripe_message || checkout.reason || null]);
    } catch (_) { /* never let logging break the response */ }
    const msg = checkout.reason === 'stripe_not_configured'
      ? 'Billing isn’t configured on the platform yet, so nothing was charged.'
      : (checkout.message || 'Could not start checkout, so nothing was charged.');
    return res.status(200).json({ ok: false, reason: checkout.reason, message: msg });
  }
  res.json({ ok: true, url: checkout.url, message: 'Opening secure checkout for ' + pack.label + ' — $' + (pack.price_cents / 100).toFixed(2) + '.' });
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
// Scan a returned chat transcript for what Clay actually did this turn: kicked off a
// background build (generate_concept / enhance_concept), or answered synchronously with a
// concept id. Lets the client watch progress or refresh materials.
function chatOutcomeFromTranscript(messages) {
  if (!Array.isArray(messages)) return {};
  const out = {};
  for (const m of messages) {
    if (!m || m.role !== 'tool' || typeof m.content !== 'string') continue;
    try {
      const o = JSON.parse(m.content);
      if (o && o.status === 'building' && typeof o.build_id === 'string') out.build_id = o.build_id;
      else if (o && o.status === 'answered' && typeof o.concept_id === 'string') out.concept_id = o.concept_id;
    } catch (_) { /* not JSON — ignore */ }
  }
  return out;
}

function buildExecutors(user) {
  return {
    list_my_concepts: async () => {
      const r = await query('SELECT id, title, category, stage FROM concepts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 50', [user.id]);
      return { concepts: r.rows };
    },
    get_concept: async ({ concept_id }) => {
      const c = await query('SELECT id, title, category, stage, risk_summary FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!c.rows.length) return { error: 'Concept not found.' };
      const a = await query("SELECT type, title, body FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at", [concept_id]);
      const ent = await conceptEntitlement(user, concept_id);
      const materials = redactLockedAssets(a.rows, !!ent.entitled).map((m) => ({
        type: m.type, title: m.title, locked: !!m.locked,
        content: m.locked ? '' : String(m.body || '').replace(/\s+/g, ' ').trim().slice(0, 1500),
      }));
      return { concept: c.rows[0], materials };
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
    check_systems: async () => {
      const staff = ['staff', 'admin', 'master_staff'].includes(user && user.role);
      if (!staff) {
        return { available: false, note: 'A full systems check is staff-only. Tell the user this is a behind-the-scenes diagnostic you can\'t run for them, and offer to keep helping with their idea.' };
      }
      const s = await health.systemsStatus();
      // Hand Clay the plain-English summary to speak, plus the structured facts. Never soften
      // a failure into a success — report exactly what the record says.
      return { available: true, note: s.summary, status: s };
    },
    generate_concept: async ({ prompt, category }) => {
      // Run the 1–3 minute build in the background so the chat request returns fast; the
      // client watches progress by build id. Same pipeline as POST /clay/generate.
      const buildId = await createBuild(user.id, 'Shaping your concept…');
      runBuild({ user, mode: 'create', category: category || null, prompt, operating: false, conceptId: null, buildId })
        .catch(() => {});
      return { status: 'building', build_id: buildId, message: 'Shaping the concept now — this takes a minute or two, and you can watch it happen.' };
    },
    enhance_concept: async ({ concept_id, prompt }) => {
      const own = await query('SELECT id, title, category FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!own.rows.length) return { status: 'error', message: 'Concept not found.' };
      const a = await query("SELECT type, title, body FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at", [concept_id]);
      // Ground the refinement in the concept's OWN current content so Clay builds on what
      // already exists. Without this, enhance rebuilt from the bare instruction and
      // refused short edits ("I can't tell what the business is from this message alone").
      const currentContent = a.rows.map((m) =>
        `[${m.type}] ${m.title || ''}\n${String(m.body || '').replace(/\s+/g, ' ').trim().slice(0, 2000)}`
      ).join('\n\n');
      const groundedPrompt = currentContent
        ? `You are refining an EXISTING concept titled "${own.rows[0].title}". Here is its current content — keep what works and change only what the user asks for:\n\n${currentContent}\n\n--- THE CHANGE THE USER WANTS ---\n${prompt}`
        : prompt;
      // Rebuild in the background so the chat stays responsive; client watches by build id.
      const buildId = await createBuild(user.id, 'Refining your concept…');
      runBuild({ user, mode: 'enhance', category: own.rows[0].category || null, prompt: groundedPrompt, operating: false, conceptId: concept_id, buildId })
        .catch(() => {});
      return { status: 'building', build_id: buildId, message: 'Refining the materials now — this takes a minute or two, and you can watch it happen.' };
    },
    generate_social_content: async ({ concept_id, platforms, goal, count }) => {
      const c = await query('SELECT id,title,category,risk_summary FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!c.rows.length) return { status: 'error', message: 'Concept not found.' };
      const result = await clay.generateSocial({ concept: c.rows[0], platforms, goal, count: count || 6 });
      if (result.result_status !== 'answered') return { status: result.result_status, message: result.message };
      await persistResult(user.id, result, { conceptId: concept_id, mode: 'enhance', category: null, prompt: 'social:' + goal });
      return { status: 'answered', concept_id, coverage: result.coverage, message: result.message };
    },
    remember: async ({ key, value, sensitivity }) => {
      const ok = await memory.rememberFact(user.id, key, value, { sensitivity, source: 'builder_said' });
      return ok
        ? { status: 'remembered', key: String(key || '').trim().slice(0, memory.KEY_MAX) }
        : { status: 'error', message: 'Nothing to remember — give me a short key and the fact.' };
    },
    forget: async ({ key }) => {
      const ok = await memory.forgetFact(user.id, key);
      return ok ? { status: 'forgotten', key } : { status: 'not_found', key };
    },
    define_term: async ({ term }) => {
      const e = glossary.defineTerm(term);
      return e
        ? { found: true, term: e.term, definition: e.definition }
        : { found: false, term, note: "Not in Clay's business glossary — explain it in plain words as general knowledge, not as an authoritative definition." };
    },
    worked_example: async ({ topic, concept_id }) => {
      // Anchor to the builder's OWN concept by name only (illustrative numbers stay illustrative).
      let conceptTitle = null;
      if (concept_id) {
        const r = await query('SELECT title FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
        if (r.rows[0]) conceptTitle = r.rows[0].title;
      }
      const ex = worked.workedExample(topic, { conceptTitle });
      return ex || { found: false, topic, note: "No canned worked example for that topic — build one yourself: pick round illustrative numbers, walk it step by step for the ear, and say plainly the numbers are illustrative, not a claim about their real business." };
    },
  };
}

// POST /api/clay/chat  { messages: [...] }
router.post('/chat', authenticate, [
  body('messages').isArray({ min: 1 }),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  let conceptContext = null;
  if (req.body.concept_id) {
    const c = await query('SELECT id, title, category, stage, risk_summary FROM concepts WHERE id=$1 AND owner_id=$2',
      [req.body.concept_id, req.user.id]);
    if (c.rows.length) {
      const a = await query(
        "SELECT type, title, body FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at",
        [req.body.concept_id]);
      // Never feed Clay content the user hasn't unlocked — otherwise chat becomes a paywall
      // bypass ("read me my build path"). Redaction blanks locked bodies and flags them.
      const ent = await conceptEntitlement(req.user, req.body.concept_id);
      conceptContext = { concept: c.rows[0], assets: redactLockedAssets(a.rows, !!ent.entitled) };
    }
  }
  const mems = await memory.getMemories(req.user.id).catch(() => []);
  const patterns = await memory.getPatterns(req.user.id).catch(() => null);
  const memoryContext = [memory.renderMemoryContext(mems), memory.renderPatterns(patterns)].filter(Boolean).join('\n\n');
  const out = await agent.runChat({ messages: req.body.messages, executors: buildExecutors(req.user), conceptContext, memoryContext });
  // Tell the client what happened this turn: a background rebuild it can watch, or a
  // synchronous concept change it should refresh (new asset versions have new ids).
  const outcome = chatOutcomeFromTranscript(out.messages);
  if (outcome.build_id) out.build_id = outcome.build_id;
  if (outcome.concept_id) { out.concept_updated = true; out.concept_id = outcome.concept_id; }
  // Pace the reply for the ear: split a long answer into clean, VoiceOver-sized pieces the
  // conversation log announces one at a time. A confirmation, a refusal, or anything not a
  // plain answer is treated as serious and kept whole.
  out.bubbles = pacing.bubblesFor(out.reply || '', { serious: out.status !== 'answered' });
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
  if (tool === 'clear_memory') {
    const n = await memory.clearMemory(req.user.id);
    return res.json({ status: 'done', message: `Cleared ${n} remembered ${n === 1 ? 'fact' : 'facts'}. I'll start fresh.` });
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
function buildPackageEmail(title, coverage, assets, conceptId, claysTake, nextSteps){
  const parts = (assets||[]).map(a =>
    '<h2 style="color:#7c2d12;font-family:system-ui,sans-serif">'+escapeHtml(a.label||a.type)+'</h2>'+
    '<div style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">'+escapeHtml(a.body)+'</div>');
  const gap = coverage && !coverage.complete ? '<p style="color:#57534e">'+escapeHtml(coverage.gap_description)+'</p>' : '';
  const steps = (nextSteps||[]).filter(Boolean);
  const take = (claysTake || steps.length)
    ? '<div style="border-left:4px solid #b45309;background:#fbf6f0;padding:12px 16px;margin:14px 0;border-radius:8px">'+
        (claysTake ? '<p style="margin:0 0 8px;font-family:system-ui,sans-serif;font-size:16px;line-height:1.5"><strong style="color:#7c2d12">Clay’s take:</strong> '+escapeHtml(claysTake)+'</p>' : '')+
        (steps.length ? '<p style="margin:0 0 4px;font-family:system-ui,sans-serif;font-size:16px"><strong style="color:#7c2d12">Where I’d take it next:</strong></p><ol style="margin:0;padding-left:20px;font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">'+steps.map(s=>'<li>'+escapeHtml(s)+'</li>').join('')+'</ol>' : '')+
      '</div>'
    : '';
  const cta = conceptId ? '<p><a href="https://accessyplabs.com/app.html?concept='+encodeURIComponent(conceptId)+'" style="display:inline-block;background:#7c2d12;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-family:system-ui,sans-serif;font-size:16px">Open it in your Laboratory</a></p>' : '';
  return '<div style="max-width:640px;margin:0 auto">'+
    '<h1 style="font-family:system-ui,sans-serif;color:#1c1917">'+escapeHtml(title)+'</h1>'+
    '<p style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5">Your concept is ready — Clay at Access YP Labs finished building it. It’s also waiting in your Laboratory.</p>'+
    take + cta + gap + parts.join('') +
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

// GET /api/clay/systems — staff-only honest readout of what's actually connected right now:
// Clay's brain, web research, email sending, and Stripe payments. Reads env PRESENCE and the
// real last-outcome from the logs; never exposes secret values. This is the "double-check
// everything" surface — and the same truth Clay speaks via the check_systems tool.
router.get('/systems', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  res.json(await health.systemsStatus());
}));

module.exports = router;
