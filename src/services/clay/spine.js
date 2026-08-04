// Clay's decision spine — modeled on Arbo (Access YP Flow).
//
// Arbo's spine is: reason (don't recite) + typed tools with enum guardrails +
// result interpretation + coverage/gap description + a hard ASKING RULE for
// irreversible, under-specified actions. This module is the reusable core of
// that spine so Clay makes the same kind of judgments Arbo does.
//
// The guiding principle (from a blind founder): a confident wrong answer is
// worse than an honest "I need to check / confirm first." So anything that
// spends money, publishes publicly, or destroys data is gated behind explicit
// human confirmation, and any under-specified irreversible action must ask.

const { CATEGORIES, PLATFORMS, SOCIAL_GOALS, MARKETPLACE_FORMATS } = require('./tools');
const { classifySection, assessCoverage, STATUSES } = require('./interpreter');

// Typed tool registry. Each tool declares its required params, the enum
// guardrails on those params, whether it is irreversible, and whether it needs
// explicit human confirmation before Clay may act.
const TOOLS = {
  list_my_concepts: {
    irreversible: false, requires_confirmation: false, required: [], enums: {},
    summary: 'List the concepts the current user owns (read-only).',
  },
  get_concept: {
    irreversible: false, requires_confirmation: false, required: ['concept_id'], enums: {},
    summary: 'Read one of the user\'s concepts and which materials it has (read-only).',
  },
  search_marketplace: {
    irreversible: false, requires_confirmation: false, required: [], optional: ['query'], enums: { category: CATEGORIES },
    summary: 'Search live marketplace listings by keyword and/or category (read-only).',
  },
  get_listing: {
    irreversible: false, requires_confirmation: false, required: ['listing_id'], enums: {},
    summary: 'Read a live listing\'s details, including an accessible demo description (read-only).',
  },
  research: {
    irreversible: false, requires_confirmation: false, required: ['query'], enums: {},
    summary: 'Research a topic on the live web (market size, competitors, demand, pricing, regulation) and return sources to cite. Read-only.',
  },
  notify_staff: {
    irreversible: false, requires_confirmation: false, required: ['subject', 'body'], enums: {},
    summary: "Send a short note by email to the Access YP Labs team (the owners and staff). Use it for YOUR OWN genuine observation as Clay — a real concern about the platform, an idea to improve it, or something they should know — never to relay a user's request or complaint (those go through normal support), and never for anything a user could use it to spam the team with. Every note is logged and there is a daily limit, so use it sparingly and make it clear and worth their attention.",
  },
  read_source: {
    irreversible: false, requires_confirmation: false, required: ['url'], enums: {},
    summary: 'Read one source URL in depth (fuller text) to verify a specific claim before citing it. Read-only.',
  },
  check_systems: {
    irreversible: false, requires_confirmation: false, required: [], enums: {},
    summary: 'Staff only: honestly report whether Clay\'s brain, web research, email sending, and Stripe payments are actually connected right now. Read-only. Use when a staff member asks if the systems / email / payments are working.',
  },
  define_term: {
    irreversible: false, requires_confirmation: false,
    required: ['term'], enums: {},
    summary: "Look up the plain-English definition of a BUSINESS term (customer acquisition cost, P&L, EBITDA, margin, runway, MRR, churn, LTV, cap table, and dozens more) from Clay's own curated glossary. Call it whenever the builder asks what a term means, or uses one they may not know, so the definition is consistent and correct. If it returns nothing, the term isn't carried: explain it yourself in plain words as general knowledge, not as an authoritative Clay definition.",
  },
  worked_example: {
    irreversible: false, requires_confirmation: false,
    required: ['topic'], optional: ['concept_id'],
    enums: { topic: ['margin', 'pricing_to_target', 'break_even', 'cac_ltv', 'runway', 'market_size'] },
    summary: "Give the builder a concrete, spoken, step-by-step WORKED EXAMPLE of a core money concept — margin (what you keep per sale), pricing_to_target (what to charge to hit an income goal), break_even (sales until you stop losing money), cac_ltv (cost to get a customer vs what they're worth), runway (how long the money lasts), or market_size (how big the opportunity honestly is). Call it when a beginner is stuck on an abstraction or asks how something actually works. Optionally pass concept_id to anchor the example to their concept by name. The numbers it returns are round and ILLUSTRATIVE — a device to show the math, never a claim about their real business — and the example says so; keep it that way.",
  },
  generate_concept: {
    irreversible: false, requires_confirmation: false,
    required: ['prompt'],
    enums: { category: CATEGORIES },
    summary: 'Shape a full concept package with Clay. Only call this once you actually understand the idea — never on a raw one-liner you have not pressure-tested with a sharpening question or two first, unless the person clearly says to just build it. Free; nothing is published.',
  },
  enhance_concept: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'prompt'],
    enums: {},
    summary: 'Refine an existing concept. Free; supersedes prior versions as history.',
  },
  generate_social_content: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'], optional: ['count'],
    enums: { platforms: PLATFORMS, goal: SOCIAL_GOALS },
    summary: 'Generate posts, image prompts, video scripts, templates, and a calendar. Free.',
  },
  list_on_marketplace: {
    irreversible: true, requires_confirmation: true,
    required: ['concept_id', 'format', 'price'],
    enums: { format: MARKETPLACE_FORMATS },
    summary: 'Publish a public listing and take on the seller-fee obligation.',
  },
  purchase_concept: {
    irreversible: true, requires_confirmation: true,
    required: ['listing_id'],
    enums: {},
    summary: 'Buy a concept. Spends real money and transfers ownership.',
  },
  remove_concept: {
    irreversible: true, requires_confirmation: true,
    required: ['concept_id'],
    enums: {},
    summary: 'Permanently delete a concept and all of its materials.',
  },
  remember: {
    irreversible: false, requires_confirmation: false,
    required: ['key', 'value'], optional: ['sensitivity'],
    enums: { sensitivity: ['normal', 'private'] },
    summary: 'Remember a durable fact about THIS builder across sessions — a real goal, constraint, or preference worth carrying forward. key is a short label, value is the fact. Mark sensitivity "private" for anything personal (never shown to staff). Never store secrets, passwords, or payment data. Tell the builder what you saved.',
  },
  forget: {
    irreversible: false, requires_confirmation: false,
    required: ['key'], enums: {},
    summary: "Forget one remembered fact by its key, at the builder's request.",
  },
  clear_memory: {
    irreversible: true, requires_confirmation: true,
    required: [], enums: {},
    summary: "Erase EVERYTHING you remember about this builder. Irreversible — needs their explicit confirmation.",
  },
  set_concept_path: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'path'], optional: ['note'],
    enums: { path: ['build_myself', 'refine_to_sell', 'exploring'] },
    summary: "Record the creator's plan for THIS concept when they tell you: build_myself (launch it as a real business they run), refine_to_sell (polish it to sell in the Dream Market), or exploring (undecided). note is an optional short line about their specific goal. Reversible — you can update it whenever their plan changes. Only set it from what the creator actually says; never guess it for them.",
  },
  value_breakdown: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'], enums: {},
    summary: "Break down what THIS concept is honestly worth as a listing, and why — based on how launch-ready it is. Returns the value drivers it already carries (a business plan, a marketing strategy, a working build a buyer could actually launch, real proof of demand), a suggested starting price range, and the specific things that would raise its value. Use it when a creator asks what to charge, what their concept is worth, or how to make it worth more. The range is a COMPLETENESS-based starting guide, never a market appraisal or a promise — say so plainly: the creator sets the price and the marketplace decides.",
  },
  set_movement_state: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'state'], optional: ['note'],
    enums: { state: ['needs_customer_clarity', 'needs_proof', 'ready_to_package'] },
    summary: "Place THIS concept on its honest movement lane from your proof read: needs_customer_clarity (no clear customer yet), needs_proof (a clear customer but nothing yet proves they'll pay), or ready_to_package (a clear customer AND real evidence they'll pay). note is a short line, in your own words, on WHY — it's shown to the creator on their board. Set it only from real behavior, never to flatter: ready_to_package needs evidence a stranger actually acted (a booked paid call, a preorder, a deposit, a converting landing page), not a strong plan. Reversible; update it as the truth changes.",
  },
  set_launch_page: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'],
    optional: ['headline', 'subhead', 'blurb', 'cta_label', 'publish'],
    enums: {},
    summary: "Write or update THIS concept's coming-soon launch page — headline, subhead, blurb, and button label — and optionally publish it. Publishing puts up a real public page at /p/<slug> whose email signups feed the concept's waitlist as genuine proof of demand: the creator's first customer list. This is how someone launching an idea themselves starts proving it. Draft the copy WITH the creator in your own words, tight and honest, and only set publish=true once they've seen it and said go. Reversible — publish=false takes it down without losing the copy. Tell them the exact public link after you publish.",
  },
};

