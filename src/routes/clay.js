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
const intent = require('../services/clay/intent');
const movement = require('../services/clay/movement');
const launchPage = require('../services/clay/launchPage');
const siteStore = require('../services/clay/siteStore');
const store = require('../services/clay/store');
const similarity = require('../services/clay/similarity');
const awareness = require('../services/clay/awareness');
const siteAccess = require('../services/clay/siteAccess');
const buildSpec = require('../services/clay/buildSpec');
const conversations = require('../services/clay/conversations');
const { deleteProject, CANCEL_FAILED_MESSAGE } = require('../lib/deleteProject');
const siteQuota = require('../services/clay/siteQuota');
const domains = require('../services/clay/domains');
const domainStore = require('../services/clay/domainStore');
const staffCapability = require('../services/clay/staffCapability');
const moderationCore = require('../services/moderationCore');
const crypto = require('crypto');
const valuation = require('../services/clay/valuation');
const proofPrompt = require('../services/clay/proofPrompt');
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
const staffNotify = require('../services/clay/staffNotify');
const weeklyReview = require('../services/clay/weeklyReview');
const { CLAY_VERSION, CLAY_VERSION_LABEL } = require('../services/clay/version');
const memory = require('../services/clay/memory');
const pacing = require('../services/clay/pacing');
const glossary = require('../services/clay/glossary');
const worked = require('../services/clay/workedExample');
const enterprise = require('../services/clay/enterprise');
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
      if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
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

// ---- Enterprise orchestration runner --------------------------------------------------------
// Build a whole ENTERPRISE without one oversized call: PLAN the ventures (one small, fast call),
// create the parent enterprise concept, BUILD each venture as its own normal-sized concept under
// that parent, then ASSEMBLE the parent overview. It reuses the exact single-concept primitives
// (clay.generate + persistResult), so every piece is a proven, normal-sized build that can't time
// out the way the whole-company-in-one-pass attempt did (that run went ~3m41s and honestly gave
// up rather than fabricate). Runs in the background off a clay_builds row the client already knows
// how to watch. Failures are isolated: one venture failing is recorded and skipped, the rest still
// build — an honest "built 3 of 5" beats a pretty lie.
//
// The 10-minute stale-build sweep (services/builds.js) is respected by design: every venture and
// the assembly step post progress notes, which bump clay_builds.updated_at, and no single step
// runs longer than one concept build (well under 10 minutes) — so a live enterprise build is never
// mistaken for a dead one.
async function runEnterpriseBuild({ user, prompt, buildId, uploadIds = [] }) {
  const t0 = Date.now();
  const providerAvailable = provider.available();
  const onProgress = (text) => addBuildNote(buildId, text);
  try {
    await onProgress('Planning your enterprise — sketching the ventures before building any of them…');
    const sources = await loadClaySources(user.id, uploadIds, null);
    const planned = await enterprise.planEnterprise({ prompt, sources });
    if (!planned.ok) {
      const m = planned.reason === 'unavailable'
        ? 'Clay’s builder isn’t connected right now, so it couldn’t plan the enterprise — and it never invents, so nothing was made up.'
        : 'Clay couldn’t shape a clear plan for this enterprise from the request, so nothing was built and nothing was fabricated. Try naming the ventures you want a bit more concretely.';
      await journal.recordRun({ actorId: user.id, kind: 'generate', mode: 'create', category: null,
        conceptId: null, resultStatus: 'unavailable', providerAvailable,
        reason: 'enterprise_plan_failed: ' + planned.reason, durationMs: Date.now() - t0 }).catch(() => {});
      await notifyBuildOutcome(user, m);
      await finishBuild(buildId, { status: 'failed', message: m, note: m });
      return;
    }
    const plan = planned.plan;

    // Record the plan header and the per-venture steps up front, so progress is always truthful and
    // a crash mid-run leaves a readable trail of what was and wasn't built.
    await query(
      `INSERT INTO enterprise_plans (build_id, owner_id, title, thesis, status, child_count)
       VALUES ($1,$2,$3,$4,'building',$5)
       ON CONFLICT (build_id) DO UPDATE SET title=EXCLUDED.title, thesis=EXCLUDED.thesis,
         status='building', child_count=EXCLUDED.child_count, updated_at=now()`,
      [buildId, user.id, plan.title, plan.thesis || null, plan.children.length]).catch(() => {});
    const stepIds = [];
    for (let i = 0; i < plan.children.length; i++) {
      const c = plan.children[i];
      try {
        const r = await query(
          `INSERT INTO enterprise_build_steps (build_id, owner_id, idx, title, brief, category, status)
           VALUES ($1,$2,$3,$4,$5,$6,'planned') RETURNING id`,
          [buildId, user.id, i, c.title, c.brief || null, c.category || null]);
        stepIds.push(r.rows[0].id);
      } catch (_) { stepIds.push(null); }
    }

    // Create the parent enterprise concept up front, so every venture can point to a real parent as
    // it's built (and so even a partial run leaves a coherent enterprise the creator owns).
    const parentRow = await query(
      `INSERT INTO concepts (owner_id, title, mode, category, risk_summary, is_enterprise, origin)
       VALUES ($1,$2,'create',NULL,$3,true,'created') RETURNING *`,
      [user.id, plan.title, plan.thesis || null]);
    const parent = parentRow.rows[0];
    await query('UPDATE enterprise_plans SET parent_concept_id=$2, updated_at=now() WHERE build_id=$1',
      [buildId, parent.id]).catch(() => {});

    await onProgress('Here’s the plan: ' + plan.children.length + ' venture' +
      (plan.children.length === 1 ? '' : 's') + ' under “' + plan.title + '.” Building them one at a time now.');

    // Build each venture as its own full concept, under the parent. Sequential on purpose: it keeps
    // provider load sane and keeps posting steady progress the stale-build sweep can see. One
    // venture failing is recorded and skipped — never fatal to the rest.
    const built = [];
    for (let i = 0; i < plan.children.length; i++) {
      const c = plan.children[i];
      const stepId = stepIds[i];
      if (stepId) await query("UPDATE enterprise_build_steps SET status='building', updated_at=now() WHERE id=$1", [stepId]).catch(() => {});
      await onProgress('Building venture ' + (i + 1) + ' of ' + plan.children.length + ': ' + c.title + '…');
      try {
        const childPrompt = enterprise.childBuildPrompt(c, plan.title, plan.thesis);
        const result = await clay.generate({
          mode: 'create', category: c.category || null, prompt: childPrompt,
          operating: false, priorWork: [], sources: [], onProgress,
        });
        if (result.result_status !== 'answered' || !result.assets || !result.assets.length) {
          const reason = result.message || result.redirect || 'no complete package returned';
          if (stepId) await query("UPDATE enterprise_build_steps SET status='failed', error=$2, updated_at=now() WHERE id=$1", [stepId, String(reason).slice(0, 500)]).catch(() => {});
          await onProgress('Couldn’t complete ' + c.title + ' this pass — skipping it (nothing was made up) and moving on.');
          continue;
        }
        const childConcept = await persistResult(user.id, result, {
          conceptId: null, mode: 'create', category: c.category || null, prompt: childPrompt,
        });
        // Link it under the enterprise parent.
        await query('UPDATE concepts SET parent_id=$2, updated_at=now() WHERE id=$1 AND owner_id=$3',
          [childConcept.id, parent.id, user.id]).catch(() => {});
        retrieval.embedAndStore(childConcept.id, [result.title, result.risk_summary, childPrompt].filter(Boolean).join('. ')).catch(() => {});
        economics.computeAndAttach(childConcept.id).catch(() => {});
        if (stepId) await query("UPDATE enterprise_build_steps SET status='done', concept_id=$2, updated_at=now() WHERE id=$1", [stepId, childConcept.id]).catch(() => {});
        built.push({ id: childConcept.id, title: result.title || c.title, brief: c.brief });
        await query('UPDATE enterprise_plans SET built_count=$2, updated_at=now() WHERE build_id=$1', [buildId, built.length]).catch(() => {});
      } catch (e) {
        const msg = (e && e.message) ? e.message : 'unknown error';
        if (stepId) await query("UPDATE enterprise_build_steps SET status='failed', error=$2, updated_at=now() WHERE id=$1", [stepId, String(msg).slice(0, 500)]).catch(() => {});
        await onProgress('Hit a snag on ' + c.title + ' — recorded it, made nothing up, and kept going.');
      }
    }

    // If nothing built, don't pretend there's an enterprise — fail honestly.
    if (!built.length) {
      await query("UPDATE enterprise_plans SET status='failed', updated_at=now() WHERE build_id=$1", [buildId]).catch(() => {});
      const m = 'None of the ventures finished this time, so the enterprise wasn’t built and nothing was fabricated. Please try again.';
      await journal.recordRun({ actorId: user.id, kind: 'generate', mode: 'create', category: null,
        conceptId: parent.id, resultStatus: 'empty', providerAvailable,
        reason: 'enterprise_no_children_built', durationMs: Date.now() - t0 }).catch(() => {});
      await notifyBuildOutcome(user, m);
      await finishBuild(buildId, { status: 'failed', message: m, note: m });
      return;
    }

    // Assemble the parent overview from the ventures that actually built.
    await query("UPDATE enterprise_plans SET status='assembling', updated_at=now() WHERE build_id=$1", [buildId]).catch(() => {});
    await onProgress('Assembling the parent company — how the ' + built.length + ' venture' +
      (built.length === 1 ? '' : 's') + ' fit together under “' + plan.title + '.”');
    try {
      const asmPrompt = enterprise.assemblePrompt(plan.title, plan.thesis, built);
      const asm = await clay.generate({
        mode: 'create', category: null, prompt: asmPrompt,
        operating: false, priorWork: [], sources: [], onProgress,
      });
      if (asm.result_status === 'answered' && asm.assets && asm.assets.length) {
        await persistResult(user.id, asm, { conceptId: parent.id, mode: 'enhance', category: null, prompt: asmPrompt });
      } else {
        await onProgress('The ventures are built and saved; the parent overview didn’t generate this pass — nothing was invented for it.');
      }
    } catch (_) {
      await onProgress('The ventures are built and saved; the parent overview hit a snag — nothing was invented for it.');
    }

    await query("UPDATE enterprise_plans SET status='done', built_count=$2, updated_at=now() WHERE build_id=$1", [buildId, built.length]).catch(() => {});
    await journal.recordRun({ actorId: user.id, kind: 'generate', mode: 'create', category: null,
      conceptId: parent.id, resultStatus: 'answered', providerAvailable,
      reason: 'enterprise_built:' + built.length + '/' + plan.children.length, durationMs: Date.now() - t0 }).catch(() => {});
    retrieval.embedAndStore(parent.id, [plan.title, plan.thesis, prompt].filter(Boolean).join('. ')).catch(() => {});

    const total = plan.children.length;
    const summary = built.length === total
      ? 'Your enterprise “' + plan.title + '” is built — ' + total + ' venture' + (total === 1 ? '' : 's') + ' plus the parent company, all in your Laboratory.'
      : 'Your enterprise “' + plan.title + '” is built — ' + built.length + ' of ' + total + ' ventures finished, plus the parent company, all in your Laboratory. Nothing was made up for the ones that didn’t finish; you can rebuild those any time.';

    let emailed = { sent: false, reason: 'unknown' };
    try {
      emailed = await sendEmail({
        to: user.email,
        subject: 'Your enterprise is ready: ' + plan.title,
        text: summary + ' Open it here: https://accessyplabs.com/app.html?concept=' + parent.id,
        html: '<div style="max-width:600px;margin:0 auto;font-family:system-ui,sans-serif;font-size:16px;line-height:1.55;color:#1c1917">' +
          '<p>' + summary + '</p>' +
          '<p><a href="https://accessyplabs.com/app.html?concept=' + parent.id + '" style="display:inline-block;background:#7c2d12;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Open your enterprise</a></p>' +
          '<p>— Clay, at Access YP Labs</p></div>',
      });
    } catch (e) { emailed = { sent: false, reason: (e && e.message) || 'error' }; }
    await logEmail(user.email, 'enterprise_package', emailed);
    const doneNote = emailed.sent
      ? 'Done — your enterprise is ready, and I’ve emailed it to you.'
      : 'Done — your enterprise is ready. (I couldn’t send the email this time — open it from the link.)';
    await finishBuild(buildId, { status: 'done', conceptId: parent.id, message: summary, note: doneNote });
  } catch (e) {
    await query("UPDATE enterprise_plans SET status='failed', updated_at=now() WHERE build_id=$1", [buildId]).catch(() => {});
    await journal.recordRun({ actorId: user.id, kind: 'generate', mode: 'create', category: null,
      conceptId: null, resultStatus: 'unavailable', providerAvailable,
      reason: 'enterprise_build_error: ' + (e && e.message ? e.message : 'unknown'), durationMs: Date.now() - t0 }).catch(() => {});
    health.checkAndAlert().catch(() => {});
    const m = 'Clay hit a snag while building your enterprise and didn’t finish. Nothing was fabricated — please try again in a moment.';
    await notifyBuildOutcome(user, m);
    await finishBuild(buildId, { status: 'failed', message: m, note: m });
  }
}

