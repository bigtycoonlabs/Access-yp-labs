// WHAT A MODEL CALL COSTS US. US dollars per million tokens, standard tier, short context.
//
// Checked 16 September 2026 against OpenAI's model page for GPT-5.5 and published rate tables for
// GPT-5.6 (developers.openai.com, benchlm.ai, aipricing.guru). Prices change; when they do, change
// them here and nowhere else. A model that is not listed has NO price: its calls are recorded with
// an unknown cost, never a cost of zero, because zero is a claim that the call was free.
//
// GPT-5.5 bills a whole request at 2x input and 1.5x output once its input passes 272,000 tokens.

const CHECKED = '2026-09-16';

const TEXT = {
  'gpt-5.5':         { input: 5.00, cached: 0.50, output: 30.00, long_after: 272000, long_in: 2, long_out: 1.5 },
  'gpt-5.6-sol':     { input: 5.00, cached: 0.50, output: 30.00 },
  'gpt-5.6-terra':   { input: 2.00, cached: 0.20, output: 12.00 },
  'gpt-5.6-luna':    { input: 0.20, cached: 0.02, output: 1.20 },
  'gpt-5-nano':      { input: 0.05, cached: 0.005, output: 0.40 },
  'claude-sonnet-4-5': { input: 3.00, cached: 0.30, output: 15.00 },
};

// Per image, at the size this platform asks for (1024x1024, standard quality).
const IMAGE = {
  'dall-e-3': 0.04,
};

function textPrice(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  if (TEXT[m]) return TEXT[m];
  // Dated snapshots ("gpt-5.5-2026-04-23") price as their family.
  const base = Object.keys(TEXT).sort((a, b) => b.length - a.length).find((k) => m.startsWith(k + '-'));
  return base ? TEXT[base] : null;
}

// Cost in millionths of a dollar (micros), so sums stay exact integers. null when unknown.
// `input` is every input token including cached ones; `cached` is the part billed at the cached rate.
// Reasoning tokens are already inside `output`, and are billed as output.
function textCostMicros(model, { input = 0, cached = 0, output = 0 } = {}) {
  const p = textPrice(model);
  if (!p) return null;
  const long = p.long_after && input > p.long_after;
  const inRate = p.input * (long ? p.long_in : 1);
  const cachedRate = p.cached * (long ? p.long_in : 1);
  const outRate = p.output * (long ? p.long_out : 1);
  const fresh = Math.max(0, input - cached);
  const dollars = (fresh * inRate + Math.min(cached, input) * cachedRate + output * outRate) / 1e6;
  return Math.round(dollars * 1e6);
}

function imageCostMicros(model, count = 1) {
  const each = IMAGE[String(model || '').toLowerCase()];
  return each == null ? null : Math.round(each * 1e6 * count);
}

module.exports = { CHECKED, TEXT, IMAGE, textPrice, textCostMicros, imageCostMicros };
