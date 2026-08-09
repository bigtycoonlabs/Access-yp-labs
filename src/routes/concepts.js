const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const watchActivity = require('../services/clay/watchActivity');
const { CATEGORIES, MODES } = require('../services/clay/tools');
const { conceptEntitlement, paywall, isStaff, billingExempt, redactLockedAssets, ownerAssets } = require('../lib/entitlement');
const protect = require('../lib/protect');
const retrieval = require('../services/clay/retrieval');
const movement = require('../services/clay/movement');
const siteStore = require('../services/clay/siteStore');
const siteQuota = require('../services/clay/siteQuota');
const siteExport = require('../services/clay/siteExport');
const siteAccess = require('../services/clay/siteAccess');
const domains = require('../services/clay/domains');
const cloudflare = require('../services/clay/cloudflare');
const domainStore = require('../services/clay/domainStore');
const valuation = require('../services/clay/valuation');
const brief = require('../services/clay/brief');
const launchPage = require('../services/clay/launchPage');
const store = require('../services/clay/store');
const { deleteProject, CANCEL_FAILED_MESSAGE } = require('../lib/deleteProject');
const crypto = require('crypto');

// Every type generation can actually produce. This list had drifted behind the generator, so a
// creator could not add or replace several kinds of material that Clay routinely writes for them.
const ASSET_TYPES = ['business_plan', 'marketing_strategy', 'customer_research', 'competitor_research',
  'regulatory_risk', 'html_demo', 'example_image', 'website_prompt', 'build_instructions', 'code_file',
  'built_site', 'tech_spec', 'tech_requirements', 'money_flow', 'growth_plan', 'operations_staffing', 'presell_kit'];
const router = express.Router();

const STAGES = ['concept', 'in_build', 'prepared_to_start'];

router.post('/', authenticate, [
  body('title').trim().notEmpty(),
  body('mode').isIn(MODES),
  body('category').optional().isIn(CATEGORIES),
  body('is_housing').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { title, mode, category, is_housing, parent_id } = req.body;
  const r = await query(
    `INSERT INTO concepts (owner_id, title, mode, category, is_housing, parent_id)
     VALUES ($1,$2,$3,$4,COALESCE($5,false),$6) RETURNING *`,
    [req.user.id, title, mode, category || null, is_housing, parent_id || null]);
  res.status(201).json({ concept: r.rows[0] });
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  // Include an honest per-concept "kept" flag (can the owner download it?) so the
  // dashboard can show the money state at a glance. One query: staff and active
  // Sculptor cover everything; otherwise a Maker plan for that concept, or an
  // unexpired purchased first month.
  const staff = billingExempt(req.user);
  const r = await query(
    `SELECT c.*,
       ($2::boolean
        OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=c.owner_id AND s.plan='sculptor'
                     AND s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end>now()))
        OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=c.owner_id AND s.plan='maker'
                     AND s.status='active' AND s.concept_id=c.id
                     AND (s.current_period_end IS NULL OR s.current_period_end>now()))
        OR (c.origin='purchased' AND c.access_expires_at IS NOT NULL AND c.access_expires_at>now())
       ) AS entitled
     FROM concepts c WHERE c.owner_id=$1 AND c.expired_at IS NULL ORDER BY c.updated_at DESC`,
    [req.user.id, staff]);
  res.json({ concepts: r.rows });
}));

