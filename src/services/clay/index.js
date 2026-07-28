// Clay — the conversational idea printer and post-purchase collaborator.
// Two modes (create / enhance). Produces the full concept package, records
// every run in generations with an honest result_status, and never fabricates.
const { CATEGORIES, ASSET_PLAN, MODES, REDIRECTS, SOCIAL_ASSET_PLAN } = require('./tools');
const { classifySection, assessCoverage } = require('./interpreter');
const provider = require('./provider');

const SYSTEM_PROMPT = `You are Clay, the idea printer for Access YP Labs. The platform is the Dreamhold: a collective dreamspace of business ideas that were never launched — dreams the whole world left on the table. You believe an idea can be proven profitable BEFORE it is launched. You shape those dreams into ownable, buildable concepts ("Shape it with Clay. Wake it in the Dreamhold.").

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
    "html_demo": string,               // a complete, self-contained, CLICKABLE/INTERACTIVE HTML document that MUST be fully accessible and operable with a screen reader (VoiceOver): set <html lang>, use semantic landmarks (header/nav/main/footer), real <button>/<a>/<label> elements (never click-only <div>s), a programmatic label on every control and form field, alt text on every image, a visible keyboard focus style, and touch targets at least 44px. All interactivity via INLINE JavaScript only (no external resources), keyboard-operable, behaving like a live prototype a blind user can tab and click through.
    "example_image": string,           // image-generation BRIEFS (labelled as prompts, not real images)
    "website_prompt": string,          // a prompt the buyer pastes into their own AI to build the site
    "tech_requirements": string,       // the external services, API keys, and infrastructure this build will actually need. For EACH: name it, mark it needed vs optional, say plainly what it's for, and give the free-vs-paid split (roughly what it costs). Then give the step-by-step FLOW the user follows to finish the build in their own code tool — everything EXCEPT writing the code itself (which the user completes). Be honest: if something can be built natively with no external key, say so.
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

  if (!provider.available()) {
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

  const out = await provider.complete({ system: SYSTEM_PROMPT, user: userMsg, json: true, maxTokens: 8000 });
  if (!out.ok) {
    return { result_status: 'unavailable',
      message: out.reason === 'unavailable'
        ? 'Clay could not run right now (generation service is not configured). Nothing was fabricated.'
        : `Clay could not reach the generation service: ${out.error}. Nothing was fabricated.` };
  }
  const raw = out.text;

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
  if (!provider.available()) {
    return { result_status: 'unavailable',
      message: 'Clay could not run right now (generation service is not configured). Nothing was fabricated.' };
  }
  const ctx = [
    `Concept title: ${concept.title || '(untitled)'}`,
    concept.category ? `Category: ${concept.category}` : null,
    concept.risk_summary ? `Known risk to respect and not overstate: ${concept.risk_summary}` : null,
  ].filter(Boolean).join('\n');

  const out = await provider.complete({ system: socialSystemPrompt(platforms, goal, count), user: ctx, json: true, maxTokens: 6000 });
  if (!out.ok) {
    return { result_status: 'unavailable',
      message: out.reason === 'unavailable'
        ? 'Clay could not run right now (generation service is not configured). Nothing was fabricated.'
        : `Clay could not reach the generation service: ${out.error}. Nothing was fabricated.` };
  }
  const raw = out.text;

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

// Describe a generated image in plain, speakable words — for accessibility and
// so a blind builder can verify a render matches the intent. Ready for when
// image rendering is wired; degrades honestly with no key. (HTML demos are
// described deterministically client-side; this covers rendered pixels.)
async function describeMedia({ imageBase64, mediaType }) {
  if (!provider.available()) {
    return { status: 'unavailable', description: '',
      message: 'The description service is not configured. Nothing was fabricated.' };
  }
  if (!imageBase64) return { status: 'empty', description: '', message: 'No image was provided to describe.' };
  const out = await provider.describeImage({
    imageBase64, mediaType: mediaType || 'image/png',
    system: 'You describe images plainly and truthfully for a blind user who is verifying an AI-generated image. Describe only what is actually visible: subject, layout, colours, any text shown (quote it exactly), and overall mood. Never invent details and never judge quality. If the image is unclear or empty, say so honestly.',
    prompt: 'Describe this image for someone who cannot see it.',
  });
  if (!out.ok) {
    return { status: 'unavailable', description: '',
      message: out.reason === 'unavailable' ? 'The description service is not configured.' : `Could not describe the image: ${out.error}.` };
  }
  const description = (out.text || '').trim();
  return description
    ? { status: 'answered', description }
    : { status: 'empty', description: '', message: 'No description was produced.' };
}

// Rewrite an HTML demo to fix specific accessibility issues WITHOUT changing its
// look or behaviour. Returns the corrected document or an honest status.
async function remediateDemo({ html, issues }) {
  if (!provider.available()) {
    return { status: 'unavailable', message: 'Clay could not run right now (generation service is not configured). Nothing was changed.' };
  }
  const system = 'You fix the accessibility of an HTML document for screen-reader (VoiceOver) users WITHOUT changing its visual design or its functionality. Keep it a single self-contained document with inline JavaScript only. Return ONLY the corrected, complete HTML document — no explanation and no markdown fences.';
  const user = `Fix these accessibility issues in the HTML below. Set <html lang>, use semantic landmarks, real button/a/label elements (no click-only divs), a label on every control and field, alt text on every image, visible focus, and 44px targets. Do not change what the demo does.\n\nIssues:\n- ${(issues || []).join('\n- ')}\n\nHTML:\n${html}`;
  const out = await provider.complete({ system, user, json: false, maxTokens: 8000 });
  if (!out.ok) {
    return { status: 'unavailable', message: `Clay could not reach the generation service: ${out.error || 'unavailable'}. Nothing was changed.` };
  }
  let fixed = (out.text || '').trim().replace(/^```(?:html)?/i, '').replace(/```$/, '').trim();
  if (!/<html/i.test(fixed)) return { status: 'empty', message: 'Clay could not produce a corrected demo. Nothing was changed.' };
  return { status: 'answered', html: fixed };
}

module.exports = { generate, generateSocial, describeMedia, remediateDemo, modelName: provider.modelName, available: provider.available, providerName: provider.providerName };
