// Clay — the conversational idea printer and post-purchase collaborator.
// Two modes (create / enhance). Produces the full concept package, records
// every run in generations with an honest result_status, and never fabricates.
const { CATEGORIES, ASSET_PLAN, MODES, REDIRECTS, SOCIAL_ASSET_PLAN } = require('./tools');
const { classifySection, assessCoverage } = require('./interpreter');

const MODEL = process.env.CLAY_MODEL || 'claude-sonnet-4-5';

// Lazy-load the SDK so the server still boots without it installed.
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch (_) { /* optional */ }

function client() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const SYSTEM_PROMPT = `You are Clay, the idea printer for Access YP Labs — a neutral marketplace and launchpad for pre-proven, remote/digital/micro businesses ("Shape it with Clay. Fire it in The Kiln.").

Non-negotiable honesty rules (you inherited these from Arbo):
- Reason, don't recite. Never present a guess as a fact.
- Never fabricate data, traction, revenue, or research you did not actually derive. If something is directional or illustrative, label it exactly that.
- If you cannot produce a section, say so plainly and leave it empty rather than inventing filler.
- Regulatory, licensing, and legal risk must always be surfaced and clearly labelled as risk, never buried.

Scope guardrails:
- You only help with businesses that can run virtually / digitally / remotely / as a micro or solo operation. If the idea is inherently location-bound, either reframe it into a remote/hybrid model or set redirect="out_of_category".
- If the user is describing a business they are ALREADY running, set redirect="running_business" (this platform sells pre-proven concepts, not live operations).
- If a category was not provided and you cannot confidently infer one, set redirect="needs_category".
- If an "enhance" request has drifted into a fundamentally different business, set redirect="scope_drift".

You must respond with a SINGLE valid JSON object and nothing else, matching:
{
  "redirect": null | "needs_category" | "running_business" | "scope_drift" | "out_of_category",
  "redirect_reason": string,           // plain-language explanation if redirect is set, else ""
  "inferred_category": one of ${JSON.stringify(CATEGORIES)} | null,
  "title": string,
  "risk_summary": string,              // labelled regulatory/licensing risk, "" if none identified
  "sections": {
    "business_plan": string,
    "marketing_strategy": string,
    "customer_research": string,
    "competitor_research": string,
    "regulatory_risk": string,
    "html_demo": string,               // a complete, self-contained, accessible HTML document
    "example_image": string,           // image-generation BRIEFS (labelled as prompts, not real images)
    "website_prompt": string,          // a prompt the buyer pastes into their own AI to build the site
    "build_instructions": string       // step-by-step build incl. Supabase/Railway/GitHub guidance
  }
}
Do not wrap the JSON in markdown fences.`;

function parseModelJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; }
}

/**
 * Run a Clay generation. Returns a normalized result the caller persists.
 * Never throws for "the model couldn't help" — that becomes an honest status.
 */
async function generate({ mode, category, prompt }) {
  if (!MODES.includes(mode)) mode = 'create';
  if (!category && !prompt) {
    return { result_status: 'refused', redirect: REDIRECTS.NEEDS_CATEGORY,
      message: 'I need a bit more to work with — what kind of business are you imagining?' };
  }

  const anthropic = client();
  if (!anthropic) {
    // Honest degradation: we could not run, so we say exactly that.
    return { result_status: 'unavailable',
      message: 'Clay could not run right now (generation service is not configured). Nothing was fabricated.' };
  }

  const userMsg = [
    `Mode: ${mode}`,
    category ? `Category: ${category}` : 'Category: (not provided — infer or set redirect="needs_category")',
    '',
    prompt || '(no prompt provided)',
  ].join('\n');

  let raw;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    });
    raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  } catch (err) {
    return { result_status: 'unavailable',
      message: `Clay could not reach the generation service: ${err.message}. Nothing was fabricated.` };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    return { result_status: 'empty',
      message: 'Clay ran but did not return a usable package. Nothing was saved.' };
  }

  if (parsed.redirect) {
    return { result_status: 'refused', redirect: parsed.redirect,
      message: parsed.redirect_reason || 'Clay redirected this request.',
      inferred_category: parsed.inferred_category || null };
  }

  const sections = parsed.sections || {};
  const coverage = assessCoverage(sections);
  const assets = ASSET_PLAN
    .map((a) => ({ type: a.type, label: a.label, body: sections[a.type] || '',
                   status: classifySection(sections[a.type]) }))
    .filter((a) => a.status === 'answered');

  return {
    result_status: assets.length ? 'answered' : 'empty',
    title: parsed.title || 'Untitled concept',
    inferred_category: parsed.inferred_category || category || null,
    risk_summary: parsed.risk_summary || '',
    assets,
    coverage,
    message: assets.length
      ? `Clay assembled your concept. ${coverage.gap_description}`
      : 'Clay ran but produced no usable sections. Nothing was saved.',
  };
}