// Manual materials upload (self-serve listing path). Owner only. Code files are
// malware-scanned; a new asset of an existing type supersedes the prior version.
router.post('/:id/assets', authenticate, [
  body('type').isIn(ASSET_TYPES),
  body('body').isString().trim().notEmpty(),
  body('title').optional().isString(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const { type, title } = req.body;
  const assetBody = req.body.body;

  let scanStatus = 'not_required', scanDetail = null;
  if (protect.needsScan(type)) { const sc = protect.scanCode(assetBody); scanStatus = sc.status; scanDetail = sc.detail; }

  const prev = await query('SELECT COALESCE(MAX(version),0) AS maxv FROM assets WHERE concept_id=$1 AND type=$2', [req.params.id, type]);
  const nextVersion = prev.rows[0].maxv + 1;
  if (nextVersion > 1) {
    await query('UPDATE assets SET is_current=false WHERE concept_id=$1 AND type=$2 AND is_current=true', [req.params.id, type]);
  }
  const r = await query(
    `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, scan_detail, version, is_current)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id, type, title, scan_status, version`,
    [req.params.id, type, title || null, assetBody,
     ['business_plan', 'marketing_strategy'].includes(type), scanStatus, scanDetail, nextVersion]);
  const blocked = scanStatus === 'flagged';
  // If this project is live in the Dream Market, adding real material to it is news for anyone
  // watching — it is the seller raising what the listing is worth. Flagged material is NOT
  // announced: it isn't visible to anyone yet, so saying value was added would not be true.
  if (!blocked) {
    query("SELECT id FROM listings WHERE concept_id=$1 AND status='live'", [req.params.id])
      .then((ls) => ls.rows.forEach((l) => watchActivity
        .record(l.id, 'value_added', watchActivity.say.valueAdded(title || String(type).replace(/_/g, ' ')))
        .catch((e) => console.error('watch note failed:', e && e.message))))
      .catch((e) => console.error('watch note failed:', e && e.message));
  }
  res.status(201).json({
    asset: r.rows[0],
    scan: { status: scanStatus, detail: scanDetail },
    message: blocked
      ? 'Uploaded, but this file was flagged by the malware scan and will be blocked from listing/download until resolved.'
      : 'Uploaded.',
  });
}));

// GET /api/concepts/related?q=...&exclude=... — the user's OWN prior concepts most
// relevant to some text, for grounding a new build in real earlier work. Scoped to
// the caller's concepts only. Declared before the /:id routes so it isn't shadowed.
router.get('/related', authenticate, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 2000);
  const exclude = /^[0-9a-f-]{36}$/i.test(String(req.query.exclude || '')) ? req.query.exclude : null;
  const related = await retrieval.relatedConcepts(req.user.id, q, { limit: 3, excludeId: exclude });
  res.json({ related });
}));

// GET /api/concepts/unkept-summary — how many concepts the user has built but
// can't yet download (no active plan covers them). Powers a gentle, mutable
// reminder. Honest by construction: staff and Sculptor cover everything, so their
// count is 0 and they're never nudged. Declared before the /:id routes so the
// static path is never shadowed by the concept-id param.
router.get('/unkept-summary', authenticate, asyncHandler(async (req, res) => {
  const prefs = await query('SELECT reminders_muted FROM user_preferences WHERE user_id=$1', [req.user.id]);
  const muted = !!(prefs.rows[0] && prefs.rows[0].reminders_muted);
  if (billingExempt(req.user)) return res.json({ count: 0, sample: [], muted });
  const sculptor = await query(
    `SELECT 1 FROM subscriptions WHERE user_id=$1 AND plan='sculptor' AND status='active'
       AND (current_period_end IS NULL OR current_period_end > now()) LIMIT 1`, [req.user.id]);
  if (sculptor.rows.length) return res.json({ count: 0, sample: [], muted });
  const rows = await query(
    `SELECT c.id, c.title FROM concepts c
      WHERE c.owner_id=$1 AND c.expired_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s WHERE s.user_id=$1 AND s.plan='maker' AND s.status='active'
            AND s.concept_id=c.id AND (s.current_period_end IS NULL OR s.current_period_end > now()))
        AND NOT (c.origin='purchased' AND c.access_expires_at IS NOT NULL AND c.access_expires_at > now())
      ORDER BY c.created_at DESC`, [req.user.id]);
  res.json({ count: rows.rows.length, sample: rows.rows.slice(0, 3), muted });
}));

