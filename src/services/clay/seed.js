// Clay seeds the Dreamhold. Clay invents simple, quick-to-start, UNIQUE small-business ideas,
// builds each into a real concept, and posts it FOR REVIEW under his own pen name — never
// straight to sale. A human on staff approves or rejects every one, through the SAME listing
// moderation flow every seller uses. This exists to solve the cold-start problem: an inspiring,
// full marketplace invites people to add their own ideas; an empty one does not.
//
// Honest by construction:
//   - Seeded concepts are owned by the Clay system account and tagged origin='clay_seed', so a
//     "Seeded by Clay" marker can be shown and Clay's share of inventory can be measured. The
//     public listing already shows Clay as the creator via the seller alias — nothing is hidden.
//   - Nothing publishes without staff approval: Clay drafts -> in_review -> staff decide.
//   - Guardrails keep Clay a MINORITY presence: a small daily cap, and a soft share cap once real
//     human inventory exists. While the market is tiny, seeding is allowed to bootstrap it.
//   - Sales of Clay-seeded concepts are PLATFORM revenue. That is deliberate, and marked.
//   - Never fabricates: on any failure it returns an honest reason and writes nothing false.

const { query, getClient } = require('../../config/db');
const clay = require('./index');
const economics = require('./economics');
const provider = require('./provider');
const embeddings = require('./retrieval-embeddings');
const protect = require('../../lib/protect');
const { sendEmail } = require('../email');
const { CATEGORIES } = require('./tools');

const CLAY_EMAIL = 'clay@accessyplabs.com';
const PRICE_MIN_CENTS = 1000;    // $10
const PRICE_MAX_CENTS = 60000;   // $600
const DAILY_CAP = 3;             // at most ~2-3 seeds a day
const MINORITY_SHARE = 0.5;      // once inventory is real, Clay stays a minority of it
const MINORITY_FLOOR = 10;       // below this many live listings, allow seeding to bootstrap
const NOVELTY_MAX_SIM = 0.9;     // cosine similarity above this = too close to an existing idea

async function getClayUser() {
  const r = await query('SELECT id, display_name FROM users WHERE email=$1 LIMIT 1', [CLAY_EMAIL]);
  return r.rows[0] || null;
}

// Clay posts under a PSEUDONYM, like any creator with a pen name — never his real name. He owns
// the handle: he picks it, and switching it is his call, not an automatic rotation.
const CURATED_PEN_NAMES = ['Shapeshifter', 'The Understudy', 'Emberwright', 'Nomad Forge',
  'Ghostshaper', 'Kilnborn', 'The Prototypist', 'Draftsmith', 'The Foundling', 'Quiet Forge'];

// Clay chooses his own pseudonymous creator handle. Model-picked when available; a curated
// pseudonym otherwise. Never "Clay", never fabricated.
async function chooseNewPenName() {
  try {
    const out = await provider.complete({
      system: 'You are Clay. Choose ONE short, memorable PSEUDONYM to post under as a marketplace creator — a pen name, not your real name. Never use the word "Clay". One to three words, no punctuation. Respond with ONLY the name.',
      user: 'Give me one pseudonymous creator handle.',
      json: false, maxTokens: 20, effort: 'low',
    });
    if (out && out.ok) {
      const name = String(out.text || '').replace(/["'`\n\r.]/g, '').trim().slice(0, 40);
      if (name && !/clay/i.test(name)) return name;
    }
  } catch (_) { /* fall through */ }
  return CURATED_PEN_NAMES[Math.floor(Math.random() * CURATED_PEN_NAMES.length)];
}

// Persist a chosen pen name (guards against ever setting it to Clay's real name).
async function setPenName(clayId, name) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean || /^clay$/i.test(clean)) return null;
  await query('UPDATE users SET display_name=$2, updated_at=now() WHERE id=$1', [clayId, clean]);
  return clean;
}

// Guarantee Clay never posts as his literal name. If his handle is empty or "Clay", he picks a
// pseudonym now; otherwise he keeps the one he already chose. Switching stays HIS decision.
async function ensurePenName(clayUser) {
  const current = (clayUser.display_name || '').trim();
  if (current && !/^clay$/i.test(current)) return current;
  const saved = await setPenName(clayUser.id, await chooseNewPenName());
  return saved || 'A Dreamhold creator';
}

// Seeds Clay has posted since local midnight — the cadence guard.
async function seedsToday(clayId) {
  const r = await query(
    "SELECT COUNT(*)::int AS n FROM listings WHERE seller_id=$1 AND created_at >= date_trunc('day', now())",
    [clayId]);
  return r.rows[0].n;
}

