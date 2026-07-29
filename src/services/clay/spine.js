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
  generate_concept: {
    irreversible: false, requires_confirmation: false,
    required: ['prompt'],
    enums: { category: CATEGORIES },
    summary: 'Shape a new concept package with Clay. Free; nothing is published.',
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
