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
    summary: 'List the projects the current user owns (read-only).',
  },
  get_concept: {
    irreversible: false, requires_confirmation: false, required: ['concept_id'], enums: {},
    summary: 'Read one of the user\'s projects and which materials it has (read-only).',
  },
  search_marketplace: {
    irreversible: false, requires_confirmation: false, required: [], optional: ['query'], enums: { category: CATEGORIES },
    summary: 'Search live marketplace listings by keyword and/or category (read-only).',
  },
  set_dreamer_tag: {
    irreversible: false, requires_confirmation: true,
    required: ['tag'], enums: {},
    summary: "Set the person's DREAMER TAG — the public name they are known by across Access YP Labs: on their listings, on the launch partner board, and on their Dream Mover page. Their real name stays private. It is like a gamer tag. They are asked to confirm before it changes, because changing it changes how people recognise them everywhere going forward.",
  },
  get_dreamer_tag: {
    irreversible: false, requires_confirmation: false,
    required: [], enums: {},
    summary: "Check whether this person has a dreamer tag yet, and what it is. Use this before suggesting they pick one, so you never nag someone who already has one.",
  },
  find_similar_listings: {
    irreversible: false, requires_confirmation: false,
    required: ['idea'], enums: {},
    summary: "BEFORE building a brand-new idea from scratch, check the Dream Market for a listing already selling something very similar. Pass the creator's idea as plain text. Read-only. If it returns strong:true, STOP building and offer to help them BUY that listing and enhance it into what they want, instead of starting from zero.",
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
    summary: "Give the builder a concrete, spoken, step-by-step WORKED EXAMPLE of a core money project — margin (what you keep per sale), pricing_to_target (what to charge to hit an income goal), break_even (sales until you stop losing money), cac_ltv (cost to get a customer vs what they're worth), runway (how long the money lasts), or market_size (how big the opportunity honestly is). Call it when a beginner is stuck on an abstraction or asks how something actually works. Optionally pass concept_id to anchor the example to their project by name. The numbers it returns are round and ILLUSTRATIVE — a device to show the math, never a claim about their real business — and the example says so; keep it that way.",
  },
  build_spec_package: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'],
    optional: ['focus'],
    enums: {},
    summary: "Write a complete BUILD SPEC PACKAGE for a project — the hand-off document someone takes to a developer or to an AI builder (Claude Code, Cursor, Lovable, Replit) to get the actual software built. This is what Clay does INSTEAD of building applications: the screens and what each one does, the data model, the user flows end to end, the business rules, the external services and keys needed with honest costs, what counts as done, and a paste-ready opening prompt. Call it when someone needs a real APPLICATION rather than a website — accounts, dashboards, custom logic, a database — or asks what it would take to build their idea for real. Free to generate; taking the file away is part of the plan. Pass focus to aim it at one area (for example 'booking flow') when the whole thing is too broad.",
  },
  generate_concept: {
    irreversible: false, requires_confirmation: true,
    required: ['prompt'],
    enums: { category: CATEGORIES },
    summary: 'Shape a full project package with Clay. Only call this once you actually understand the idea — never on a raw one-liner you have not pressure-tested with a sharpening question or two first, unless the person clearly says to just build it. The person is ALWAYS asked to approve before the build starts, so calling this is a PROPOSAL, not the act itself — say what you understood and what you are about to build, and let them say go. Free; nothing is published.',
  },
  build_enterprise: {
    irreversible: false, requires_confirmation: true,
    required: ['prompt'],
    enums: {},
    summary: 'Build a whole ENTERPRISE — a parent company that owns several child ventures — when the builder describes MORE THAN ONE business at once (e.g. "a holding company over a dozen stores", "a studio with several brands", "these three businesses under one umbrella"). Clay plans the ventures first (fast), tells the builder the plan, then builds each venture as its own full project and assembles a parent overview that ties them together. Each piece is its own project the builder can keep, list to sell on its own, or sell as the whole enterprise. Runs in the background; the builder can watch. Requires confirmation because it is a large, many-venture build. Use generate_concept for a single business — only reach for this when the request is genuinely multi-venture.',
  },
  enhance_concept: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'prompt'],
    enums: {},
    summary: 'Refine an existing project. Free; supersedes prior versions as history.',
  },
  build_demo: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'],
    enums: {},
    summary: "Build a real, clickable, interactive HTML DEMO of THIS project — a working prototype the creator can actually tab and click through, fully screen-reader operable. Clay does NOT put a demo in the standard package anymore; the standard build is the foundation. OFFER a demo AFTER the foundation is built, and pick the right kind: if the idea is an APPLICATION or app-like product, use build_demo (an interactive prototype); if it's simpler and a real website is the better proof, DON'T use this — build an actual published site instead with set_launch_page and add_site_page. Runs in the background; the creator can watch. Free.",
  },
  add_product: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'name', 'price'],
    optional: ['description', 'image_url', 'currency', 'kind', 'fulfillment_url'],
    enums: { kind: ['digital', 'physical'] },
    summary: "Add a real product to THIS project's STORE, turning its site into an e-commerce storefront. name is the product name; price is a plain number like 19.99. kind is 'digital' (delivered by a link after payment — pass fulfillment_url, a full https link) or 'physical' (a shipping address is collected at checkout); default digital. Optional description, image_url (full https URL), currency (usd default). The products render as a real Shop on the project's site. Build the catalog WITH the creator, product by product, with honest prices. Reversible.",
  },
  list_products: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'], enums: {},
    summary: "List the products in THIS project's store, each with its price and whether it's active (shown) or hidden. Check this before adding or editing products so you know what's already there.",
  },
  list_sales: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'], enums: {},
    summary: "Read THIS project's storefront sales — how many have sold, the total taken (which goes to the creator's OWN account; the platform takes nothing), and the most recent orders. Use it whenever the creator asks how their store or sales are doing. Report only what it returns; never invent a number.",
  },
  edit_product: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'product_id'],
    optional: ['name', 'price', 'description', 'image_url', 'active', 'kind', 'fulfillment_url'],
    enums: { kind: ['digital', 'physical'] },
    summary: "Edit a product in THIS project's store — change its name, price, description, image, kind (digital or physical), fulfillment_url (digital delivery link), or set active true to show it or false to hide it. Fully reversible.",
  },
  store_payments: {
    irreversible: false, requires_confirmation: false,
    required: [], enums: {},
    summary: "Check and set up PAYMENTS so the creator's store can take real money. Access YP Labs uses Stripe Connect: this checks whether the creator already has a connected account (the SAME one they'd use to sell in the Dream Market or earn as a Dream Mover) and whether it can accept charges yet. If they aren't set up, it returns a secure Stripe onboarding link they finish themselves — Stripe collects their details directly and you NEVER touch a key or credential. Offer this when a creator wants their store to actually sell. Relay exactly what the result says — payments READY, PENDING verification, or NOT STARTED — and never claim payments are live unless the result says READY.",
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
    summary: 'Buy a project. Spends real money and transfers ownership.',
  },
  remove_concept: {
    irreversible: true, requires_confirmation: true,
    required: ['concept_id'],
    enums: {},
    summary: 'Permanently delete a project and all of its materials.',
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
    summary: "Record the creator's plan for THIS project when they tell you: build_myself (launch it as a real business they run), refine_to_sell (polish it to sell in the Dream Market), or exploring (undecided). note is an optional short line about their specific goal. Reversible — you can update it whenever their plan changes. Only set it from what the creator actually says; never guess it for them.",
  },
  value_breakdown: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'], enums: {},
    summary: "Break down what THIS project is honestly worth as a listing, and why — based on how launch-ready it is. Returns the value drivers it already carries (a business plan, a marketing strategy, a working build a buyer could actually launch, real proof of demand), a suggested starting price range, and the specific things that would raise its value. Use it when a creator asks what to charge, what their project is worth, or how to make it worth more. The range is a COMPLETENESS-based starting guide, never a market appraisal or a promise — say so plainly: the creator sets the price and the marketplace decides.",
  },
  set_movement_state: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'state'], optional: ['note'],
    enums: { state: ['needs_customer_clarity', 'needs_proof', 'ready_to_package'] },
    summary: "Place THIS project on its honest movement lane from your proof read: needs_customer_clarity (no clear customer yet), needs_proof (a clear customer but nothing yet proves they'll pay), or ready_to_package (a clear customer AND real evidence they'll pay). note is a short line, in your own words, on WHY — it's shown to the creator on their board. Set it only from real behavior, never to flatter: ready_to_package needs evidence a stranger actually acted (a booked paid call, a preorder, a deposit, a converting landing page), not a strong plan. Reversible; update it as the truth changes.",
  },
  set_launch_page: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'],
    optional: ['headline', 'subhead', 'blurb', 'cta_label', 'theme', 'hero_image', 'publish'],
    enums: { theme: ['warm', 'ink', 'clean', 'bold', 'forest', 'dusk'] },
    summary: "Write or update THIS project's site home page — headline, subhead, blurb, button label — and its LOOK: theme (warm, ink, clean, bold, forest, or dusk) and hero_image (a full https image URL shown large at the top). Optionally publish. Publishing puts up a real public page at /p/<slug> whose email signups feed the project's waitlist as genuine proof of demand: the creator's first customer list. Draft the copy WITH the creator in your own words, pick a theme that fits the idea's feeling, and only publish once they've seen it and said go. Reversible — publish=false takes it down without losing anything. Tell them the exact public link after you publish. This same page is the HOME of the project's site — add more pages with add_site_page to turn it into a real, stunning starting MVP.",
  },
  list_site_pages: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'], optional: [], enums: {},
    summary: "List the pages of THIS project's site — every page built so far, with its title, whether it's published, and its order. Check this before adding or editing pages so you know what already exists.",
  },
  add_site_page: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'title'], optional: ['body', 'kind', 'publish'],
    enums: { kind: ['page', 'post'] },
    summary: "Add a real page to THIS project's site. This is how you build an actual starting MVP — a resource site or a blog with genuine pages — not just a coming-soon page. title is the page's name. body is the FULL content you write for it: real, useful, article-quality writing, never a placeholder. Simple Markdown is supported and rendered — # and ## headings, - bullet lists, and [text](url) links — so structure it well. kind is 'page' for a standing page (About, Resources) or 'post' for a dated article/blog post. The page becomes public at /p/<site-slug>/<page-slug> once BOTH the site's home (its landing page) is published and this page's publish=true. Set publish only when the creator has seen it and said go. Build the site out page by page, with the creator.",
  },
  edit_site_page: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'page_slug'], optional: ['title', 'body', 'publish'],
    enums: {},
    summary: "Edit an existing site page, found by its slug (or id). Change its title or body, or publish/unpublish it — publish=false hides it again without losing the content. Fully reversible.",
  },
  claim_web_address: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id', 'label'], optional: [], enums: {},
    summary: "Reserve THIS project's short free web address on our platform: <label>.accessyplabs.com. label is a short word or two the creator chooses — letters, numbers, hyphens. The name is claimed at once, but the address only resolves once web addresses are switched on for the platform; the site's always-on shareable link is its /p/ address (once the home page is published). Relay exactly what the tool result says about whether it's live or just reserved — never claim it's live on your own. For a creator's OWN domain (like theirbusiness.com) don't use this — point them to the 'Web address' section in their Laboratory.",
  },

  make_image: {
    irreversible: false, requires_confirmation: false,
    required: ['concept_id'], optional: ['kind', 'place_as_hero'], enums: {},
    summary: "Make ONE real image for THIS project — you write both the picture and a plain one-sentence description of it, so every image a blind creator gets is described. kind is what to make: 'hero image', 'logo', 'product mockup', and so on; it defaults to a hero. Set place_as_hero true to put it straight across the top of the site's home page (a hero is placed there automatically anyway when that slot is empty). Honest and dormant: if image generation isn't switched on, the result says so and NOTHING is made or charged — never say you made an image when the result reports unavailable. Each project gets a small free allowance each month, then purchased Extras credits; the result tells you whether this one was free or used a credit and how many are left — pass that on, and check with the creator before making images that spend purchased credits. The image is saved to the project; a hero shows on the site, other kinds you can add to a page.",
  },

  // ---- staff-only tools (gated by role: never offered to a regular builder) ----
  platform_pulse: {
    irreversible: false, requires_confirmation: false, required: [], enums: {},
    summary: "Staff only. Read-only snapshot of the platform right now: how many creators, projects, and live listings there are, how many listings are waiting for review, how many reports are open, and whether Clay's brain, research, email, and payments are connected. Use it when a teammate asks how the platform is doing or what needs attention.",
  },
  review_queue: {
    irreversible: false, requires_confirmation: false, required: [], enums: {},
    summary: "Staff only. List the marketplace listings currently waiting for review (status in_review), oldest first — the marketplace review queue. Read-only. Use it to help a teammate see what needs a decision, then talk the decision through before acting.",
  },
  decide_listing: {
    irreversible: false, requires_confirmation: true,
    required: ['listing_id', 'decision'], optional: ['reason', 'notes'],
    enums: { decision: ['approved', 'rejected'], reason: ['missing_baseline', 'running_business', 'fraud', 'missing_risk_disclosure'] },
    summary: "Staff only, consequential — always confirm first. Approve or reject a listing in the review queue. Approving makes it live in the Dream Market; rejecting takes it out of review. A rejection MUST carry a policy reason: missing_baseline (no complete baseline package), running_business (it's an already-operating business, and this marketplace sells pre-proven projects, not live businesses), fraud, or missing_risk_disclosure. 'It competes with mine' is never a valid reason. A moderator can't decide their own listing (owners may clear their own seed listings, recorded in the audit trail). Every decision is logged.",
  },
  report_queue: {
    irreversible: false, requires_confirmation: false, required: [], enums: {},
    summary: "Staff only. List the open reports (flagged listings or content) waiting to be looked at, oldest first — basic moderation. Read-only.",
  },
  resolve_report: {
    irreversible: false, requires_confirmation: true,
    required: ['report_id', 'action'], optional: ['notes'], enums: { action: ['dismiss'] },
    summary: "Staff only, consequential — confirm first. Resolve an open report. Right now the action is dismiss (mark a report handled/closed). Use it once a teammate has actually looked at the report and decided.",
  },
  suspend_user: {
    irreversible: false, requires_confirmation: true,
    required: ['user_id'], optional: ['reason', 'notes'], enums: {},
    summary: "Admins and owners only, consequential — confirm first. Suspend an account (they can't act until reinstated). Reversible with reinstate_user. Only for real policy or safety grounds; record the reason.",
  },
  reinstate_user: {
    irreversible: false, requires_confirmation: true,
    required: ['user_id'], optional: ['notes'], enums: {},
    summary: "Admins and owners only, consequential — confirm first. Lift a suspension and restore an account.",
  },
  manage_staff: {
    irreversible: false, requires_confirmation: true,
    required: ['action'], optional: ['email', 'new_role'],
    enums: { action: ['list', 'promote', 'set_role'], new_role: ['staff', 'admin', 'master_staff'] },
    summary: "Owners only (master_staff — Vission and Rel), consequential for changes — confirm first. Onboard and manage the team. action='list' shows current staff and their roles (read-only). action='promote' makes an existing account (by email) a staff member — default role staff, or pass new_role. action='set_role' changes an existing member's role. The person must already have an account (they sign up first, then you bring them onto the team). Setting someone to master_staff makes them a platform owner — do that only on explicit owner instruction. Every change is logged.",
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