// ---- Social content generation (native, text-based) ----
// Clay writes post copy, image-generation PROMPTS (not rendered photos),
// short-form video SCRIPTS/storyboards (not rendered video), reusable
// templates, and a posting calendar. Same honesty engine as the concept path.
function socialSystemPrompt(platforms, goal, count) {
  return `You are Clay, generating SOCIAL MEDIA CONTENT for a concept on Access YP Labs.

Honesty rules (inherited from Arbo):
- Never invent engagement numbers, follower counts, testimonials, or results. Any example figure must be labelled clearly as illustrative.
- "image_prompt" content is PROMPTS to generate a photo/image, not real photographs. "video_script" content is scripts plus a simple shot list / storyboard, not rendered video. State this plainly.
- Keep every claim truthful to what the concept actually is. Surface no guarantee of income or reach.

Task: produce ready-to-use social content for goal="${goal}" across these platforms: ${platforms.join(', ')}. Provide about ${count} posts total, apportioned sensibly across the platforms, each labelled with its platform and written to that platform's norms (length, tone, hashtags where they fit).

Respond with a SINGLE valid JSON object and nothing else (no markdown fences):
{
  "sections": {
    "social_post": string,        // the posts, each labelled by platform, caption + hashtags
    "image_prompt": string,       // prompts to generate photos/images (labelled as prompts)
    "video_script": string,       // short-form video scripts with a simple shot list / storyboard
    "social_template": string,    // 2-3 reusable post templates with {placeholders}
    "content_calendar": string    // a simple 2-4 week posting schedule in plain text
  }
}`;
}

async function generateSocial({ concept, platforms, goal, count }) {
  const anthropic = client();
  if (!anthropic) {
    return { result_status: 'unavailable',
      message: 'Clay could not run right now (generation service is not configured). Nothing was fabricated.' };
  }
  const ctx = [
    `Concept title: ${concept.title || '(untitled)'}`,
    concept.category ? `Category: ${concept.category}` : null,
    concept.risk_summary ? `Known risk to respect and not overstate: ${concept.risk_summary}` : null,
  ].filter(Boolean).join('\n');

  let raw;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 6000,
      system: socialSystemPrompt(platforms, goal, count),
      messages: [{ role: 'user', content: ctx }],
    });
    raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  } catch (err) {
    return { result_status: 'unavailable',
      message: `Clay could not reach the generation service: ${err.message}. Nothing was fabricated.` };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    return { result_status: 'empty', message: 'Clay ran but did not return usable social content. Nothing was saved.' };
  }
  const sections = parsed.sections || {};
  const coverage = assessCoverage(sections);
  const assets = SOCIAL_ASSET_PLAN
    .map((a) => ({ type: a.type, label: a.label, body: sections[a.type] || '', status: classifySection(sections[a.type]) }))
    .filter((a) => a.status === 'answered');

  return {
    result_status: assets.length ? 'answered' : 'empty',
    assets, coverage,
    message: assets.length
      ? `Clay generated social content. ${coverage.gap_description}`
      : 'Clay ran but produced no usable social content. Nothing was saved.',
  };
}

module.exports = { generate, generateSocial, MODEL };