// GATED export: bundle of current assets for download. Building is free; pulling
// the materials out requires an active plan (or staff, or an included first month).
router.get('/:id/export', authenticate, asyncHandler(async (req, res) => {
  const ent = await conceptEntitlement(req.user, req.params.id);
  if (!ent.entitled) {
    if (ent.reason === 'not_found') throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
    if (ent.reason === 'not_owner') throw new ApiError(403, 'This is not your concept.');
    return res.status(402).json(paywall(req.params.id));
  }
  const a = await query(
    `SELECT id, type, title, body, file_url, scan_status FROM assets
     WHERE concept_id=$1 AND is_current=true ORDER BY created_at`, [req.params.id]);
  if (a.rows.some((x) => x.scan_status === 'flagged')) {
    return res.status(403).json({ error: 'blocked_by_scan',
      message: 'A file in this concept was flagged by the malware scan and cannot be exported.' });
  }
  res.json({ entitled_via: ent.reason, assets: a.rows });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const c = await query('SELECT * FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const ent = await conceptEntitlement(req.user, req.params.id);
  // A faded concept stays blocked ONLY for someone who hasn't kept it. An entitled owner can
  // always reach their own work — and opening it restores it (clears the faded flag), so
  // keeping a concept brings it back.
  if (c.rows[0].expired_at && !ent.entitled) {
    throw new ApiError(410, 'This concept has faded — it sat unopened past its window and was cleared. You can start a fresh one anytime.');
  }
  // Returning to a concept resets its expiry clock, clears any pending fade-reminder, and
  // un-hides it if it had faded (only reachable here when the owner is entitled).
  await query('UPDATE concepts SET last_opened_at=now(), expiry_reminded_at=NULL, expired_at=NULL WHERE id=$1', [req.params.id]);
  const a = await query('SELECT * FROM assets WHERE concept_id=$1 ORDER BY created_at', [req.params.id]);
  // This endpoint is already owner-only — the lookup above is WHERE id=$1 AND owner_id=$2 — so
  // everyone reaching this line is reading their own work, and reads all of it. Building is free and
  // unlimited, and that has to be true of what you can SEE while building, not only of how many
  // projects you are allowed to start.
  res.json({ concept: { ...c.rows[0], expired_at: null }, assets: ownerAssets(a.rows), entitled: !!ent.entitled });
}));

router.patch('/:id', authenticate, [
  body('title').optional().trim().notEmpty(),
  body('stage').optional().isIn(STAGES),
  body('category').optional().isIn(CATEGORIES),
  body('risk_summary').optional().isString(),
  body('working_since').optional({ nullable: true }).isISO8601(),
  body('show_working_since').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { title, stage, category, risk_summary, working_since, show_working_since } = req.body;
  const r = await query(
    `UPDATE concepts SET
       title=COALESCE($3,title), stage=COALESCE($4,stage),
       category=COALESCE($5,category), risk_summary=COALESCE($6,risk_summary),
       working_since=COALESCE($7,working_since),
       show_working_since=COALESCE($8,show_working_since),
       updated_at=NOW()
     WHERE id=$1 AND owner_id=$2 RETURNING *`,
    [req.params.id, req.user.id, title, stage, category, risk_summary,
     working_since || null, typeof show_working_since === 'boolean' ? show_working_since : null]);
  if (!r.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  res.json({ concept: r.rows[0] });
}));

// A completeness-based starting guide for what a concept is worth as a listing — the value drivers
// it carries, a suggested range, and what would raise it. Owner-scoped. Guidance, not an appraisal.
router.get('/:id/value', authenticate, asyncHandler(async (req, res) => {
  const c = await query(
    'SELECT id, research_grounded, claims_verified, movement_state FROM concepts WHERE id=$1 AND owner_id=$2',
    [req.params.id, req.user.id]);
  if (!c.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const a = await query('SELECT type, is_current, exclusive_locked FROM assets WHERE concept_id=$1', [req.params.id]);
  const w = await query('SELECT COUNT(*)::int AS n FROM waitlist_signups WHERE concept_id=$1', [req.params.id]);
  const val = valuation.assessValue({ concept: c.rows[0], assets: a.rows, waiting: w.rows[0].n });
  res.json({
    tier: val.tier, tier_label: val.tierLabel,
    range_usd: { low: Math.round(val.range.low_cents / 100), high: Math.round(val.range.high_cents / 100) },
    has: val.has, drivers: val.drivers, to_raise: val.toRaise, depth: val.depth,
  });
}));

// Generate (or refresh) the concept's opportunity brief — four scannable lines (the problem, who
// you'd serve, what you could make, why you), grounded in the concept's own material. Owner-scoped.
// Best-effort: runs the writer where it's available (production). Lets a creator populate an
// existing concept, not just new ones.
router.post('/:id/brief', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const b = await brief.ensureBriefFor(req.params.id);
  if (!b) {
    return res.json({ ok: false,
      message: 'Couldn’t write the brief just now — the writer isn’t available here, or there wasn’t enough to ground it. Try again in a moment.' });
  }
  res.json({ ok: true, brief: b });
}));

