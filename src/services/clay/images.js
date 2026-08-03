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

  // Turn the render into something we can store + display. Prefer object storage (keeps the DB
  // lean); fall back to an inline data URL if storage isn't configured or the upload fails, so
  // images always work either way.
  let src = rendered.url || null;
  let storageRef = rendered.url || null;
  if (!src && rendered.image_base64) {
    if (storage.configured()) {
      const up = await storage.uploadImage({
        base64: rendered.image_base64,
        mediaType: rendered.media_type || 'image/png',
        key: storage.keyFor(concept.id, rendered.media_type),
      });
      if (up.ok) { src = up.url; storageRef = up.key; }
    }
    if (!src) src = 'data:' + (rendered.media_type || 'image/png') + ';base64,' + rendered.image_base64;
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

  const after = await budget.budgetFor(concept.id, ownerId);
  return { ok: true, asset_id: ins.rows[0].id, alt: brief.alt, billed: spent.billed, budget: after };
}

module.exports = { generateOne, describeVisual };
