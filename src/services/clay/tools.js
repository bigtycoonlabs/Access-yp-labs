// Clay's controlled vocabulary. Mirrors the DB enums so nothing Clay produces
// can violate the schema. Enum guardrails are inherited from Arbo's design.
const CATEGORIES = [
  'digital_product_saas', 'online_service_agency', 'content_creator',
  'ecommerce_pod', 'ai_product_service', 'remote_hybrid_physical', 'micro_solo',
];

// The full concept package Clay assembles. Each becomes an `assets` row.
const ASSET_PLAN = [
  { type: 'business_plan',       label: 'Business plan' },
  { type: 'marketing_strategy',  label: 'Marketing strategy' },
  { type: 'customer_research',   label: 'Deep customer research' },
  { type: 'competitor_research', label: 'Deep competitor research' },
  { type: 'regulatory_risk',     label: 'Regulatory & licensing risk' },
  { type: 'html_demo',           label: 'Working HTML demo' },
  { type: 'example_image',       label: 'Example image briefs' },
  { type: 'website_prompt',      label: 'Website build prompt' },
  { type: 'build_instructions',  label: 'AI build instructions' },
];

const MODES = ['create', 'enhance'];

// Reasons Clay may redirect instead of generating (honest guardrails).
const REDIRECTS = {
  NEEDS_CATEGORY: 'needs_category',        // ask which lane before generating
  RUNNING_BUSINESS: 'running_business',    // we serve pre-proven concepts, not live ops
  SCOPE_DRIFT: 'scope_drift',              // refinement became a different business
  OUT_OF_CATEGORY: 'out_of_category',      // not a virtual/remote/micro business
};

module.exports = { CATEGORIES, ASSET_PLAN, MODES, REDIRECTS };
