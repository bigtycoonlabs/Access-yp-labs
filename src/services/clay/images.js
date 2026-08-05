// Make ONE real image for a concept — budget-aware and honest. Clay writes both the image prompt
// and a speakable ALT TEXT (so every image is accessible to a blind user). Nothing is fabricated:
// if the image key isn't configured (or the OpenAI org isn't verified) the seam reports 'unavailable'
// and no image, charge, or budget spend happens. An image is only saved if it was actually rendered
// AND a budget slot (free this month, then a purchased pack credit) was successfully consumed.

const { query } = require('../../config/db');
const image = require('../image');       // provider-agnostic render seam (dormant until configured)
const storage = require('../storage');   // object storage for image bytes (optional)
const provider = require('./provider');  // for the prompt + alt text
const budget = require('./imageBudget');

// Clay composes a concrete image prompt and a one-sentence description for a blind reader. JSON only.
async function describeVisual(concept, kind) {
  if (!provider.available()) return null;
  const out = await provider.complete({
    system: 'You are Clay, designing ONE visual for a business concept. You never fabricate. Return ONLY a JSON object.',
    user: 'Concept: ' + (concept.title || 'Untitled') + ' (' + (concept.category || 'general') + ').\n'
      + 'Visual to make: ' + kind + '.\n'
      + 'Return JSON: { "prompt": a vivid, specific image-generation prompt (avoid words/text inside the image unless essential), '
      + '"alt": one clear sentence describing the finished image for someone who cannot see it }.',
    json: true, maxTokens: 300, effort: 'low',
  });
  if (!out || !out.ok) return null;
  try {
    const p = JSON.parse(out.text);
    if (p && p.prompt && p.alt) return { prompt: String(p.prompt).slice(0, 1500), alt: String(p.alt).slice(0, 500) };
  } catch (_) { /* fall through */ }
  return null;
}

// Generate one image if the budget allows. Returns a plain result; never throws.
async function generateOne(concept, opts = {}) {
  const { kind = 'logo', source = 'auto' } = opts;
  const ownerId = opts.ownerId || concept.owner_id;
  if (!image.configured()) return { ok: false, reason: 'unavailable' };

  const pre = await budget.budgetFor(concept.id, ownerId);
  if (!pre.can_generate) return { ok: false, reason: 'no_budget', budget: pre };

  const brief = await describeVisual(concept, kind);
  if (!brief) return { ok: false, reason: 'no_brief' };

  const rendered = await image.renderImage({ prompt: brief.prompt });
  if (rendered.status !== 'answered') return { ok: false, reason: rendered.status || 'unavailable', message: rendered.message };

  // Turn the render into something we can store + display. Prefer OUR object storage so the image is
  // PERMANENT — provider URLs (OpenAI, Together, fal, and friends) are often temporary and would
  // break a saved hero. So when storage is on, get the bytes (from the base64 the provider gave, or
  // by fetching its URL once) and upload them; only fall back to the provider URL, then an inline
  // data URL, if storage is off or the upload fails. An image always comes back either way.
  let src = null;
  let storageRef = null;
  if (storage.configured()) {
    let base64 = rendered.image_base64 || null;
    let mediaType = rendered.media_type || 'image/png';
    if (!base64 && rendered.url) {
      try {
        const resp = await fetch(rendered.url);
        if (resp.ok) {
          base64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
          mediaType = resp.headers.get('content-type') || mediaType;
        }
      } catch (_) { /* fall back to the provider URL below */ }
    }
    if (base64) {
      const up = await storage.uploadImage({ base64, mediaType, key: storage.keyFor(concept.id, mediaType) });
      if (up.ok) { src = up.url; storageRef = up.key; }
    }
  }
  if (!src) {
    src = rendered.url
      || (rendered.image_base64 ? 'data:' + (rendered.media_type || 'image/png') + ';base64,' + rendered.image_base64 : null);
    storageRef = rendered.url || null;
  }
  if (!src) return { ok: false, reason: 'empty' };

  // Consume a budget slot (free first, then a purchased credit — atomic). If nothing's left at this
  // instant, don't save: we'd rather waste one render than store an unpaid image.
  const spent = await budget.consumeOne(concept.id, ownerId, { source, altText: brief.alt, storageRef });
  if (!spent.ok) return { ok: false, reason: 'no_budget', budget: pre };

  // Store as an example_image asset: the alt text is the title (so the vault reads it out), the
  // image source (URL or data URL) is the body.
  const ins = await query(
    `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, version, is_current)
     VALUES ($1,'example_image',$2,$3,false,'not_required',1,true) RETURNING id`,
    [concept.id, brief.alt, src]);

  // If this is a hero and we have a real hosted URL (object storage on), put it on the site's home.
  // An explicit place_as_hero (the creator asked) replaces the current hero; an auto/first-build hero
  // only fills an empty slot so it never clobbers the creator's own choice. Data-URL images can't be
  // a web hero (the hero field only accepts http(s)), so those stay as a vault asset.
  const httpsUrl = /^https?:\/\//i.test(src) ? src : null;
  const wantHero = opts.placeAsHero === true || /hero/i.test(kind);
  let placedAsHero = false;
  if (wantHero && httpsUrl) {
    const sql = opts.placeAsHero === true
      ? "UPDATE concepts SET launch_page = jsonb_set(COALESCE(launch_page,'{}'::jsonb), '{hero_image}', to_jsonb($2::text)), updated_at=NOW() WHERE id=$1 RETURNING id"
      : "UPDATE concepts SET launch_page = jsonb_set(COALESCE(launch_page,'{}'::jsonb), '{hero_image}', to_jsonb($2::text)), updated_at=NOW() WHERE id=$1 AND COALESCE(launch_page->>'hero_image','')='' RETURNING id";
    const upd = await query(sql, [concept.id, httpsUrl]);
    placedAsHero = upd.rows.length > 0;
  }

  const after = await budget.budgetFor(concept.id, ownerId);
  return { ok: true, asset_id: ins.rows[0].id, alt: brief.alt, billed: spent.billed, budget: after,
    src, is_url: !!httpsUrl, placed_as_hero: placedAsHero };
}

module.exports = { generateOne, describeVisual };