// Set the concept's coming-soon launch page: the copy (Clay and the creator write it together)
// and whether it's published. Publishing makes a public page at /p/<slug> whose email capture
// feeds the concept's waitlist as real proof of demand. Owner-scoped; reversible — publish:false
// unpublishes without losing the copy.
router.put('/:id/launch-page', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id, title, launch_page FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const cur = own.rows[0].launch_page || {};
  const copy = launchPage.parseConfig({ ...cur, ...(req.body || {}) });

  let enabled = !!cur.enabled;
  if (req.body && req.body.publish === true) enabled = true;
  if (req.body && req.body.publish === false) enabled = false;
  if (enabled && !copy.headline) throw new ApiError(400, 'Give the page a headline before publishing it.');

  // Sculptor website allowance: first-publishing a site that isn't already counted this month
  // counts against the monthly cap. Re-publishing an already-counted site is free.
  const alreadyCounted = siteQuota.countedThisMonth(cur);
  let publishedAt = cur.published_at || null;
  if (enabled && !alreadyCounted) {
    const q = await siteQuota.canPublishNewSite(req.user.id);
    if (!q.allowed) {
      throw new ApiError(402, `You've published ${q.limit} websites this month on your Sculptor plan. More websites are $2.99/month on top of Sculptor — add that to keep publishing, or publish the rest next month.`);
    }
    publishedAt = new Date().toISOString();
  }

  // A stable public slug, generated from the title the first time it's published, kept thereafter.
  let slug = cur.slug || null;
  if (enabled && !slug) {
    const base = launchPage.slugify(own.rows[0].title);
    slug = base;
    for (let i = 0; i < 6; i++) {
      const taken = await query("SELECT 1 FROM concepts WHERE launch_page->>'slug'=$1 AND id<>$2", [slug, req.params.id]);
      if (!taken.rows.length) break;
      slug = base + '-' + crypto.randomUUID().slice(0, 4);
    }
  }

  const page = { ...copy, enabled, slug: slug || null, published_at: publishedAt };
  await query('UPDATE concepts SET launch_page=$2::jsonb, updated_at=NOW() WHERE id=$1', [req.params.id, JSON.stringify(page)]);
  const site = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/$/, '');
  res.json({ ok: true, launch_page: page, url: page.slug ? `${site}/p/${page.slug}` : null });
}));

// ---- a concept's SITE pages: the owner's direct control, mirroring Clay's tools ----
// A concept's site is its launch page (the home) plus these pages. Live at /p/<site-slug>/<page-slug>
// once both the home and the page are published. All owner-scoped.
function siteBase() { return (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/$/, ''); }
async function pageUrl(conceptId, page) {
  if (!page || !page.published) return null;
  const c = await query("SELECT launch_page->>'slug' AS slug, (launch_page->>'enabled') AS enabled FROM concepts WHERE id=$1", [conceptId]);
  const slug = c.rows[0] && c.rows[0].slug;
  const homeLive = c.rows[0] && c.rows[0].enabled === 'true';
  return (slug && homeLive) ? `${siteBase()}/p/${slug}/${page.slug}` : null;
}

router.get('/:id/pages', authenticate, asyncHandler(async (req, res) => {
  if (!(await siteStore.ownsConcept(req.params.id, req.user.id))) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  res.json({ pages: await siteStore.listPages(req.params.id) });
}));

router.get('/:id/pages/:pageId', authenticate, asyncHandler(async (req, res) => {
  if (!(await siteStore.ownsConcept(req.params.id, req.user.id))) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const r = await query(
    'SELECT id, slug, title, body, kind, nav_order, published, updated_at FROM site_pages WHERE concept_id=$1 AND id=$2 LIMIT 1',
    [req.params.id, req.params.pageId]);
  if (!r.rows.length) throw new ApiError(404, 'Page not found.');
  res.json({ page: r.rows[0], url: await pageUrl(req.params.id, r.rows[0]) });
}));

