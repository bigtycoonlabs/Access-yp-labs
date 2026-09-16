// METERING. Every model call and every image, recorded with what it cost and who it was for.
//
// Pricing is a guess until this exists: nobody could say what a person costs us to serve. The
// context comes from AsyncLocalStorage, so provider code does not need to be told who is asking:
//   - every web request opens a context (middleware below), and authenticate fills in the person;
//   - background work, such as a build, opens its own with meter.within().
// A call made with no context is still recorded, as unattributed, rather than dropped.
//
// Recording must never break the work it measures, but a failure to record is logged, never
// swallowed: an unrecorded call is a cost nobody will see.

const { AsyncLocalStorage } = require('async_hooks');
const { query } = require('../config/db');
const Prices = require('../lib/modelPrices');

const als = new AsyncLocalStorage();

function purposeFor(path) {
  const m = String(path || '').match(/^\/api\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : 'web';
}

function middleware(req, res, next) {
  als.run({ user_id: null, business_id: null, purpose: purposeFor(req.path) }, () => next());
}

function setUser(id) {
  const s = als.getStore();
  if (s && id) s.user_id = id;
}

function within(ctx, fn) {
  const parent = als.getStore() || {};
  return als.run(Object.assign({ user_id: null, business_id: null, purpose: 'background' }, parent, ctx), fn);
}

function context() { return als.getStore() || null; }

// Normalise the three usage shapes into input / cached / output / reasoning. The caller says which
// API answered, because Anthropic and the Responses API use the same field names differently.
function readUsage(u, api) {
  if (!u) return null;
  if (api === 'anthropic') {
    // Anthropic reports cache reads outside input_tokens.
    const cached = u.cache_read_input_tokens || 0;
    return { input: (u.input_tokens || 0) + cached + (u.cache_creation_input_tokens || 0), cached,
      output: u.output_tokens || 0, reasoning: 0 };
  }
  if (api === 'responses') {
    return { input: u.input_tokens || 0, cached: (u.input_tokens_details || {}).cached_tokens || 0,
      output: u.output_tokens || 0, reasoning: (u.output_tokens_details || {}).reasoning_tokens || 0 };
  }
  return { input: u.prompt_tokens || 0, cached: (u.prompt_tokens_details || {}).cached_tokens || 0,
    output: u.completion_tokens || 0, reasoning: (u.completion_tokens_details || {}).reasoning_tokens || 0 };
}

async function write(row) {
  const c = context() || {};
  try {
    await query(
      `INSERT INTO model_usage (user_id, business_id, purpose, kind, model, input_tokens, cached_tokens,
         output_tokens, reasoning_tokens, images, cost_micros, prices_checked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [c.user_id || null, c.business_id || null, c.purpose || 'unattributed', row.kind, row.model || 'unknown',
        row.input || 0, row.cached || 0, row.output || 0, row.reasoning || 0, row.images || 0,
        row.cost_micros, Prices.CHECKED]);
  } catch (e) {
    console.error('[meter] could not record a ' + row.kind + ' call on ' + row.model + ': ' + e.message);
  }
}

// Called by the provider with the raw usage object. Never throws.
function recordText(model, usage, api) {
  const u = readUsage(usage, api);
  if (!u) {
    console.error('[meter] a call on ' + model + ' came back with no usage, so its cost is unknown');
    return write({ kind: 'text', model, cost_micros: null });
  }
  return write(Object.assign({ kind: 'text', model, cost_micros: Prices.textCostMicros(model, u) }, u));
}

function recordImages(model, count) {
  return write({ kind: 'image', model, images: count, cost_micros: Prices.imageCostMicros(model, count) });
}

// What someone has used in a period. Unknown costs are counted, not added in as zero.
async function summary({ user_id, since }) {
  const r = await query(
    `SELECT purpose, kind, count(*)::int AS calls, sum(input_tokens)::bigint AS input_tokens,
            sum(output_tokens)::bigint AS output_tokens, sum(images)::int AS images,
            sum(cost_micros)::bigint AS cost_micros, count(*) FILTER (WHERE cost_micros IS NULL)::int AS unpriced
       FROM model_usage WHERE user_id=$1 AND created_at >= $2
      GROUP BY purpose, kind ORDER BY sum(cost_micros) DESC NULLS LAST`, [user_id, since]);
  const total = r.rows.reduce((n, x) => n + Number(x.cost_micros || 0), 0);
  const unpriced = r.rows.reduce((n, x) => n + x.unpriced, 0);
  return { rows: r.rows, cost_micros: total, unpriced };
}

module.exports = { middleware, setUser, within, context, readUsage, recordText, recordImages, summary, purposeFor };