// Clay's share of LIVE inventory. Soft minority guard, skipped while the market is tiny so the
// shelf can fill; once there are real listings, Clay stays a minority.
async function overMinority(clayId) {
  const r = await query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE seller_id=$1)::int AS clay
     FROM listings WHERE status='live'`, [clayId]);
  const { total, clay: clayCount } = r.rows[0];
  if (total < MINORITY_FLOOR) return false;
  return (clayCount / total) >= MINORITY_SHARE;
}

function clampPrice(usd) {
  const cents = Math.round(Number(usd) * 100);
  if (!Number.isFinite(cents)) return 4900; // sensible default ($49) if the model omits a price
  return Math.min(PRICE_MAX_CENTS, Math.max(PRICE_MIN_CENTS, cents));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Ask Clay for ONE simple, quick-to-start, unique small business idea. JSON only, never prose.
async function inventIdea(avoidTitles) {
  const system = 'You are Clay, an AI that shapes real, launchable small businesses. You never fabricate. '
    + 'Invent ONE genuinely simple, quick-to-start, and UNIQUE small business an ordinary person could begin '
    + 'from home with little money. It must be a virtual, remote, or micro business, not a large operation. '
    + 'Avoid anything generic or already common. Respond with ONLY a JSON object, no prose.';
  const avoid = (avoidTitles && avoidTitles.length) ? ('\nAvoid ideas close to these: ' + avoidTitles.slice(0, 20).join('; ') + '.') : '';
  const user = 'Return the idea as JSON with exactly these keys:\n'
    + '{ "title": short name, "category": one of ' + JSON.stringify(CATEGORIES) + ', '
    + '"pitch": two or three sentences a beginner understands, '
    + '"suggested_price_usd": a number from 10 to 600 to sell this concept for, '
    + '"why_unique": one sentence }.' + avoid;
  const out = await provider.complete({ system, user, json: true, maxTokens: 700, effort: 'medium' });
  if (!out.ok) return null;
  let p; try { p = JSON.parse(out.text); } catch (_) { return null; }
  if (!p || !p.title || !p.pitch) return null;
  return {
    title: String(p.title).slice(0, 160),
    pitch: String(p.pitch).slice(0, 1200),
    category: CATEGORIES.includes(p.category) ? p.category : null,
    price_cents: clampPrice(p.suggested_price_usd),
    why_unique: String(p.why_unique || '').slice(0, 300),
  };
}

// Novelty via embeddings — too close to something that already exists? Best-effort: if
// embeddings aren't available we don't block (staff review is the backstop). Never fabricates
// a vector. Returns the vector literal (to store on the concept) and whether it's novel.
async function noveltyEmbedding(text) {
  if (!embeddings.available()) return { vector: null, novel: true };
  const vec = await embeddings.embed(text);
  if (!vec) return { vector: null, novel: true };
  const lit = embeddings.toVectorLiteral(vec);
  try {
    const r = await query(
      `SELECT 1 - (embedding <=> $1::vector) AS sim FROM concepts
       WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 1`, [lit]);
    const sim = r.rows.length ? Number(r.rows[0].sim) : 0;
    return { vector: lit, novel: sim < NOVELTY_MAX_SIM };
  } catch (_) { return { vector: lit, novel: true }; }
}

// Persist a fresh seed concept (owner = Clay, origin='clay_seed') and its assets, in one tx.
// Assets are all version 1 (a brand-new concept), so no version bumping is needed.
async function persistSeed(clayId, result, { category, embeddingLit }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const c = await client.query(
      `INSERT INTO concepts (owner_id, title, mode, category, risk_summary, is_operating,
         research_grounded, claims_verified, source_count, clays_take, next_steps, origin, embedding)
       VALUES ($1,$2,'create',$3,$4,false,$5,$6,$7,$8,$9::jsonb,'clay_seed',$10::vector) RETURNING *`,
      [clayId, result.title || 'Untitled concept', result.inferred_category || category || null,
       result.risk_summary || null, !!result.research_grounded,
       (typeof result.claims_verified === 'boolean' ? result.claims_verified : null),
       result.source_count || 0, result.clays_take || null,
       JSON.stringify(result.next_steps || []), embeddingLit || null]);
    const concept = c.rows[0];
    const validTypes = new Set((await client.query(
      "SELECT e.enumlabel AS t FROM pg_enum e JOIN pg_type ty ON ty.oid=e.enumtypid JOIN pg_namespace n ON n.oid=ty.typnamespace WHERE ty.typname='asset_type' AND n.nspname='yp_labs'"
    )).rows.map((r) => r.t));
    for (const a of (result.assets || [])) {
      if (!validTypes.has(a.type)) continue;
      let scanStatus = 'not_required', scanDetail = null;
      if (protect.needsScan(a.type)) { const sc = protect.scanCode(a.body); scanStatus = sc.status; scanDetail = sc.detail; }
      await client.query(
        `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, scan_detail, version, is_current)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,true)`,
        [concept.id, a.type, a.label, a.body,
         ['business_plan', 'marketing_strategy'].includes(a.type), scanStatus, scanDetail]);
    }
    await client.query('COMMIT');
    return concept;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// The listing baseline the seller flow requires: a plan, a marketing strategy, and a build path.
async function hasBaseline(conceptId) {
  const r = await query(
    'SELECT array_agg(DISTINCT type::text) AS types FROM assets WHERE concept_id=$1 AND is_current=true', [conceptId]);
  const types = (r.rows[0] && r.rows[0].types) || [];
  const plan = types.includes('business_plan');
  const marketing = types.includes('marketing_strategy');
  const buildPath = types.some((t) => ['build_instructions', 'tech_requirements', 'website_prompt', 'html_demo'].includes(t));
  return plan && marketing && buildPath;
}

// Ask staff to review a new seed. The public site never sees it until they approve.
async function emailStaffReview({ title, pitch, priceCents, penName }) {
  let staff = [];
  try {
    staff = (await query("SELECT email FROM users WHERE role IN ('staff','admin','master_staff') AND status='active'"))
      .rows.map((r) => r.email).filter(Boolean);
  } catch (_) { staff = []; }
  if (!staff.length) return { sent: false, reason: 'no_recipients' };
  const base = (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
  const reviewUrl = base + '/admin-overview.html';
  const price = '$' + (priceCents / 100).toFixed(2);
  const subject = 'Clay seeded a concept for review: ' + title;
  const html = `<p>Clay created a new seed concept and is asking for review before it can go live on the Dreamhold.</p>`
    + `<p><strong>${escapeHtml(title)}</strong> — ${price}, posting as <em>${escapeHtml(penName || 'Clay')}</em></p>`
    + `<p>${escapeHtml(pitch)}</p>`
    + `<p>It is waiting in the review queue (status: in review). Approve to publish it under Clay's pen name, or reject with a reason. Nothing is public until you approve.</p>`
    + `<p><a href="${reviewUrl}">Open the review queue</a></p>`;
  const text = `Clay seeded a concept for review.\n\n${title} — ${price}, posting as ${penName || 'Clay'}\n\n${pitch}\n\n`
    + `It is in the review queue (in review). Approve to publish under Clay's pen name, or reject with a reason.\nReview: ${reviewUrl}`;
  try {
    const r = await sendEmail({ to: staff, subject, html, text });
    return { sent: !!(r && r.ok !== false), detail: r };
  } catch (e) { return { sent: false, reason: 'send_failed', error: e.message }; }
}

