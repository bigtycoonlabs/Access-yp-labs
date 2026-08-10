// MAKING A SEEDED LISTING SOMETHING YOU CAN LOOK AT.
//
// A seeded project arrived as a stack of documents — a plan, research, a risk read. That is the
// substance, but it is not what makes somebody stop scrolling. Two listings at the same price, one
// with a page you can open and a prototype you can click, one with a PDF's worth of prose: the
// first is the one people look at, and it is also the more honest presentation, because it shows
// what the thing IS rather than describing it.
//
// So every seed now gets a landing page and, where it makes sense, a clickable demo.
//
// DELIBERATELY NO PAYMENT INTEGRATION. A seeded project is inventory we own and are selling AS a
// project. Wiring a storefront into it would mean the platform standing up shops that take money
// for businesses nobody is running — which is not what we sell and not something we could deliver
// against. The storefront belongs to a creator, on their own project, into their own Stripe
// account, and it stays that way. This builds the page and the demo and stops there.
//
// Everything here is best-effort: a seed that produced good materials must never fail because a
// landing page could not be written.

const { query } = require('../../config/db');
const provider = require('./provider');

// The six themes the launch page builder already supports. Chosen by category so the market does
// not look like one template repeated — a page that matches the kind of business it describes reads
// as made rather than generated.
const THEME_BY_CATEGORY = {
  digital_product_saas: 'clean',
  online_service_agency: 'professional',
  content_creator: 'bold',
  ecommerce_pod: 'warm',
  ai_product_service: 'technical',
  remote_hybrid_physical: 'grounded',
  micro_solo: 'warm',
};

// Does this project want a prototype? Something with screens benefits from one; a cleaning round or
// a market stall does not, and generating a fake app for it would misrepresent the business.
function wantsDemo(category, assetTypes) {
  if (assetTypes.includes('tech_spec') || assetTypes.includes('html_demo')) return true;
  return ['digital_product_saas', 'ai_product_service', 'content_creator'].includes(category);
}

// Write the landing page from what the project actually says, never from invention. If the
// materials do not contain a real line about who it is for, the page says less rather than making
// something up — the same rule Clay works under everywhere else.
async function buildLandingPage(concept) {
  const assets = await query(
    `SELECT type::text AS type, title, body FROM assets
      WHERE concept_id=$1 AND is_current ORDER BY created_at LIMIT 6`, [concept.id]);
  if (!assets.rows.length) return { ok: false, reason: 'no_materials' };

  const source = assets.rows
    .map((a) => `## ${a.title || a.type}\n${String(a.body || '').slice(0, 1800)}`)
    .join('\n\n');

  const system = `You write home pages for business projects listed in a marketplace of unbuilt
businesses. You write ONLY from the materials you are given and never invent a fact about a business.`;

  const user = `Below are a project's own materials. Write its home page using only what they say.

${source}

Return STRICT JSON, no markdown fence, with exactly these keys:
  "headline"  - under 60 characters. What this business IS, concretely. Not a slogan.
  "subhead"   - under 120 characters. Who it is for and what it does for them.
  "blurb"     - 40 to 90 words, plain prose, no bullet points, no hype. What somebody buying this
                would actually be getting. It is honest about this being a project rather than a
                running business.
  "cta"       - under 25 characters, the button label.

Rules that matter more than polish:
- Never state a revenue figure, a customer count, or a result unless the materials contain it.
- Never imply the business is already operating or already earning. It is not.
- No exclamation marks, no "revolutionary", no "game-changing".
- Write like somebody explaining it to a friend who asked what it is.`;

  // json:true asks the provider for structured output; the parse below still guards it, because a
  // request for JSON is not a guarantee of JSON.
  const out = await provider.complete({ system, user, json: true, maxTokens: 700 });
  if (!out || !out.ok || !out.text) return { ok: false, reason: (out && out.reason) || 'no_response' };

  let page;
  try {
    page = JSON.parse(String(out.text).replace(/```json|```/g, '').trim());
  } catch (_) {
    return { ok: false, reason: 'unparseable' };
  }
  if (!page.headline || !page.blurb) return { ok: false, reason: 'incomplete' };

  const theme = THEME_BY_CATEGORY[concept.category] || 'clean';
  const launch = {
    enabled: 'true',
    theme,
    headline: String(page.headline).slice(0, 120),
    subhead: String(page.subhead || '').slice(0, 200),
    blurb: String(page.blurb).slice(0, 1200),
    cta: String(page.cta || 'See the project').slice(0, 40),
    // Marked so it is obvious later that Clay wrote this rather than a person, and so staff editing
    // the listing know they are editing generated copy.
    generated_by: 'clay_seed',
  };

  await query('UPDATE concepts SET launch_page=$2, updated_at=now() WHERE id=$1',
    [concept.id, JSON.stringify(launch)]);
  return { ok: true, theme, headline: launch.headline };
}