// Export the whole site as one self-contained HTML file the owner can host anywhere — they own it.
router.get('/:id/site/export', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id, title, launch_page FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');

  // Taking the site file away is part of the plan, alongside going live and taking payments.
  // Building it and previewing it are free — this is the door out, not the workshop.
  const access = await siteAccess.siteAccess(req.user, req.user.id);
  if (!access.allowed) throw new ApiError(402, access.message);

  const pages = await query(
    'SELECT slug, title, body, kind, nav_order FROM site_pages WHERE concept_id=$1 ORDER BY nav_order, created_at',
    [req.params.id]);
  const products = await query(
    'SELECT id, name, price_cents, currency, description, image_url, kind, active FROM store_products WHERE concept_id=$1 AND active=true ORDER BY sort_order, created_at',
    [req.params.id]);
  const file = siteExport.buildSingleFile(own.rows[0], pages.rows, products.rows);
  res.json({ ok: true, filename: file.filename, html: file.html });
}));

// ---- web addresses (domains) for a concept's site ----
// A creator can get an instant free address on our platform (a subdomain) or connect their own
// domain via Cloudflare. All owner-scoped.
router.get('/:id/domains', authenticate, asyncHandler(async (req, res) => {
  if (!(await siteStore.ownsConcept(req.params.id, req.user.id))) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const lp = await query("SELECT launch_page->>'slug' AS slug, (launch_page->>'enabled') AS enabled FROM concepts WHERE id=$1", [req.params.id]);
  const published = !!(lp.rows[0] && lp.rows[0].enabled === 'true');
  const shareUrl = published && lp.rows[0].slug ? `${siteBase()}/p/${lp.rows[0].slug}` : null;
  res.json({
    domains: await domainStore.listForConcept(req.params.id),
    sites_root: domains.sitesRoot(),
    custom_available: cloudflare.configured(),
    cname_target: domains.cnameTarget(),
    addresses_live: domains.addressesLive(),
    published,
    share_url: shareUrl,
  });
}));

// Reserve an instant subdomain — <label>.accessyplabs.com. The name is claimed at once; whether
// the address actually resolves depends on web addresses being switched on. The /p/ link always works.
router.post('/:id/domains/subdomain', authenticate, asyncHandler(async (req, res) => {
  if (!(await siteStore.ownsConcept(req.params.id, req.user.id))) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const label = domains.normalizeLabel((req.body || {}).label);
  if (!domains.validLabel(label)) throw new ApiError(400, 'Pick a web address using letters, numbers, and hyphens — and not a reserved word.');
  const hostname = domains.subdomainHost(label);
  if (await domainStore.hostnameTaken(hostname)) throw new ApiError(409, 'That address is already taken — try another.');
  const d = await domainStore.addSubdomain(req.params.id, req.user.id, hostname);
  const lp = await query("SELECT launch_page->>'slug' AS slug, (launch_page->>'enabled') AS enabled FROM concepts WHERE id=$1", [req.params.id]);
  const published = !!(lp.rows[0] && lp.rows[0].enabled === 'true');
  const live = published && domains.addressesLive();
  const shareUrl = published && lp.rows[0].slug ? `${siteBase()}/p/${lp.rows[0].slug}` : null;
  const message = live
    ? `Your site is live at https://${hostname} — a real address you can share.`
    : `Reserved https://${hostname}. ` + (shareUrl ? `Share your site now at ${shareUrl}. ` : 'Publish your home page to get a shareable link. ') + 'This address goes live once web addresses are switched on.';
  res.status(201).json({ ok: true, domain: d, url: 'https://' + hostname, live, share_url: shareUrl, message });
}));

// Connect a creator's own domain via Cloudflare for SaaS.
router.post('/:id/domains/custom', authenticate, asyncHandler(async (req, res) => {
  if (!(await siteStore.ownsConcept(req.params.id, req.user.id))) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const hostname = domains.normalizeCustomHost((req.body || {}).hostname);
  if (!domains.validCustomHost(hostname)) throw new ApiError(400, 'Enter a domain like yourbusiness.com (no http, no path).');
  if (await domainStore.hostnameTaken(hostname)) throw new ApiError(409, 'That domain is already connected.');
  if (!cloudflare.configured()) {
    return res.status(503).json({ ok: false, configured: false, message: 'Connecting your own domain isn’t switched on yet — a free address on our platform works right now.' });
  }
  const cf = await cloudflare.createCustomHostname(hostname);
  if (!cf.ok) throw new ApiError(502, 'Could not start connecting that domain. Double-check it and try again.');
  const verification = { cname: { name: hostname, target: domains.cnameTarget() }, ownership: cf.ownership || null };
  const d = await domainStore.addCustom(req.params.id, req.user.id, hostname, cf.id, verification);
  res.status(201).json({ ok: true, domain: d, verification, message: 'Add the DNS record below at your domain registrar. Once it propagates and Cloudflare issues the certificate, your site goes live on your domain — usually within an hour.' });
}));