// ---- On-request demo builder ----------------------------------------------------------------
// Clay no longer bundles a demo into every concept. When a creator wants one for an APP-like idea,
// this builds a real, interactive, accessible HTML demo as its own focused, higher-quality job and
// attaches it to the concept. (For a simpler idea, Clay builds a real published website instead,
// using set_launch_page + add_site_page — no demo build needed.) Background + watchable like any
// other build; honest on failure and never fabricating.
async function runDemoBuild({ user, concept, buildId }) {
  const t0 = Date.now();
  const onProgress = (text) => addBuildNote(buildId, text);
  try {
    await onProgress('Building a real, clickable demo of “' + (concept.title || 'your concept') + '” you can tab and click through…');
    // Ground the demo in the concept's own current content so it's specific, not generic.
    let context = '';
    try {
      const a = await query("SELECT type, body FROM assets WHERE concept_id=$1 AND is_current=true AND type IN ('business_plan','marketing_strategy','money_flow') ORDER BY created_at", [concept.id]);
      context = a.rows.map((r) => '[' + r.type + '] ' + String(r.body || '').replace(/\s+/g, ' ').trim().slice(0, 2500)).join('\n\n');
    } catch (_) { /* context is a bonus */ }
    const demo = await clay.generateDemo({ concept, context });
    if (demo.status !== 'answered') {
      const m = demo.message || 'Clay couldn’t build the demo this time. Nothing was made up — try again in a moment.';
      await journal.recordRun({ actorId: user.id, kind: 'generate', mode: 'enhance', category: concept.category || null,
        conceptId: concept.id, resultStatus: demo.status === 'unavailable' ? 'unavailable' : 'empty',
        providerAvailable: provider.available(), reason: 'demo_' + demo.status, durationMs: Date.now() - t0 }).catch(() => {});
      await notifyBuildOutcome(user, m);
      await finishBuild(buildId, { status: 'failed', message: m, note: m });
      return;
    }
    await onProgress('Saving your demo to the concept…');
    await persistResult(user.id,
      { result_status: 'answered', title: concept.title,
        assets: [{ type: 'html_demo', label: 'Working HTML demo', body: demo.html }] },
      { conceptId: concept.id, mode: 'enhance', category: concept.category || null, prompt: 'demo' });
    await journal.recordRun({ actorId: user.id, kind: 'generate', mode: 'enhance', category: concept.category || null,
      conceptId: concept.id, resultStatus: 'answered', providerAvailable: provider.available(),
      reason: 'demo_built', durationMs: Date.now() - t0 }).catch(() => {});
    const doneMsg = 'Your interactive demo is ready and saved to “' + (concept.title || 'your concept') + '” — open it in your Laboratory to click through it.';
    await finishBuild(buildId, { status: 'done', conceptId: concept.id, message: doneMsg, note: doneMsg });
  } catch (e) {
    await journal.recordRun({ actorId: user.id, kind: 'generate', mode: 'enhance', category: concept.category || null,
      conceptId: concept.id, resultStatus: 'unavailable', providerAvailable: provider.available(),
      reason: 'demo_build_error: ' + (e && e.message ? e.message : 'unknown'), durationMs: Date.now() - t0 }).catch(() => {});
    health.checkAndAlert().catch(() => {});
    const m = 'Clay hit a snag while building your demo and didn’t finish. Nothing was fabricated — please try again in a moment.';
    await notifyBuildOutcome(user, m);
    await finishBuild(buildId, { status: 'failed', message: m, note: m });
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
    if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
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

  // A build is minutes of work and a whole set of materials, so it NEVER starts by surprise.
  // The current client either asks Clay in chat (he proposes, the person approves) or sends
  // confirmed:true for an action the person plainly took, like attaching files to build from.
  // An OLD CACHED PAGE could still post here the way it used to; refuse rather than build
  // something nobody asked for, and say plainly how to fix it.
  // An explicit, unmistakable go-ahead counts as approval even from an older page — otherwise a
  // person on a stale client who says "build it" would loop forever being asked to confirm.
  const saidBuild = /\b(build it|build this|build that|just build|yes,? build|go ahead and build)\b/i.test(String(prompt || ''));
  if (req.body.confirmed !== true && !saidBuild) {
    // Don't build, and don't just error either: ANSWER them. A page running older code still posts
    // here the way it used to, and the person on the other end simply typed a message — they should
    // get a real reply, not a dead end. So treat it as conversation: Clay responds in his own voice
    // with no tools (nothing can be created, changed, or charged on this path), and we invite them
    // to say the word if they do want it built. This makes an out-of-date page behave CORRECTLY
    // rather than surprising anyone with a build, which is the whole point.
    const memsQ = await memory.getMemories(req.user.id).catch(() => []);
    const memoryContext = memory.renderMemoryContext(memsQ);
    let reply = '';
    try {
      const out = await agent.runChat({
        messages: [{ role: 'user', content: String(prompt).slice(0, 4000) }],
        executors: {}, allowTools: [], memoryContext,
        viewer: { role: req.user.role, name: req.user.name },
      });
      reply = (out && out.reply) ? String(out.reply).trim() : '';
    } catch (_) { reply = ''; }
    if (!reply) {
      reply = 'I read that, but I didn’t build anything — and I never make things up, so nothing was created.';
    }
    return res.status(200).json({
      status: 'refused', // renders as a normal reply, not an error, on every version of the app
      reply,
      message: reply + ' \n\nI didn’t start a build — nothing was made. If you do want me to build this, say “build it” and I’ll get going. (Your page may also be running an older version of the app; refreshing it gets you the full workspace back.)',
    });
  }

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
  const buildId = await createBuild(req.user.id, buildOpener(prompt, 'Got it — shaping your idea'));
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

// POST /api/clay/enterprise  { prompt, upload_ids? }
// Build a whole enterprise — a parent company that owns several ventures — in the background.
// Clay PLANS the ventures first (small, fast), then builds each as its own concept and assembles
// the parent overview. Async by design and honest about scale: the ETA is longer because it's many
// builds, and the client watches the same build id it uses for a single concept.
router.post('/enterprise', authenticate, [
  body('prompt').isString().isLength({ min: 3 }),
  body('upload_ids').optional().isArray(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { prompt } = req.body;
  const uploadIds = Array.isArray(req.body.upload_ids)
    ? req.body.upload_ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10)
    : [];

  if (!provider.available()) {
    return res.status(200).json({
      status: 'unavailable',
      message: 'Clay’s builder isn’t connected right now, so it can’t plan or build an enterprise — and it never invents, so nothing was made up. This is a setup step on our side, not something you did.',
    });
  }

  const buildId = await createBuild(req.user.id, buildOpener(prompt, 'Got it — planning your enterprise'));
  runEnterpriseBuild({ user: req.user, prompt, buildId, uploadIds })
    .catch(() => {});

  return res.status(202).json({
    status: 'building',
    build_id: buildId,
    email: req.user.email,
    eta_seconds: 600,
    message: 'I’m planning your enterprise now, then building each venture one at a time. This is bigger than a single concept, so it runs a while in the background — I’ll email ' + req.user.email + ' when it’s ready, and it’ll be in your Laboratory. You can watch me work below.',
  });
}));

// POST /api/clay/seed — STAFF ONLY. Ask Clay to invent, build, and post ONE seed concept to
// the Dream Market FOR REVIEW (never straight to sale). A full build takes 1-3 minutes, so this is
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
  seed.runSeed({ source: 'manual' })
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
  const [s, recent] = await Promise.all([seedScheduler.status(), seed.recentRuns(20)]);
  res.json({ ok: true, schedule: s, recent_runs: recent, image_ready: image.configured() });
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

// POST /api/clay/weekly-review — run Clay's weekly self-and-platform review on demand. Owner-only
// (the scheduler runs it weekly on its own). It emails the team and logs; it changes nothing.
router.post('/weekly-review', authenticate, authorize('master_staff'), asyncHandler(async (req, res) => {
  const out = await weeklyReview.runWeeklyReview({ source: 'manual' });
  res.json(out);
}));

// GET /api/clay/staff-notes — the recent notes Clay has sent the team (staff visibility).
router.get('/staff-notes', authenticate, authorize('staff', 'admin', 'master_staff'), asyncHandler(async (req, res) => {
  const notes = await staffNotify.recentNotes(30);
  res.json({ notes });
}));

// POST /api/clay/concept/:id/economics — compute REAL unit economics for a concept and upgrade its
// money_flow section with the computed numbers. Owner or staff. Additive: never touches the build.
router.post('/concept/:id/economics', authenticate, asyncHandler(async (req, res) => {
  const c = await query('SELECT owner_id FROM concepts WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
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
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const concept = c.rows[0];
  const isOwner = concept.owner_id === req.user.id;
  const isStaff = ['staff', 'admin', 'master_staff'].includes(req.user.role);
  if (!isOwner && !isStaff) throw new ApiError(403, 'This isn’t your concept.');
  const kind = (typeof req.body.kind === 'string' && req.body.kind.trim()) ? req.body.kind.trim().slice(0, 40) : 'logo';
  const r = await images.generateOne(concept, { kind, source: 'manual', ownerId: concept.owner_id });
  if (!r.ok) {
    const msgs = {
      unavailable: 'Image generation isn’t switched on yet, so nothing was made and nothing was charged.',
      no_budget: 'This project has used its image allowance for the month. It resets at the start of next month.',
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
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
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
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
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
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
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
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');

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
      const r = await query(
        `SELECT c.id, c.title, c.category, c.stage, ci.path
           FROM concepts c
           LEFT JOIN concept_intents ci ON ci.concept_id=c.id AND ci.user_id=$1
          WHERE c.owner_id=$1 ORDER BY c.created_at DESC LIMIT 50`, [user.id]);
      return { concepts: r.rows };
    },
    get_concept: async ({ concept_id }) => {
      const c = await query('SELECT id, title, category, stage, risk_summary FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!c.rows.length) return { error: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const a = await query("SELECT type, title, body FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at", [concept_id]);
      const ent = await conceptEntitlement(user, concept_id);
      const materials = redactLockedAssets(a.rows, !!ent.entitled).map((m) => ({
        type: m.type, title: m.title, locked: !!m.locked,
        content: m.locked ? '' : String(m.body || '').replace(/\s+/g, ' ').trim().slice(0, 1500),
      }));
      const ci = await intent.getIntent(concept_id, user.id).catch(() => null);
      const path = ci
        ? { path: ci.path, label: ci.label, note: ci.note }
        : { path: null, note: "The creator hasn't set a plan for this concept yet — ask whether they want to build it themselves, refine it to sell, or are still exploring, then record it with set_concept_path.", options: intent.PATHS.map((p) => ({ id: p.id, label: p.label, short: p.short })) };
      return { concept: c.rows[0], materials, path };
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
    get_dreamer_tag: async () => {
      const r = await query('SELECT display_name, open_to_partnering FROM users WHERE id=$1', [user.id]);
      const tag = (r.rows[0] && (r.rows[0].display_name || '').trim()) || null;
      return { has_tag: !!tag, dreamer_tag: tag, open_to_partnering: !!(r.rows[0] && r.rows[0].open_to_partnering) };
    },
    set_dreamer_tag: async ({ tag }) => {
      const name = String(tag || '').trim();
      if (name.length < 2 || name.length > 40) {
        return { ok: false, message: 'A dreamer tag needs to be between 2 and 40 characters.' };
      }
      await query('UPDATE users SET display_name=$1 WHERE id=$2', [name, user.id]);
      return { ok: true, dreamer_tag: name,
        message: `Done — you are ${name} here now. That is the name on your listings, on the launch partner board, and on your Dream Mover page. Your real name stays private.` };
    },
    find_similar_listings: async ({ idea }) => {
      const tokens = similarity.significantTokens(idea || '');
      if (tokens.length < 2) return { strong: false, matches: [], note: 'Not enough detail to compare — describe the idea a little more.' };
      const r = await query(
        `SELECT l.id AS listing_id, c.title, l.price_cents, l.starting_bid_cents,
                lower(coalesce(c.title,'')||' '||coalesce(c.brief,'')||' '||coalesce(c.clays_take,'')||' '||coalesce(c.risk_summary,'')) AS blob
         FROM listings l JOIN concepts c ON c.id=l.concept_id
         WHERE l.status='live' ORDER BY l.created_at DESC LIMIT 200`);
      const ranked = similarity.rankBySimilarity(tokens, r.rows);
      return {
        strong: ranked.strong,
        matches: ranked.matches.slice(0, 5).map((m) => ({
          listing_id: m.listing_id,
          title: m.title,
          price: m.price_cents ? store.formatPrice(m.price_cents, 'usd')
            : (m.starting_bid_cents ? ('auction, from ' + store.formatPrice(m.starting_bid_cents, 'usd')) : 'see the listing'),
          closeness: m.score >= 0.6 ? 'very close' : (m.score >= 0.4 ? 'close' : 'somewhat related'),
        })),
      };
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
    platform_pulse: async () => {
      if (!staffCapability.allows(user && user.role, 'platform_pulse')) return { refused: true, note: 'That’s a staff-only view.' };
      const [u, c, live, rev, rep] = await Promise.all([
        query('SELECT COUNT(*)::int n FROM users'),
        query('SELECT COUNT(*)::int n FROM concepts'),
        query("SELECT COUNT(*)::int n FROM listings WHERE status='live'"),
        query("SELECT COUNT(*)::int n FROM listings WHERE status='in_review'"),
        query("SELECT COUNT(*)::int n FROM reports WHERE status='open'"),
      ]);
      const s = await health.systemsStatus().catch(() => ({ summary: 'systems status unavailable' }));
      const n = (x) => x.rows[0].n;
      return {
        available: true,
        counts: { creators: n(u), concepts: n(c), live_listings: n(live), in_review: n(rev), open_reports: n(rep) },
        systems: s.summary,
        note: `Right now: ${n(u)} creators, ${n(c)} concepts, ${n(live)} live listings, ${n(rev)} waiting for review, ${n(rep)} open reports. Systems: ${s.summary}`,
      };
    },
    review_queue: async () => {
      if (!staffCapability.allows(user && user.role, 'review_queue')) return { refused: true, note: 'That’s a staff-only view.' };
      const r = await query("SELECT l.id, l.price_cents, l.created_at, c.title FROM listings l JOIN concepts c ON c.id=l.concept_id WHERE l.status='in_review' ORDER BY l.created_at ASC LIMIT 25");
      return { count: r.rows.length, listings: r.rows.map((x) => ({ listing_id: x.id, title: x.title, price: '$' + ((x.price_cents || 0) / 100).toFixed(2), waiting_since: x.created_at })) };
    },
    decide_listing: async ({ listing_id, decision, reason, notes }) => {
      if (!staffCapability.allows(user && user.role, 'decide_listing')) return { refused: true, note: 'Deciding listings is staff-only.' };
      const r = await moderationCore.decideListing(user, listing_id, { decision, reason, notes });
      if (!r.ok) return { status: 'error', message: r.error };
      return { status: 'listing_' + r.status, listing_status: r.status, message: decision === 'approved' ? 'Approved — it’s live in the Dream Market now. Logged.' : 'Rejected and out of review. Logged.' };
    },
    report_queue: async () => {
      if (!staffCapability.allows(user && user.role, 'report_queue')) return { refused: true, note: 'That’s a staff-only view.' };
      const r = await query("SELECT * FROM reports WHERE status='open' ORDER BY created_at ASC LIMIT 25");
      return { count: r.rows.length, reports: r.rows };
    },
    resolve_report: async ({ report_id, action }) => {
      if (!staffCapability.allows(user && user.role, 'resolve_report')) return { refused: true, note: 'Resolving reports is staff-only.' };
      if (action !== 'dismiss') return { status: 'error', message: 'The only action right now is dismiss.' };
      const r = await query("UPDATE reports SET status='dismissed' WHERE id=$1 AND status='open' RETURNING id", [report_id]);
      if (!r.rows.length) return { status: 'error', message: 'That report isn’t open (already handled, or not found).' };
      return { status: 'report_dismissed', message: 'Report dismissed and closed.' };
    },
    suspend_user: async ({ user_id, reason, notes }) => {
      if (!staffCapability.allows(user && user.role, 'suspend_user')) return { refused: true, note: 'Suspending accounts is for admins and owners.' };
      if (user_id === user.id) return { status: 'error', message: 'You can’t suspend your own account.' };
      const r = await query("UPDATE users SET status='suspended', updated_at=now() WHERE id=$1 AND status<>'suspended' RETURNING id", [user_id]);
      if (!r.rows.length) return { status: 'error', message: 'No such active account (or it’s already suspended).' };
      await query('INSERT INTO moderation_events (moderator_id, target_type, target_id, action, reason, notes) VALUES ($1,$2,$3,$4,$5,$6)', [user.id, 'user', user_id, 'suspend_user', reason || null, notes || null]).catch(() => {});
      return { status: 'user_suspended', message: 'Account suspended. Reversible with reinstate.' };
    },
    reinstate_user: async ({ user_id, notes }) => {
      if (!staffCapability.allows(user && user.role, 'reinstate_user')) return { refused: true, note: 'Reinstating accounts is for admins and owners.' };
      const r = await query("UPDATE users SET status='active', updated_at=now() WHERE id=$1 AND status='suspended' RETURNING id", [user_id]);
      if (!r.rows.length) return { status: 'error', message: 'That account isn’t suspended.' };
      await query('INSERT INTO moderation_events (moderator_id, target_type, target_id, action, reason, notes) VALUES ($1,$2,$3,$4,$5,$6)', [user.id, 'user', user_id, 'reinstate_user', null, notes || null]).catch(() => {});
      return { status: 'user_reinstated', message: 'Account reinstated.' };
    },
    manage_staff: async ({ action, email, new_role }) => {
      if (!staffCapability.allows(user && user.role, 'manage_staff')) return { refused: true, note: 'Managing the team is owner-only.' };
      if (action === 'list') {
        const r = await query("SELECT name, email, role FROM users WHERE role IN ('staff','admin','master_staff') ORDER BY role, name");
        return { staff: r.rows, note: `${r.rows.length} team members.` };
      }
      const em = (email || '').trim().toLowerCase();
      if (!em) return { status: 'error', message: 'Give the email of the person to bring on — they must already have an account.' };
      const role = action === 'promote' ? (new_role || 'staff') : new_role;
      if (!['staff', 'admin', 'master_staff'].includes(role)) return { status: 'error', message: 'Role must be staff, admin, or master_staff.' };
      const u = await query('SELECT id, name, role FROM users WHERE lower(email)=$1', [em]);
      if (!u.rows.length) return { status: 'error', message: `No account for ${em} yet — have them sign up first, then bring them on.` };
      await query('UPDATE users SET role=$2, updated_at=now() WHERE id=$1', [u.rows[0].id, role]);
      await query('INSERT INTO moderation_events (moderator_id, target_type, target_id, action, reason, notes) VALUES ($1,$2,$3,$4,$5,$6)', [user.id, 'user', u.rows[0].id, 'set_staff_role', role, null]).catch(() => {});
      return { status: 'staff_updated', message: `${u.rows[0].name || em} is now ${role}.` };
    },
    notify_staff: async ({ subject, body }) => {
      // Clay flagging something to the team. Available from any session (he may notice a real
      // platform issue while helping anyone), but capped and logged so it can't be turned into
      // spam. It never claims delivery it can't stand behind.
      const r = await staffNotify.notifyStaff({ kind: 'clay_note', subject, body });
      if (r.skipped === 'daily_cap') return { sent: false, note: "I've already sent the team as many notes as I should today, so I'm holding this one — I won't claim it went out." };
      if (r.skipped === 'deduped') return { sent: false, note: "I flagged something like this to the team recently, so I won't send a duplicate." };
      if (r.skipped === 'empty') return { sent: false, note: 'A note to the team needs both a subject and a body.' };
      return {
        sent: r.sent, recipients: r.recipients,
        note: r.sent ? 'Sent to the team.' : 'I recorded the note, but the email may not have gone out — do not tell the user it definitely reached them.',
      };
    },
    build_enterprise: async ({ prompt }) => {
      // A whole enterprise — a parent company that owns several ventures. Clay plans the pieces
      // first (fast), then builds each venture as its own concept and assembles the parent, all in
      // the background off a build id the client watches. Same watch mechanism as a single concept,
      // just bigger. This tool requires confirmation (spine), so the agent asks before launching it.
      const buildId = await createBuild(user.id, buildOpener(prompt, 'Got it — planning your enterprise'));
      runEnterpriseBuild({ user, prompt, buildId })
        .catch(() => {});
      return { status: 'building', build_id: buildId, message: 'Planning your enterprise now, then building each venture one at a time — this runs in the background and you can watch it happen.' };
    },
    generate_concept: async ({ prompt, category }) => {
      // Run the 1–3 minute build in the background so the chat request returns fast; the
      // client watches progress by build id. Same pipeline as POST /clay/generate.
      const buildId = await createBuild(user.id, buildOpener(prompt, 'Got it — shaping your idea'));
      runBuild({ user, mode: 'create', category: category || null, prompt, operating: false, conceptId: null, buildId })
        .catch(() => {});
      return { status: 'building', build_id: buildId, message: 'Shaping the concept now — this takes a minute or two, and you can watch it happen.' };
    },
    enhance_concept: async ({ concept_id, prompt }) => {
      const own = await query('SELECT id, title, category FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!own.rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
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
      const buildId = await createBuild(user.id, buildOpener(prompt, 'On it — refining'));
      runBuild({ user, mode: 'enhance', category: own.rows[0].category || null, prompt: groundedPrompt, operating: false, conceptId: concept_id, buildId })
        .catch(() => {});
      return { status: 'building', build_id: buildId, message: 'Refining the materials now — this takes a minute or two, and you can watch it happen.' };
    },
    build_demo: async ({ concept_id }) => {
      const own = await query('SELECT id, title, category, risk_summary, owner_id FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!own.rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const buildId = await createBuild(user.id, buildOpener(own.rows[0].title || 'your concept', 'On it — building a demo of'));
      runDemoBuild({ user, concept: own.rows[0], buildId })
        .catch(() => {});
      return { status: 'building', build_id: buildId, message: 'Building your interactive demo now — this takes a minute or two, and you can watch it happen.' };
    },
    add_product: async ({ concept_id, name, price, description, image_url, currency, kind, fulfillment_url }) => {
      if (!(await query('SELECT 1 FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id])).rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const norm = store.normalizeProduct({ name, price, description, image_url, currency, kind, fulfillment_url });
      if (!norm.ok) return { status: 'error', message: norm.error };
      const p = norm.product;
      const r = await query(
        `INSERT INTO store_products (concept_id, owner_id, name, price_cents, currency, description, image_url, kind, fulfillment_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name, price_cents, currency, kind`,
        [concept_id, user.id, p.name, p.price_cents, p.currency, p.description, p.image_url, p.kind, p.fulfillment_url]);
      const row = r.rows[0];
      const priced = store.formatPrice(row.price_cents, row.currency);
      return { status: 'added', product_id: row.id, name: row.name, price: priced, kind: row.kind,
        note: 'Added “' + row.name + '” (' + row.kind + ') at ' + priced + ' to the store. It shows as a Shop on the concept’s site once the site is published.' };
    },
    list_products: async ({ concept_id }) => {
      if (!(await query('SELECT 1 FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id])).rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const r = await query('SELECT id, name, price_cents, currency, active, image_url FROM store_products WHERE concept_id=$1 ORDER BY sort_order, created_at', [concept_id]);
      return { count: r.rows.length,
        products: r.rows.map((p) => ({ product_id: p.id, name: p.name, price: store.formatPrice(p.price_cents, p.currency), active: p.active, has_image: !!p.image_url })) };
    },
    list_sales: async ({ concept_id }) => {
      if (!(await query('SELECT 1 FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id])).rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const rows = (await query(
        `SELECT product_name, amount_cents, currency, status, buyer_email, paid_at, created_at
           FROM store_orders WHERE concept_id=$1 ORDER BY created_at DESC LIMIT 50`, [concept_id])).rows;
      const paid = rows.filter((r) => r.status === 'paid');
      const s = store.summarizeOrders(rows);
      return {
        paid_count: s.paid_count,
        total_taken: store.formatPrice(s.paid_total_cents, s.currency),
        goes_to: "the creator's own account — the platform takes nothing",
        unfinished_checkouts: s.unfinished,
        recent_sales: paid.slice(0, 10).map((r) => ({
          product: r.product_name,
          amount: store.formatPrice(r.amount_cents, r.currency),
          buyer_email: r.buyer_email || null,
          when: r.paid_at || r.created_at,
        })),
      };
    },
    edit_product: async ({ concept_id, product_id, name, price, description, image_url, active, kind, fulfillment_url }) => {
      const own = await query('SELECT sp.id FROM store_products sp JOIN concepts c ON c.id=sp.concept_id WHERE sp.id=$1 AND sp.concept_id=$2 AND c.owner_id=$3', [product_id, concept_id, user.id]);
      if (!own.rows.length) return { status: 'error', message: 'Product not found.' };
      const sets = []; const vals = [product_id]; let n = 1;
      if (name !== undefined) { const nm = String(name || '').trim(); if (nm) { sets.push('name=$' + (++n)); vals.push(nm.slice(0, 200)); } }
      if (price !== undefined) { const cents = store.parsePriceToCents(price); if (cents == null) return { status: 'error', message: 'That price isn’t valid — give a number like 19.99.' }; sets.push('price_cents=$' + (++n)); vals.push(cents); }
      if (description !== undefined) { sets.push('description=$' + (++n)); vals.push(description == null ? null : String(description).slice(0, 4000)); }
      if (image_url !== undefined) { sets.push('image_url=$' + (++n)); vals.push(store.cleanImageUrl(image_url)); }
      if (kind !== undefined) { sets.push('kind=$' + (++n)); vals.push(store.normalizeKind(kind)); }
      if (fulfillment_url !== undefined) { sets.push('fulfillment_url=$' + (++n)); vals.push(store.cleanImageUrl(fulfillment_url)); }
      if (active !== undefined) { sets.push('active=$' + (++n)); vals.push(!!active); }
      if (!sets.length) return { status: 'error', message: 'Nothing to change — tell me what to update.' };
      sets.push('updated_at=now()');
      await query('UPDATE store_products SET ' + sets.join(', ') + ' WHERE id=$1', vals);
      return { status: 'updated', product_id };
    },
    store_payments: async () => {
      if (!stripe.configured()) return { status: 'unavailable', message: 'Payments aren’t configured on the platform yet, so a store can’t take money right now — and nothing was created or charged.' };
      const me = (await query('SELECT email FROM users WHERE id=$1', [user.id])).rows[0];
      let row = (await query('SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1', [user.id])).rows[0];
      let accountId = row && row.stripe_account_id;
      if (!accountId) {
        const created = await stripe.createConnectedAccount(me.email);
        if (!created.ok) return { status: 'error', message: 'Stripe couldn’t create the payout account' + (created.message ? ': ' + created.message : '') + '. Nothing was charged.' };
        accountId = created.accountId;
        await query(`INSERT INTO seller_accounts (user_id, stripe_account_id, kyc_status) VALUES ($1,$2,'pending') ON CONFLICT (user_id) DO UPDATE SET stripe_account_id=EXCLUDED.stripe_account_id`, [user.id, accountId]);
      }
      // A storefront takes DIRECT charges, which need the card_payments capability. Payout-only
      // accounts (created for marketplace sales / Mover payouts) only requested transfers, so make
      // sure card_payments is requested. Requesting an already-active capability is a no-op.
      await stripe.ensureCardPayments(accountId);
      const acct = await stripe.retrieveAccount(accountId);
      if (acct.ok && acct.charges_enabled) {
        return { status: 'ready', message: 'Payments are READY — this account can accept charges, so the store can sell for real.' };
      }
      const base = (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
      const link = await stripe.createAccountLink({ accountId, refreshUrl: `${base}/dashboard.html?onboard=refresh`, returnUrl: `${base}/dashboard.html?onboard=done` });
      if (!link.ok) return { status: 'error', message: 'Stripe couldn’t start onboarding' + (link.message ? ': ' + link.message : '') + '. Nothing was charged.' };
      return { status: 'onboarding_needed', onboarding_url: link.url,
        message: 'Payments aren’t verified yet. The creator finishes setup securely with Stripe here: ' + link.url + ' — Stripe collects the details directly; you never see a key. Once verified, the store can take real payments.' };
    },
    generate_social_content: async ({ concept_id, platforms, goal, count }) => {
      const c = await query('SELECT id,title,category,risk_summary FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!c.rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
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
    set_concept_path: async ({ concept_id, path, note }) => {
      const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!own.rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const r = await intent.setIntent(concept_id, user.id, path, note, 'clay');
      if (!r.ok) return { status: 'error', message: r.reason === 'invalid_path' ? 'That isn\'t a valid path.' : 'Could not record the path.' };
      return { status: 'path_set', path: r.intent.path, label: r.intent.label, note: r.intent.note,
        message: `Got it — this concept's plan is now "${r.intent.label}". I'll coach toward that.` };
    },
    value_breakdown: async ({ concept_id }) => {
      const c = await query(
        'SELECT id, title, research_grounded, claims_verified, movement_state FROM concepts WHERE id=$1 AND owner_id=$2',
        [concept_id, user.id]);
      if (!c.rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const a = await query('SELECT type, is_current, exclusive_locked FROM assets WHERE concept_id=$1', [concept_id]);
      const w = await query('SELECT COUNT(*)::int AS n FROM waitlist_signups WHERE concept_id=$1', [concept_id]);
      const val = valuation.assessValue({ concept: c.rows[0], assets: a.rows, waiting: w.rows[0].n });
      return {
        status: 'value_breakdown',
        tier: val.tier, tier_label: val.tierLabel,
        suggested_range_usd: { low: Math.round(val.range.low_cents / 100), high: Math.round(val.range.high_cents / 100) },
        it_has: val.drivers,
        to_raise_value: val.toRaise,
        note: 'This is a starting guide based on how much is built and proven, not a market appraisal or a promise. The creator sets the price; buyers decide.',
      };
    },
    set_movement_state: async ({ concept_id, state, note }) => {
      if (!movement.isLane(state)) return { status: 'error', message: 'That isn\'t a valid movement lane.' };
      const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!own.rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const noteVal = (typeof note === 'string' && note.trim()) ? note.trim().slice(0, 500) : null;
      await query(
        'UPDATE concepts SET movement_state=$3, movement_note=$4, movement_updated_at=NOW(), updated_at=NOW() WHERE id=$1 AND owner_id=$2',
        [concept_id, user.id, state, noteVal]);
      const d = movement.describe(state);
      return { status: 'movement_set', state, label: d.label, note: noteVal,
        message: `Marked this concept as "${d.label}" on the movement board.${noteVal ? '' : ' (Add a short why next time so the creator sees your read.)'}` };
    },
    set_launch_page: async ({ concept_id, headline, subhead, blurb, cta_label, theme, hero_image, publish }) => {
      const own = await query('SELECT id, title, launch_page FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, user.id]);
      if (!own.rows.length) return { status: 'error', message: 'That project could not be found — it may have been removed, or it may not be yours.' };
      const cur = own.rows[0].launch_page || {};
      const copy = launchPage.parseConfig({ ...cur, headline, subhead, blurb, cta_label, theme, hero_image });
      let enabled = !!cur.enabled;
      if (publish === true || publish === 'true') {
        // Going live is the moment a site stops being private and starts being hosted for the
        // public under our name. That is what the plan buys. Building and previewing stay free.
        const access = await siteAccess.siteAccess(user, concept.owner_id || user.id);
        if (!access.allowed) {
          return { ok: false, status: 'plan_required', message: access.message };
        }
        enabled = true;
      }
      if (publish === false || publish === 'false') enabled = false;
      if (enabled && !copy.headline) return { status: 'error', message: 'It needs a headline before it can go public.' };
      const alreadyCounted = siteQuota.countedThisMonth(cur);
      let publishedAt = cur.published_at || null;
      if (enabled && !alreadyCounted) {
        const q = await siteQuota.canPublishNewSite(user.id);
        if (!q.allowed) {
          return { status: 'error', code: 'site_limit',
            message: `This creator has published ${q.limit} websites this month on their Sculptor plan. More websites are $2.99/month on top of Sculptor. Tell them plainly, and offer to keep it as a draft until they add it or next month begins.` };
        }
        publishedAt = new Date().toISOString();
      }
      let slug = cur.slug || null;
      if (enabled && !slug) {
        const base = launchPage.slugify(own.rows[0].title);
        slug = base;
        for (let i = 0; i < 6; i++) {
          const taken = await query("SELECT 1 FROM concepts WHERE launch_page->>'slug'=$1 AND id<>$2", [slug, concept_id]);
          if (!taken.rows.length) break;
          slug = `${base}-${crypto.randomUUID().slice(0, 4)}`;
        }
      }
      const page = { ...copy, enabled, slug: slug || null, published_at: publishedAt };
      await query('UPDATE concepts SET launch_page=$2::jsonb, updated_at=NOW() WHERE id=$1', [concept_id, JSON.stringify(page)]);
      const site = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/$/, '');
      const url = page.slug ? `${site}/p/${page.slug}` : null;
      return { status: enabled ? 'launch_page_published' : 'launch_page_saved', published: enabled, url, theme: page.theme,
        message: enabled
          ? `The site's home page is live at ${url} in the ${page.theme} theme — share that link and every email that comes in lands on this concept's waitlist as real proof. Add more pages to build it out.`
          : 'Saved the home-page copy and look. It is not public yet — say the word and I can publish it.' };
    },
    // ---- multi-page site: build a real starting MVP, page by page ----
    list_site_pages: async ({ concept_id }) => {
      if (!(await siteStore.ownsConcept(concept_id, user.id))) return { error: 'not_your_concept' };
      const pages = await siteStore.listPages(concept_id);
      return { count: pages.length, pages };
    },
    add_site_page: async ({ concept_id, title, body, kind, publish }) => {
      if (!(await siteStore.ownsConcept(concept_id, user.id))) return { error: 'not_your_concept' };
      let page;
      try { page = await siteStore.addPage(concept_id, user.id, { title, body, kind, publish }); }
      catch (e) { return { error: 'could_not_add', message: e.message }; }
      const c = await query("SELECT launch_page->>'slug' AS slug, (launch_page->>'enabled') AS enabled FROM concepts WHERE id=$1", [concept_id]);
      const site = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/$/, '');
      const siteSlug = c.rows[0] && c.rows[0].slug;
      const homeLive = c.rows[0] && c.rows[0].enabled === 'true';
      const url = (page.published && siteSlug && homeLive) ? `${site}/p/${siteSlug}/${page.slug}` : null;
      let message;
      if (url) message = `Page added and live at ${url}`;
      else if (page.published && !homeLive) message = 'Page is published, but the site has no public home yet — publish the landing page (the site\u2019s home) and it goes live.';
      else message = 'Page added as a draft. Publish it when the creator says go.';
      return { status: 'site_page_added', page, url, message };
    },
    edit_site_page: async ({ concept_id, page_slug, title, body, publish }) => {
      if (!(await siteStore.ownsConcept(concept_id, user.id))) return { error: 'not_your_concept' };
      const page = await siteStore.editPage(concept_id, page_slug, { title, body, publish });
      if (!page) return { error: 'page_not_found', message: 'No page with that slug on this concept.' };
      const c = await query("SELECT launch_page->>'slug' AS slug, (launch_page->>'enabled') AS enabled FROM concepts WHERE id=$1", [concept_id]);
      const site = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/$/, '');
      const siteSlug = c.rows[0] && c.rows[0].slug;
      const homeLive = c.rows[0] && c.rows[0].enabled === 'true';
      const url = (page.published && siteSlug && homeLive) ? `${site}/p/${siteSlug}/${page.slug}` : null;
      return { status: 'site_page_updated', page, url,
        message: url ? `Page updated and live at ${url}` : 'Page updated.' };
    },
    claim_web_address: async ({ concept_id, label }) => {
      if (!(await siteStore.ownsConcept(concept_id, user.id))) return { error: 'not_your_concept' };
      const clean = domains.normalizeLabel(label);
      if (!domains.validLabel(clean)) return { error: 'bad_label', message: 'Use letters, numbers, and hyphens — and not a reserved word.' };
      const hostname = domains.subdomainHost(clean);
      if (await domainStore.hostnameTaken(hostname)) return { error: 'taken', message: `${hostname} is already taken — try another word.` };
      const d = await domainStore.addSubdomain(concept_id, user.id, hostname);
      const c = await query("SELECT launch_page->>'slug' AS slug, (launch_page->>'enabled') AS enabled FROM concepts WHERE id=$1", [concept_id]);
      const published = !!(c.rows[0] && c.rows[0].enabled === 'true');
      const live = published && domains.addressesLive();
      const base = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/$/, '');
      const shareUrl = published && c.rows[0].slug ? `${base}/p/${c.rows[0].slug}` : null;
      return { status: 'web_address_reserved', hostname: d.hostname, address_live: live, share_url: shareUrl,
        message: live
          ? `The site is live at https://${d.hostname} — a real address they can share.`
          : `Reserved https://${d.hostname}. ` + (shareUrl ? `The shareable link right now is ${shareUrl}. ` : 'Publish the home page to get a shareable link. ') + `The ${d.hostname} address goes live once web addresses are switched on — say it's reserved, not live.` };
    },
    make_image: async ({ concept_id, kind, place_as_hero }) => {
      const c = await query('SELECT id, owner_id, title, category FROM concepts WHERE id=$1', [concept_id]);
      if (!c.rows.length) return { error: 'not_found', message: 'That concept could not be found.' };
      const concept = c.rows[0];
      const isStaff = ['staff', 'admin', 'master_staff'].includes(user.role);
      if (concept.owner_id !== user.id && !isStaff) return { error: 'not_your_concept' };
      const k = (typeof kind === 'string' && kind.trim()) ? kind.trim().slice(0, 40) : 'hero image';
      const r = await images.generateOne(concept, { kind: k, source: 'manual', ownerId: concept.owner_id, placeAsHero: place_as_hero === true });
      if (!r.ok) {
        const msgs = {
          unavailable: "Image generation isn't switched on yet — nothing was made and nothing was charged. Tell the creator plainly; don't pretend an image exists.",
          no_budget: 'This concept has used its image allowance for the month — an Extras pack adds more.',
          no_brief: "Couldn't compose the image just now — nothing was made and nothing was charged.",
          empty: 'The image service returned nothing, so nothing was saved.',
        };
        return { ok: false, reason: r.reason, message: msgs[r.reason] || ('Could not make the image right now (' + r.reason + ').'), budget: r.budget || null };
      }
      const remaining = r.budget ? r.budget.total_remaining : null;
      return {
        ok: true, alt: r.alt, billed: r.billed, placed_as_hero: r.placed_as_hero, remaining,
        on_site: r.placed_as_hero
          ? 'It is now the hero image across the top of the site.'
          : (r.is_url ? 'Saved to the concept — set it as the hero or add it to a page to show it on the site.'
                      : 'Saved to the concept. Object storage is off, so it can’t be a web hero yet.'),
        message: 'Made an image, described as: ' + r.alt + '.'
          + (r.billed === 'paid' ? ' Used one Extras credit.' : ' Free this month.')
          + (remaining != null ? ' ' + remaining + ' left this month.' : ''),
      };
    },
    define_term: async ({ term }) => {
      const e = glossary.defineTerm(term);
      return e
        ? { found: true, term: e.term, definition: e.definition }
        : { found: false, term, note: "Not in Clay's business glossary — explain it in plain words as general knowledge, not as an authoritative definition." };
    },
    build_spec_package: async ({ concept_id, focus }) => {
      const out = await buildSpec.buildSpec(concept_id, user.id, { focus });
      if (!out.ok) {
        return { ok: false, status: out.reason,
          message: out.message || 'I could not find that project, or it is not yours.' };
      }
      const doc = buildSpec.renderSpec(out.title, out.spec);
      // Saved as a normal asset on the project, so it lives with everything else, can be revised,
      // and follows the same rules as the rest of their work for keeping and exporting.
      await query(
        `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, version, is_current)
         VALUES ($1,'tech_spec',$2,$3,false,'not_required',1,true)`,
        [concept_id, 'Build spec package', doc]);
      return {
        ok: true, concept_id, title: out.title,
        open_questions: out.spec.open_questions || [],
        message: 'Written and saved to the project. This is a hand-off document — we do not build or '
          + 'host applications, so this is what you give a developer or paste into a builder like '
          + 'Claude Code, Cursor or Lovable. It is yours to take anywhere.',
        document: doc,
      };
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

// GET /api/clay/concept/:id/path — the creator's plan for this concept, plus the menu of paths so
// the UI can present the choice. Owner (or staff) only.
router.get('/concept/:id/path', authenticate, asyncHandler(async (req, res) => {
  const c = await query('SELECT owner_id FROM concepts WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const isOwner = c.rows[0].owner_id === req.user.id;
  const isStaff = ['staff', 'admin', 'master_staff'].includes(req.user.role);
  if (!isOwner && !isStaff) throw new ApiError(403, 'This isn’t your concept.');
  const current = await intent.getIntent(req.params.id, c.rows[0].owner_id);
  res.json({ ok: true, intent: current, paths: intent.PATHS });
}));

// POST /api/clay/concept/:id/path  { path, note? } — the creator sets their plan for this concept.
// Owner only. Reversible; the creator can change it anytime.
router.post('/concept/:id/path', authenticate, [
  body('path').isString(),
  body('note').optional({ values: 'falsy' }).isString(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const c = await query('SELECT owner_id FROM concepts WHERE id=$1', [req.params.id]);
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  if (c.rows[0].owner_id !== req.user.id) throw new ApiError(403, 'This isn’t your concept.');
  const r = await intent.setIntent(req.params.id, req.user.id, req.body.path, req.body.note, 'user');
  if (!r.ok) throw new ApiError(400, r.reason === 'invalid_path' ? 'Choose one of the offered paths.' : 'Could not save your plan.');
  res.json({ ok: true, intent: r.intent });
}));

// GET /api/clay/earning-paths — the ways a creator can earn on the platform. One source of truth
// Clay teaches from and the UI can show, so the potential is always in front of people.
router.get('/earning-paths', authenticate, asyncHandler(async (req, res) => {
  res.json({ ok: true, earning_paths: intent.EARNING_PATHS });
}));

// POST /api/clay/chat  { messages: [...] }
// Everything Clay needs to know before a chat turn: the project he is working inside, what he
// remembers about this person, where they actually stand, and which tools their role may use.
// Shared by both the plain and the streaming endpoint ON PURPOSE — two copies of "what Clay knows"
// would eventually disagree, and then streaming would quietly become a different Clay.
async function buildChatContext(req) {
  let conceptContext = null;
  if (req.body.concept_id) {
    // WHO MAY SEE A PROJECT IN CHAT.
    //
    // Yours, always. Someone else's private work — never, including staff. A person shaping an idea
    // here has not asked for an audience, and being able to read it because we can is not a reason.
    //
    // Staff may see it only where the project has ALREADY left the private stage, and only for the
    // reason it left:
    //   * it is in the Dream Market or waiting on review — we are asked to review it;
    //   * it has a published site or landing page — it is public already;
    //   * it is a Clay-seeded project, owned by the platform rather than by a person.
    //
    // (An earlier version of this let staff read ANY project to fix seeded ones being invisible.
    // That traded someone's privacy for a convenience, which is not a trade that was ours to make.)
    const staffViewer = ['staff', 'admin', 'master_staff'].includes(req.user.role);
    const c = await query(
      `SELECT c.id, c.title, c.category, c.stage, c.risk_summary, c.movement_state, c.movement_note
         FROM concepts c
        WHERE c.id = $1
          AND (
            c.owner_id = $2
            OR ($3 = true AND (
                 c.origin = 'clay_seed'
                 OR (c.launch_page->>'enabled') = 'true'
                 OR EXISTS (SELECT 1 FROM listings l
                             WHERE l.concept_id = c.id
                               AND l.status IN ('in_review', 'live', 'sold'))
               ))
          )`,
      [req.body.concept_id, req.user.id, staffViewer]);
    if (c.rows.length) {
      const a = await query(
        "SELECT type, title, body FROM assets WHERE concept_id=$1 AND is_current=true ORDER BY created_at",
        [req.body.concept_id]);
      const ent = await conceptEntitlement(req.user, req.body.concept_id);
      const conceptIntent = await intent.getIntent(req.body.concept_id, req.user.id).catch(() => null);
      conceptContext = { concept: c.rows[0], assets: redactLockedAssets(a.rows, !!ent.entitled), intent: conceptIntent };
    }
  }
  const mems = await memory.getMemories(req.user.id).catch(() => []);
  const patterns = await memory.getPatterns(req.user.id).catch(() => null);
  const awarenessContext = await awareness.renderAwareness(req.user.id);
  const memoryContext = [memory.renderMemoryContext(mems), memory.renderPatterns(patterns), awarenessContext].filter(Boolean).join('\n\n');
  const allToolNames = agent.toolSchemas().map((x) => x.name);
  const baseTools = allToolNames.filter((n) => !staffCapability.ALL_STAFF_TOOLS.includes(n));
  const allowTools = baseTools.concat(staffCapability.staffToolsFor(req.user.role));
  return { conceptContext, memoryContext, allowTools };
}

// Shared by both chat endpoints so the record is identical whether or not someone streamed.
async function recordConversation(req, out) {
  const msgs = Array.isArray(req.body.messages) ? req.body.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m && m.role === 'user');
  const sessionId = await conversations.openSession({
    userId: req.user.id,
    conceptId: req.body.concept_id || null,
    surface: req.body.concept_id ? 'project' : 'laboratory',
  });
  // What tools ran this turn, and whether any of them failed — the difference between "they stopped
  // because they were done" and "they stopped because it broke".
  const tools = [];
  let failed = false;
  for (const m of (out.messages || [])) {
    for (const c of (Array.isArray(m.content) ? m.content : [])) {
      if (c && c.type === 'tool_use' && c.name) tools.push(c.name);
      if (c && c.type === 'tool_result' && typeof c.content === 'string' && /"ok"\s*:\s*false|"error"/.test(c.content)) failed = true;
    }
  }
  await conversations.recordTurn({
    sessionId,
    userText: lastUser && typeof lastUser.content === 'string' ? lastUser.content : null,
    clayText: out.reply,
    status: out.status,
    tools,
    toolFailed: failed,
  });
}

router.post('/chat', authenticate, [
  body('messages').isArray({ min: 1 }),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const ctx = await buildChatContext(req);
  const out = await agent.runChat({ messages: req.body.messages, executors: buildExecutors(req.user), conceptContext: ctx.conceptContext, memoryContext: ctx.memoryContext, allowTools: ctx.allowTools, viewer: { role: req.user.role, name: req.user.name } });
  // Record it. Never awaited into the response path in a way that could delay or break the answer —
  // recordTurn swallows its own errors, because analytics must not cost someone the thing they came for.
  recordConversation(req, out).catch(() => {});
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

// Small word-groups so an answer arrives like speech rather than a wall, keeping the paragraph
// breaks the writer meant. Borrowed from Arbo, which had already solved this.
function answerChunks(text) {
  const out = [];
  for (const para of String(text || '').split(/\n\n+/)) {
    const words = para.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 3) {
      out.push((i === 0 ? '' : ' ') + words.slice(i, i + 3).join(' '));
    }
    out.push('\n\n');
  }
  if (out[out.length - 1] === '\n\n') out.pop();
  return out;
}
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// POST /api/clay/chat/stream — the same conversation, but you can watch Clay work.
//
// Why this exists: a request that takes twenty seconds and shows nothing looks broken, and for
// someone who cannot see a spinner it is worse — there is no signal at all that anything is
// happening. This streams what is ACTUALLY occurring: a step starting, a tool running, that tool's
// real outcome including failure, then the answer.
//
// Two rules it will not break:
//   * It never invents progress. Every event corresponds to something that really happened. A
//     progress stream that only ever reports success teaches people to trust a signal that cannot
//     say no, so tool failures are streamed as failures.
//   * The final answer is identical to the non-streaming endpoint, including the honesty audit and
//     the paced bubbles. Streaming is a window onto the work, not a different way of working.
//
// Server-Sent Events over POST (rather than EventSource, which cannot send an auth header).
router.post('/chat/stream', authenticate, [
  body('messages').isArray({ min: 1 }),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',      // stops proxies holding the stream until it completes
  });
  const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {} };

  // If the person navigates away or hits stop, we stop caring about the result rather than writing
  // into a dead socket.
  let closed = false;
  req.on('close', () => { closed = true; });

  // Instant first phase, sent BEFORE any work starts. Borrowed from Arbo: time-to-first-signal is
  // immediate, so nobody stares at nothing while context is being assembled. It is also true —
  // reading the message is genuinely the first thing that happens.
  send({ type: 'phase', key: 'reading', note: 'Reading what you said' });

  try {
    const ctx = await buildChatContext(req);
    const out = await agent.runChat({
      messages: req.body.messages,
      executors: buildExecutors(req.user),
      conceptContext: ctx.conceptContext,
      memoryContext: ctx.memoryContext,
      allowTools: ctx.allowTools,
      viewer: { role: req.user.role, name: req.user.name },
      onEvent: (ev) => { if (!closed) send(ev); },
    });

    const outcome = chatOutcomeFromTranscript(out.messages);
    if (outcome.build_id) out.build_id = outcome.build_id;
    if (outcome.concept_id) { out.concept_updated = true; out.concept_id = outcome.concept_id; }
    out.bubbles = pacing.bubblesFor(out.reply || '', { serious: out.status !== 'answered' });

    // The answer arrives in small groups of words rather than as a wall. The pauses are
    // COMPREHENSION PACING, not theatre: they give a screen reader time to announce one piece
    // before the next arrives, which is the difference between following along and being talked
    // over. Paragraph breaks the writer intended are preserved.
    if (!closed && out.reply) {
      for (const chunk of answerChunks(out.reply)) {
        if (closed) break;
        send({ type: 'delta', text: chunk });
        await nap(22);
      }
    }

    recordConversation(req, out).catch(() => {});
    if (!closed) { send({ type: 'done', result: out }); }
  } catch (e) {
    console.error('chat stream error:', e && e.message);
    // Say so in the stream rather than leaving it hanging: silence is indistinguishable from a
    // frozen page, and a person waiting deserves to know it stopped.
    if (!closed) send({ type: 'error', message: 'Clay stopped partway through and did not finish. Nothing was fabricated.' });
  } finally {
    try { res.end(); } catch (_) {}
  }
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
    // The same path the API uses, so Clay deleting a project cancels its billing too. Two copies of
    // this is how one of them silently keeps charging people.
    const out = await deleteProject(req.user.id, params.concept_id);
    if (!out.ok && out.reason === 'cancel_failed') throw new ApiError(502, CANCEL_FAILED_MESSAGE);
    if (!out.ok) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
    return res.json({ status: 'done',
      message: out.cancelled
        ? 'Project deleted, and the subscription attached to it has been cancelled — you will not be charged again for it.'
        : 'Project deleted.' });
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
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
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
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
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
    '<hr/><p style="color:#57534e;font-size:13px;font-family:system-ui,sans-serif">The Dream Market is a neutral marketplace. Concepts are pre-proven starting points, not guarantees of income.</p></div>';
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
// A first note that reflects the person's ACTUAL idea back to them, so the very first thing
// they see shows Clay understood — not a generic "starting your build." Echoes their own words
// (trimmed), so it's honest and specific, never invented.
function buildOpener(prompt, verb){
  const p = String(prompt || '').replace(/\s+/g, ' ').trim();
  const gist = p.length > 90 ? p.slice(0, 88).trim() + '…' : p;
  return gist ? `${verb} — “${gist}”. Starting now.` : `${verb}. Starting now.`;
}
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

// The weekly creator proof prompt. GET returns this week's prompt (generating it on first view of
// the week), or null when the creator has no concept of their own to prove yet. The prompt is about
// the creator's OWN concept only — proofPrompt reads by owner_id, so it never crosses accounts.
router.get('/weekly-prompt', authenticate, asyncHandler(async (req, res) => {
  const prompt = await proofPrompt.currentPrompt(req.user.id);
  res.json({ prompt });
}));

// Mark this week's proof step done. Owner-scoped: only the creator can complete their own prompt.
router.post('/weekly-prompt/done', authenticate, asyncHandler(async (req, res) => {
  const id = req.body && req.body.id;
  if (!id) throw new ApiError(400, 'Which prompt? Include its id.');
  const ok = await proofPrompt.markDone(req.user.id, id);
  res.json({ ok });
}));


// DELETE /api/clay/history — a creator erasing their own conversations. Theirs to delete.
router.delete('/history', authenticate, asyncHandler(async (req, res) => {
  const out = await conversations.forgetMine(req.user.id);
  if (!out.ok) throw new ApiError(500, 'Could not clear your history just now. Nothing was deleted.');
  res.json({ ok: true, sessions_deleted: out.sessions_deleted,
    message: `Deleted ${out.sessions_deleted} conversation${out.sessions_deleted === 1 ? '' : 's'}. They are gone, not hidden.` });
}));

module.exports = router;