function getTool(name) { return TOOLS[name] || null; }

// Enum guardrails + required-param check. Values outside a tool's declared enum
// are rejected before any action is taken (Arbo's guardrail pattern).
function validateParams(name, params = {}) {
  const tool = getTool(name);
  if (!tool) return { ok: false, errors: [`Unknown tool: ${name}`] };
  const errors = [];
  for (const key of tool.required) {
    const v = params[key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
      errors.push(`Missing required parameter: ${key}`);
    }
  }
  for (const [key, allowed] of Object.entries(tool.enums || {})) {
    if (params[key] === undefined || params[key] === null) continue;
    const vals = Array.isArray(params[key]) ? params[key] : [params[key]];
    for (const v of vals) {
      if (!allowed.includes(v)) errors.push(`Invalid ${key}: "${v}" (allowed: ${allowed.join(', ')})`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function missingRequired(name, params = {}) {
  const tool = getTool(name);
  if (!tool) return [];
  return tool.required.filter((k) => {
    const v = params[k];
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  });
}

function requiresConfirmation(name) {
  const tool = getTool(name);
  return !!(tool && tool.requires_confirmation);
}

// The asking rule (Arbo): an irreversible action must ASK/CONFIRM before it
// runs, and an irreversible action that is also under-specified must always
// ask. Reversible, free actions proceed once their params validate.
function shouldAsk(name, params = {}) {
  const tool = getTool(name);
  if (!tool) return { ask: true, reason: `Unknown tool "${name}" — Clay will not act on it.` };
  const missing = missingRequired(name, params);
  if (tool.irreversible && missing.length) {
    return { ask: true, reason: `This action is irreversible and is missing: ${missing.join(', ')}. Clay must confirm the details first.` };
  }
  if (tool.requires_confirmation) {
    return { ask: true, reason: `${tool.summary} Clay will confirm with you before doing this.` };
  }
  return { ask: false, reason: '' };
}

module.exports = {
  TOOLS, getTool, validateParams, missingRequired, requiresConfirmation, shouldAsk,
  // re-exported so the spine is a single import point
  classifySection, assessCoverage, STATUSES,
};