// Re-check a connected custom domain's status with Cloudflare; flip to active once valid.
router.get('/:id/domains/:domainId/recheck', authenticate, asyncHandler(async (req, res) => {
  const d = await domainStore.getForOwner(req.params.id, req.params.domainId, req.user.id);
  if (!d) throw new ApiError(404, 'Domain not found.');
  if (d.kind !== 'custom' || !d.cf_hostname_id) return res.json({ ok: true, status: d.status });
  const cf = await cloudflare.getCustomHostname(d.cf_hostname_id);
  if (!cf.configured) return res.json({ ok: true, status: d.status });
  const active = cf.status === 'active' && cf.ssl && cf.ssl.status === 'active';
  if (active && d.status !== 'active') await domainStore.setStatus(d.id, 'active');
  res.json({ ok: true, status: active ? 'active' : (cf.status || d.status), ssl: cf.ssl ? cf.ssl.status : null });
}));

router.delete('/:id/domains/:domainId', authenticate, asyncHandler(async (req, res) => {
  const removed = await domainStore.remove(req.params.id, req.params.domainId, req.user.id);
  if (!removed) throw new ApiError(404, 'Domain not found.');
  if (removed.kind === 'custom' && removed.cf_hostname_id && cloudflare.configured()) {
    try { await cloudflare.deleteCustomHostname(removed.cf_hostname_id); } catch (_) { /* best-effort */ }
  }
  res.json({ ok: true });
}));

router.post('/:id/pages', authenticate, asyncHandler(async (req, res) => {
  if (!(await siteStore.ownsConcept(req.params.id, req.user.id))) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) throw new ApiError(400, 'A page title is required.');
  const page = await siteStore.addPage(req.params.id, req.user.id, { title: b.title, body: b.body, kind: b.kind, publish: b.publish === true });
  res.status(201).json({ ok: true, page, url: await pageUrl(req.params.id, page) });
}));

router.put('/:id/pages/:pageId', authenticate, asyncHandler(async (req, res) => {
  if (!(await siteStore.ownsConcept(req.params.id, req.user.id))) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const b = req.body || {};
  const page = await siteStore.editPage(req.params.id, req.params.pageId, {
    title: b.title, body: b.body,
    publish: typeof b.publish === 'boolean' ? b.publish : undefined,
    nav_order: Number.isInteger(b.nav_order) ? b.nav_order : undefined,
  });
  if (!page) throw new ApiError(404, 'Page not found.');
  res.json({ ok: true, page, url: await pageUrl(req.params.id, page) });
}));
// path from idea to a business someone will pay for. Owner-scoped; validated against the fixed set.
router.put('/:id/movement', authenticate, asyncHandler(async (req, res) => {
  const state = req.body && req.body.movement_state;
  if (!movement.isLane(state)) throw new ApiError(400, 'That is not a valid lane.');
  const r = await query(
    `UPDATE concepts SET movement_state=$3, movement_updated_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND owner_id=$2 RETURNING id, movement_state, movement_updated_at`,
    [req.params.id, req.user.id, state]);
  if (!r.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  res.json({ concept: r.rows[0] });
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const out = await deleteProject(req.user.id, req.params.id);
  if (!out.ok && out.reason === 'cancel_failed') throw new ApiError(502, CANCEL_FAILED_MESSAGE);
  if (!out.ok) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  res.json({ ok: true, subscriptions_cancelled: out.cancelled,
    message: out.cancelled
      ? 'Project deleted, and the subscription attached to it has been cancelled — you will not be charged again for it.'
      : 'Project deleted.' });
}));

// ---- Manual store management — a creator builds their own catalog, with or without Clay ----
// Owner-only. Products are digital (delivered by a link after payment) or physical (a shipping
// address is collected at checkout). Prices are validated the same way Clay's tools validate them.
router.get('/:id/products', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const r = await query(
    'SELECT id, name, price_cents, currency, description, image_url, kind, fulfillment_url, active FROM store_products WHERE concept_id=$1 ORDER BY sort_order, created_at',
    [req.params.id]);
  res.json({ ok: true, products: r.rows.map((p) => ({
    id: p.id, name: p.name, price_cents: p.price_cents, currency: p.currency,
    price_display: store.formatPrice(p.price_cents, p.currency),
    description: p.description || '', image_url: p.image_url || '',
    kind: p.kind, fulfillment_url: p.fulfillment_url || '', active: p.active,
  })) });
}));

