// Enterprise orchestration — the planner half.
//
// A single business is one generation call. A whole ENTERPRISE — a parent company that owns
// several ventures — is not: stuffing an entire holding company into one call is exactly what
// timed out before (a ~3m41s run that honestly gave up rather than fabricate). So an enterprise
// build is decomposed the way a person would do it: PLAN the pieces first with one small, fast
// call, then BUILD each venture as its own normal-sized concept, then ASSEMBLE the parent
// overview. This file owns the PLAN step and the pure prompt/validation helpers; the runner that
// executes the plan (building each child, assembling the parent) lives in routes/clay.js next to
// the build primitives it reuses.
//
// Everything here is pure or provider-injected, so it is unit-testable without a network or a DB.

const providerDefault = require('./provider');
const { CATEGORIES } = require('./tools');

// Hard bounds so a runaway request can't spawn a hundred builds, and so "build me an empire"
// resolves to a real, finite plan. If the request implies more, the planner keeps the strongest
// ventures and says so in the thesis.
const MAX_CHILDREN = 12;
const MIN_CHILDREN = 1;

const PLAN_SYSTEM =
  'You are Clay, planning a multi-venture ENTERPRISE for a builder on Access YP Labs. ' +
  'You do NOT write the businesses in this step. You only PLAN: name the parent enterprise, ' +
  'state its thesis in one short paragraph, and list the child ventures the enterprise should own.\n' +
  'Rules:\n' +
  '- Reply with ONLY a JSON object. No prose, no markdown, no code fences.\n' +
  '- Shape: {"title": string, "thesis": string, "children": [{"title": string, "brief": string, "category": string}]}\n' +
  '- category MUST be one of: ' + CATEGORIES.join(', ') + '. Pick the closest fit for each venture.\n' +
  '- brief: one or two sentences, concrete enough that this single venture could be built on its own.\n' +
  '- Between ' + MIN_CHILDREN + ' and ' + MAX_CHILDREN + ' children. If the request implies more, choose the ' +
  MAX_CHILDREN + ' strongest and note in the thesis that more can follow.\n' +
  '- Ground every venture in what the builder actually asked for. Invent nothing outside their intent. ' +
  'If the request is really a single business, return exactly one child.\n' +
  '- This is a plan, not a claim: never fabricate brands, partners, or numbers.';

// Build the user message for the plan call: the request plus a bounded slice of any attached
// source material (kept small — this is planning, not the full build).
function buildPlanUser(prompt, sources = []) {
  let u = "THE BUILDER'S ENTERPRISE REQUEST:\n" + String(prompt || '').trim() + '\n';
  const list = Array.isArray(sources) ? sources : [];
  if (list.length) {
    u += '\nSOURCE MATERIALS THE BUILDER ATTACHED (grounding — use, never contradict):\n';
    let budget = 12000; // total chars of source context for planning
    for (const s of list) {
      if (budget <= 0) break;
      const body = String((s && s.text) || '').slice(0, Math.min(6000, budget));
      budget -= body.length;
      u += '\n--- ' + String((s && s.filename) || 'attachment') + ' ---\n' + body + '\n';
    }
  }
  u += '\nReturn the enterprise plan as JSON now.';
  return u;
}

// Normalize whatever the model returned into a safe, bounded plan. Pure. Returns
// { ok:true, plan } or { ok:false, reason }. Drops empty/duplicate ventures, caps the count,
// and leaves an unrecognized category as null so the per-venture build can infer it — never
// guesses a category into the controlled vocabulary.
function validatePlan(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'no_plan' };
  const title = String(raw.title || '').trim();
  if (!title) return { ok: false, reason: 'no_title' };
  const thesis = String(raw.thesis || '').trim();
  const children = Array.isArray(raw.children) ? raw.children : [];
  const seen = new Set();
  const cleaned = [];
  for (const c of children) {
    if (!c || typeof c !== 'object') continue;
    const t = String(c.title || '').trim();
    const brief = String(c.brief || '').trim();
    if (!t || !brief) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let cat = String(c.category || '').trim();
    if (!CATEGORIES.includes(cat)) cat = null;
    cleaned.push({ title: t.slice(0, 120), brief: brief.slice(0, 600), category: cat });
    if (cleaned.length >= MAX_CHILDREN) break;
  }
  if (cleaned.length < 1) return { ok: false, reason: 'no_children' };
  return { ok: true, plan: { title: title.slice(0, 160), thesis: thesis.slice(0, 2000), children: cleaned } };
}

