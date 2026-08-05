// Clay's controlled vocabulary. Mirrors the DB enums so nothing Clay produces
// can violate the schema. Enum guardrails are inherited from Arbo's design.
const CATEGORIES = [
  'digital_product_saas', 'online_service_agency', 'content_creator',
  'ecommerce_pod', 'ai_product_service', 'remote_hybrid_physical', 'micro_solo',
];

// The full concept package Clay assembles by default — the FOUNDATION. Each becomes an `assets`
// row. Note what's deliberately NOT here: the working demo. Clay no longer bundles a demo into
// every build; it offers one afterward and picks the right kind (an interactive app demo, or a
// real published website for simpler ideas). And the old three-part technical guidance
// (website_prompt + tech_requirements + build_instructions) is now ONE `tech_spec` document.
const ASSET_PLAN = [
  { type: 'business_plan',       label: 'Business plan' },
  { type: 'marketing_strategy',  label: 'Marketing strategy' },
  { type: 'customer_research',   label: 'Deep customer research' },
  { type: 'competitor_research', label: 'Deep competitor research' },
  { type: 'regulatory_risk',     label: 'Regulatory & licensing risk' },
  { type: 'operations_staffing', label: 'Operations & staffing plan' },
  { type: 'money_flow',          label: 'Payments, pricing & unit economics' },
  { type: 'growth_plan',         label: 'Low-budget go-to-market & scaling' },
  { type: 'presell_kit',         label: 'Pre-sell & demand-validation kit' },
  { type: 'example_image',       label: 'Example image briefs' },
  { type: 'tech_spec',           label: 'Technical build spec' },
];

const MODES = ['create', 'enhance'];

// ---- Social content (posts, photos, videos, templates) controlled vocab ----
const PLATFORMS = ['instagram', 'facebook', 'x', 'linkedin', 'tiktok', 'youtube_shorts', 'pinterest'];
const SOCIAL_GOALS = ['awareness', 'launch', 'engagement', 'promotion', 'education'];
const MARKETPLACE_FORMATS = ['flat', 'auction'];

// Social assets Clay can generate NATIVELY (all text): post copy, image-
// generation prompts (not rendered photos), short-form video scripts/storyboards
// (not rendered video), reusable templates, and a posting calendar.
const SOCIAL_ASSET_PLAN = [
  { type: 'social_post',      label: 'Social posts' },
  { type: 'image_prompt',     label: 'Photo / image prompts' },
  { type: 'video_script',     label: 'Short-form video scripts' },
  { type: 'social_template',  label: 'Reusable post templates' },
  { type: 'content_calendar', label: 'Posting calendar' },
];

// Reasons Clay may redirect instead of generating (honest guardrails).
const REDIRECTS = {
  NEEDS_CATEGORY: 'needs_category',        // ask which lane before generating
  RUNNING_BUSINESS: 'running_business',    // we serve pre-proven concepts, not live ops
  SCOPE_DRIFT: 'scope_drift',              // refinement became a different business
  OUT_OF_CATEGORY: 'out_of_category',      // not a virtual/remote/micro business
};

module.exports = {
  CATEGORIES, ASSET_PLAN, MODES, REDIRECTS,
  PLATFORMS, SOCIAL_GOALS, MARKETPLACE_FORMATS, SOCIAL_ASSET_PLAN,
};