router.post('/:id/products', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const norm = store.normalizeProduct(req.body || {});
  if (!norm.ok) throw new ApiError(400, norm.error);
  const p = norm.product;
  const r = await query(
    `INSERT INTO store_products (concept_id, owner_id, name, price_cents, currency, description, image_url, kind, fulfillment_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [req.params.id, req.user.id, p.name, p.price_cents, p.currency, p.description, p.image_url, p.kind, p.fulfillment_url]);
  res.json({ ok: true, product_id: r.rows[0].id });
}));

router.patch('/:id/products/:productId', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT sp.id FROM store_products sp JOIN concepts c ON c.id=sp.concept_id WHERE sp.id=$1 AND sp.concept_id=$2 AND c.owner_id=$3', [req.params.productId, req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Product not found.');
  const b = req.body || {};
  const sets = []; const vals = [req.params.productId]; let n = 1;
  if (b.name !== undefined) { const nm = String(b.name || '').trim(); if (!nm) throw new ApiError(400, 'A product needs a name.'); sets.push('name=$' + (++n)); vals.push(nm.slice(0, 200)); }
  if (b.price !== undefined) { const cents = store.parsePriceToCents(b.price); if (cents == null) throw new ApiError(400, 'That price isn’t valid — give a number like 19.99.'); sets.push('price_cents=$' + (++n)); vals.push(cents); }
  if (b.currency !== undefined) { sets.push('currency=$' + (++n)); vals.push(store.normalizeCurrency(b.currency)); }
  if (b.description !== undefined) { sets.push('description=$' + (++n)); vals.push(b.description == null ? null : String(b.description).slice(0, 4000)); }
  if (b.image_url !== undefined) { sets.push('image_url=$' + (++n)); vals.push(store.cleanImageUrl(b.image_url)); }
  if (b.kind !== undefined) { sets.push('kind=$' + (++n)); vals.push(store.normalizeKind(b.kind)); }
  if (b.fulfillment_url !== undefined) { sets.push('fulfillment_url=$' + (++n)); vals.push(store.cleanImageUrl(b.fulfillment_url)); }
  if (b.active !== undefined) { sets.push('active=$' + (++n)); vals.push(!!b.active); }
  if (!sets.length) throw new ApiError(400, 'Nothing to change.');
  sets.push('updated_at=now()');
  await query('UPDATE store_products SET ' + sets.join(', ') + ' WHERE id=$1', vals);
  res.json({ ok: true });
}));

router.delete('/:id/products/:productId', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT sp.id FROM store_products sp JOIN concepts c ON c.id=sp.concept_id WHERE sp.id=$1 AND sp.concept_id=$2 AND c.owner_id=$3', [req.params.productId, req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'Product not found.');
  await query('DELETE FROM store_products WHERE id=$1', [req.params.productId]); // orders keep their own product_name
  res.json({ ok: true });
}));

// GET /:id/orders — the concept owner's storefront sales, newest first. Owner-only. The money is
// the creator's; this is just a truthful read of their own ledger (paid orders count toward totals;
// pending/failed are shown but never counted as revenue).
router.get('/:id/orders', authenticate, asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
  if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  const rows = (await query(
    `SELECT product_name, amount_cents, currency, status, buyer_email, created_at, paid_at
       FROM store_orders WHERE concept_id=$1 ORDER BY created_at DESC LIMIT 200`, [req.params.id])).rows;
  const s = store.summarizeOrders(rows);
  res.json({
    ok: true,
    summary: {
      paid_count: s.paid_count,
      paid_total_cents: s.paid_total_cents,
      paid_total_display: store.formatPrice(s.paid_total_cents, s.currency),
      currency: s.currency,
    },
    orders: rows.map((r) => ({
      product_name: r.product_name,
      amount_display: store.formatPrice(r.amount_cents, r.currency),
      status: r.status,
      buyer_email: r.buyer_email || null,
      created_at: r.created_at,
      paid_at: r.paid_at,
    })),
  });
}));

module.exports = router;