// The PLAN step. One small, fast, JSON-only model call — bounded output, so it returns in
// seconds and can never time out the way a full multi-business pass did. Honest on failure:
// if the builder isn't connected, or the model returns nothing usable, it says so and invents
// nothing. Provider is injectable for tests.
async function planEnterprise({ prompt, sources = [], provider = providerDefault } = {}) {
  if (!provider || !provider.available()) return { ok: false, reason: 'unavailable' };
  let out;
  try {
    out = await provider.complete({
      system: PLAN_SYSTEM,
      user: buildPlanUser(prompt, sources),
      json: true,
      maxTokens: 2500,
      effort: 'medium',
    });
  } catch (e) {
    return { ok: false, reason: 'error: ' + ((e && e.message) || 'unknown') };
  }
  if (!out || !out.ok) return { ok: false, reason: (out && out.reason) || 'unavailable' };
  const raw = parseLooseJson(out.text);
  if (!raw) return { ok: false, reason: 'unparseable' };
  return validatePlan(raw);
}

// Tolerate a clean JSON object, or one wrapped in stray prose / code fences, without ever
// executing anything — just find the outermost object and parse it.
function parseLooseJson(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
}

// Prompt to build ONE child venture as its own complete, standalone concept — real on its own,
// while fitting under the enterprise umbrella.
function childBuildPrompt(child, enterpriseTitle, thesis) {
  let p = 'This venture is one business inside a larger enterprise called "' + enterpriseTitle + '".';
  if (thesis) p += ' The enterprise\'s thesis: ' + thesis;
  p += '\n\nBuild THIS venture as a complete, standalone business concept:\n';
  p += 'Name: ' + child.title + '\n';
  p += 'What it is: ' + child.brief + '\n';
  p += '\nMake it real and self-contained — it should stand on its own as a business a person could ' +
       'launch, while fitting naturally under the ' + enterpriseTitle + ' umbrella.';
  return p;
}

// Prompt to assemble the PARENT overview once the ventures exist — the holding-company view a
// buyer or operator of the WHOLE enterprise would read. Deliberately not a re-description of each
// venture: the whole that is greater than the parts.
function assemblePrompt(enterpriseTitle, thesis, builtChildren = []) {
  const list = builtChildren.map((c, i) => (i + 1) + '. ' + c.title + ' — ' + (c.brief || '')).join('\n');
  let p = 'Build the HOLDING-COMPANY overview for an enterprise called "' + enterpriseTitle + '".';
  if (thesis) p += ' Thesis: ' + thesis;
  p += '\n\nIt owns these ' + builtChildren.length + ' ventures, already built as full concepts:\n' + list + '\n\n';
  p += 'Write the parent enterprise concept: how these ventures fit together, the shared ' +
       'infrastructure, team, and systems that serve all of them, the leverage of owning them under ' +
       'one roof, the sequence to launch them, and the combined economics and risks. Focus on the ' +
       'whole, not on re-describing each venture in full. This is what a buyer or operator of the ' +
       'entire enterprise would read.';
  return p;
}

module.exports = {
  planEnterprise, validatePlan, buildPlanUser, parseLooseJson,
  childBuildPrompt, assemblePrompt,
  PLAN_SYSTEM, MAX_CHILDREN, MIN_CHILDREN,
};