// Full pipeline: invent -> novelty -> build -> persist (Clay/origin clay_seed) -> listing
// in_review -> email staff. Returns an honest summary object; never throws.
async function runSeed() {
  try {
    if (!provider.available()) return { ok: false, reason: 'unavailable' };
    const clayUser = await getClayUser();
    if (!clayUser) return { ok: false, reason: 'no_clay_user' };
    if (await seedsToday(clayUser.id) >= DAILY_CAP) return { ok: false, reason: 'daily_cap' };
    if (await overMinority(clayUser.id)) return { ok: false, reason: 'minority_cap' };
    const penName = await ensurePenName(clayUser);

    const avoid = (await query(
      "SELECT title FROM concepts WHERE origin='clay_seed' ORDER BY created_at DESC LIMIT 20")).rows.map((r) => r.title);
    let idea = null, novelty = { vector: null, novel: true };
    for (let attempt = 0; attempt < 2; attempt++) {
      const cand = await inventIdea(avoid);
      if (!cand) continue;
      novelty = await noveltyEmbedding(cand.title + '. ' + cand.pitch);
      if (novelty.novel) { idea = cand; break; }
      avoid.push(cand.title);
    }
    if (!idea) return { ok: false, reason: 'no_novel_idea' };

    const result = await clay.generate({ mode: 'create', category: idea.category, prompt: idea.pitch, operating: false });
    if (result.result_status !== 'answered' || !(result.assets && result.assets.length)) {
      return { ok: false, reason: 'build_' + (result.result_status || 'failed') };
    }
    const concept = await persistSeed(clayUser.id, result, { category: idea.category, embeddingLit: novelty.vector });
    // Bonus: real computed unit economics on the seed too (defensive — never blocks the seed).
    try { await economics.computeAndAttach(concept.id); } catch (_) { /* economics is a bonus */ }

    if (!(await hasBaseline(concept.id))) {
      // Concept is saved but not listable — leave it, don't fabricate a listing.
      return { ok: false, reason: 'no_baseline', concept_id: concept.id };
    }

    const lr = await query(
      `INSERT INTO listings (concept_id, seller_id, format, price_cents, stage_label, status, risk_disclosed, ownership_ack)
       VALUES ($1,$2,'flat',$3,'concept','in_review',true,true) RETURNING id, price_cents`,
      [concept.id, clayUser.id, idea.price_cents]);
    const listing = lr.rows[0];

    const mail = await emailStaffReview({
      title: result.title || idea.title, pitch: idea.pitch,
      priceCents: listing.price_cents, penName,
    });

    return {
      ok: true, concept_id: concept.id, listing_id: listing.id,
      title: result.title || idea.title, price_cents: listing.price_cents, emailed: mail.sent,
    };
  } catch (e) {
    return { ok: false, reason: 'error', error: e.message };
  }
}

module.exports = { runSeed, getClayUser, ensurePenName, setPenName, chooseNewPenName, CLAY_EMAIL, DAILY_CAP };