// Attach a clickable prototype. build_demo already produces a real, tab-navigable, screen-reader
// usable HTML page — the point of reusing it rather than writing something new is that a demo a
// blind creator cannot operate is not a demo, and that work is already done.
async function buildDemo(concept) {
  const types = await query(
    `SELECT array_agg(DISTINCT type::text) AS types FROM assets WHERE concept_id=$1 AND is_current`,
    [concept.id]);
  const assetTypes = (types.rows[0] && types.rows[0].types) || [];
  if (assetTypes.includes('html_demo')) return { ok: true, already: true };
  if (!wantsDemo(concept.category, assetTypes)) return { ok: false, reason: 'not_suited' };

  const plan = await query(
    `SELECT body FROM assets WHERE concept_id=$1 AND is_current
      AND type IN ('business_plan','tech_spec') ORDER BY created_at LIMIT 1`, [concept.id]);
  if (!plan.rows.length) return { ok: false, reason: 'no_plan' };

  const demoSystem = `You build small, self-contained, fully accessible HTML prototypes. You never
include payment forms, checkout flows, or anything that looks purchasable.`;

  const demoUser = `Build a single self-contained HTML page that demonstrates what this product would
look like to its user. This is a PROTOTYPE for a marketplace listing, not a working product.

${String(plan.rows[0].body || '').slice(0, 4000)}

Requirements:
- One HTML file. Inline CSS. No external requests, no frameworks, no images from the web.
- Two or three screens the user would actually see, switched with plain buttons.
- Fully keyboard operable, every control reachable by tab, visible focus, real labels on inputs,
  semantic headings that do not skip levels. It must be usable with a screen reader.
- NO payment form, NO checkout, NO card fields, NO pricing that looks purchasable. This is a
  demonstration of the product, not a shop.
- Sample data must be obviously illustrative rather than pretending to be real activity.
- A short line at the top saying this is a prototype of an unbuilt business.

Return only the HTML.`;

  const out = await provider.complete({ system: demoSystem, user: demoUser, maxTokens: 4000 });
  if (!out || !out.ok || !out.text) return { ok: false, reason: (out && out.reason) || 'no_response' };
  const html = String(out.text).replace(/```html|```/g, '').trim();
  if (!/<html|<body|<main/i.test(html)) return { ok: false, reason: 'not_html' };

  // A last check rather than trusting the instruction: if a payment field got in anyway, the demo
  // is dropped. An instruction is a request; this is the guarantee.
  if (/type=["']?(card|cc-number)|stripe|checkout|card number|cvv/i.test(html)) {
    return { ok: false, reason: 'payment_ui_present' };
  }

  await query(
    `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, version, is_current)
     VALUES ($1,'html_demo','Clickable prototype',$2,false,'not_required',1,true)`,
    [concept.id, html]);
  return { ok: true, bytes: html.length };
}

// Called by the seeder after the materials are saved. Never throws into the seed run.
// The four lines a buyer actually reads on a listing: the problem, who they would serve, what they
// could make, and why them. Without it the listing's "opportunity at a glance" panel does not render
// AT ALL — it returns null and disappears — so somebody browsing sees a price, a risk note, and no
// explanation of what they would be buying. Twelve of thirteen live listings were in that state.
async function buildBrief(concept) {
  try {
    const { ensureBriefFor } = require('./brief');
    const out = await ensureBriefFor(concept.id);
    return out && out.ok !== false ? { ok: true } : { ok: false, reason: (out && out.reason) || 'no_brief' };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'threw' };
  }
}

async function enrich(concept) {
  const result = { landing_page: null, demo: null, brief: null };
  try { result.brief = await buildBrief(concept); }
  catch (e) { result.brief = { ok: false, reason: (e && e.message) || 'threw' }; }
  try { result.landing_page = await buildLandingPage(concept); }
  catch (e) { result.landing_page = { ok: false, reason: (e && e.message) || 'threw' }; }
  try { result.demo = await buildDemo(concept); }
  catch (e) { result.demo = { ok: false, reason: (e && e.message) || 'threw' }; }
  return result;
}

module.exports = { enrich, buildLandingPage, buildDemo, buildBrief, wantsDemo, THEME_BY_CATEGORY };
