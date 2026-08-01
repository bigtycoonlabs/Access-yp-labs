// Model provider abstraction for Clay. Prefers OpenAI (the platform's chosen
// reasoning engine); falls back to Anthropic if only that key is present; and
// reports 'unavailable' honestly with neither. Normalizes single-shot
// completion, vision description, and tool-calling so the rest of Clay is
// provider-agnostic. Nothing here ever fabricates — on any failure it returns
// an honest error/unavailable signal for callers to surface.

let OpenAI = null, Anthropic = null;
try { OpenAI = require('openai'); } catch (_) { /* optional */ }
try { Anthropic = require('@anthropic-ai/sdk'); } catch (_) { /* optional */ }

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const ANTHROPIC_MODEL = process.env.CLAY_MODEL || 'claude-sonnet-4-5';
// GPT-5 / o-series reasoning models require max_completion_tokens (they reject the
// older max_tokens) and accept an optional reasoning_effort; gpt-4o-class models use
// max_tokens and reject reasoning_effort. Route params by model so Clay works on
// either without silently failing. Set OPENAI_REASONING_EFFORT (low|medium|high|xhigh)
// to deepen reasoning; unset uses the model's own default (medium for gpt-5.5).
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || null;
// Known-good model to fall back to if a mistyped/unavailable OPENAI_MODEL 404s, so a
// single bad env value can never fully break Clay. Overridable via OPENAI_FALLBACK_MODEL.
const OPENAI_FALLBACK = process.env.OPENAI_FALLBACK_MODEL || 'gpt-5.5';
function isReasoningModel(m) { return /^(gpt-5|o\d)/i.test(String(m)); }
// Adaptive reasoning: Clay scales how hard the model thinks to the task, rather than a
// flat setting. Simple/cheap calls stay fast on 'low'; genuinely hard analysis earns
// 'high'; large structured generations use 'medium' so they finish within the request
// timeout instead of grinding for minutes. A caller can pin an effort explicitly, and
// OPENAI_REASONING_EFFORT (if set) acts as a ceiling that never raises the chosen level.
const EFFORT_ORDER = { low: 1, medium: 2, high: 3 };

function autoEffort({ maxTokens = 1000, json = false, inputChars = 0 }) {
  // Effort scales with how hard the THINKING is (how much input to weigh, how tricky the
  // problem) — NOT with how much text gets written. A big structured document is
  // generation work: it needs token headroom and a good prompt, not deep reasoning, and
  // burning reasoning time on it just makes it slow. So:
  //   - dense input, compact output (analysis, validation, self-critique) -> think hard
  //   - moderate analysis -> medium
  //   - trivial, and large generations alike -> low, so they stay fast
  if (inputChars >= 6000 && maxTokens <= 4000) return 'high';
  if (inputChars >= 3000 && maxTokens <= 6000) return 'medium';
  return 'low';
}

function resolveEffort({ maxTokens = 1000, json = false, inputChars = 0, effort = null } = {}) {
  let tier = (effort && EFFORT_ORDER[effort]) ? effort : autoEffort({ maxTokens, json, inputChars });
  const ceil = (OPENAI_REASONING_EFFORT && EFFORT_ORDER[OPENAI_REASONING_EFFORT]) ? OPENAI_REASONING_EFFORT : null;
  if (ceil && EFFORT_ORDER[tier] > EFFORT_ORDER[ceil]) tier = ceil; // clamp down, never up
  return tier;
}

function openaiTokenParams(maxTokens, model, opts = {}) {
  if (isReasoningModel(model || OPENAI_MODEL)) {
    return { max_completion_tokens: maxTokens, reasoning_effort: resolveEffort({ maxTokens, ...opts }) };
  }
  return { max_tokens: maxTokens };
}

// Token params for a TOOL-using chat turn. gpt-5.x on /v1/chat/completions returns a hard 400
// if a reasoning_effort of low/medium/high is sent alongside function tools — it requires
// 'none' (or the separate /v1/responses endpoint). Clay's agent turns ARE tool dispatch, not
// deep analysis, so 'none' is the right setting here regardless; the heavy reasoning lives on
// the non-tool complete() path (concept generation, validation, self-critique), which is
// untouched. Pinning 'none' keeps the whole agent working instead of 400-ing on every turn.
// Non-reasoning models (gpt-4o-class) keep max_tokens and never carry reasoning_effort.
function openaiToolTokenParams(maxTokens, model) {
  if (isReasoningModel(model || OPENAI_MODEL)) {
    return { max_completion_tokens: maxTokens, reasoning_effort: 'none' };
  }
  return { max_tokens: maxTokens };
}

function providerName() {
  if (OpenAI && process.env.OPENAI_API_KEY) return 'openai';
  if (Anthropic && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}
function available() { return providerName() !== null; }
function modelName() { return providerName() === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL; }

function openaiClient() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 180000, maxRetries: 0 }); }
function anthropicClient() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }

// ---- single-shot text completion ----
async function complete({ system, user, json = false, maxTokens = 6000, model = null, fallback = true, effort = null }) {
  const p = providerName();
  if (!p) return { ok: false, reason: 'unavailable', text: '' };
  try {
    if (p === 'openai') {
      const oaModel = model || OPENAI_MODEL;
      const tokenOpts = { json, inputChars: String(system || '').length + String(user || '').length, effort };
      const call = (mdl) => openaiClient().chat.completions.create({
        model: mdl, ...openaiTokenParams(maxTokens, mdl, tokenOpts),
        response_format: json ? { type: 'json_object' } : undefined,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      try {
        const resp = await call(oaModel);
        return { ok: true, text: resp.choices?.[0]?.message?.content || '' };
      } catch (err) {
        // A mistyped/unavailable OPENAI_MODEL shouldn't fully break Clay: if the
        // configured model doesn't exist, retry once on a known-good default. Skipped
        // when the caller pinned a specific model (so the probe still tells the truth).
        const notFound = err && (err.status === 404 || /does not exist|do not have access/i.test(err.message || ''));
        if (fallback && !model && notFound && oaModel !== OPENAI_FALLBACK) {
          console.error(`OPENAI_MODEL "${oaModel}" is unavailable (${err.message}); falling back to ${OPENAI_FALLBACK}.`);
          const resp = await call(OPENAI_FALLBACK);
          return { ok: true, text: resp.choices?.[0]?.message?.content || '', fallback_model: OPENAI_FALLBACK, requested_model: oaModel };
        }
        throw err;
      }
    }
    const resp = await anthropicClient().messages.create({
      model: ANTHROPIC_MODEL, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: user }],
    });
    return { ok: true, text: (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n') };
  } catch (err) {
    return { ok: false, reason: 'error', error: err.message, text: '' };
  }
}

// ---- vision: describe an image ----
async function describeImage({ imageBase64, mediaType = 'image/png', system, prompt, maxTokens = 700 }) {
  const p = providerName();
  if (!p) return { ok: false, reason: 'unavailable', text: '' };
  try {
    if (p === 'openai') {
      const resp = await openaiClient().chat.completions.create({
        model: OPENAI_MODEL, ...openaiTokenParams(maxTokens),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          ] },
        ],
      });
      return { ok: true, text: resp.choices?.[0]?.message?.content || '' };
    }
    const resp = await anthropicClient().messages.create({
      model: ANTHROPIC_MODEL, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ] }],
    });
    return { ok: true, text: (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n') };
  } catch (err) {
    return { ok: false, reason: 'error', error: err.message, text: '' };
  }
}

// ---- tool-calling chat (normalized) ----
// Normalized history entries:
//   { role:'user', content:string }
//   { role:'assistant', text:string, tool_calls:[{id,name,input}] }
//   { role:'tool', tool_call_id:string, content:string }
// Returns: { ok, text, tool_calls:[{id,name,input}] }  or { ok:false, reason }
async function chat({ system, messages, tools, maxTokens = 4000 }) {
  const p = providerName();
  if (!p) return { ok: false, reason: 'unavailable' };
  try {
    if (p === 'openai') return await openaiChat({ system, messages, tools, maxTokens });
    return await anthropicChat({ system, messages, tools, maxTokens });
  } catch (err) {
    return { ok: false, reason: 'error', error: err.message };
  }
}

async function openaiChat({ system, messages, tools, maxTokens }) {
  const oaMessages = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') oaMessages.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || '' };
      if (m.tool_calls && m.tool_calls.length) {
        msg.tool_calls = m.tool_calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input || {}) } }));
      }
      oaMessages.push(msg);
    } else if (m.role === 'tool') {
      oaMessages.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    }
  }
  const oaTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const resp = await openaiClient().chat.completions.create({ model: OPENAI_MODEL, ...openaiToolTokenParams(maxTokens), messages: oaMessages, tools: oaTools });
  const choice = resp.choices?.[0]?.message || {};
  const tool_calls = (choice.tool_calls || []).map((tc) => {
    let input = {};
    try { input = JSON.parse(tc.function.arguments || '{}'); } catch (_) { input = {}; }
    return { id: tc.id, name: tc.function.name, input };
  });
  return { ok: true, text: choice.content || '', tool_calls };
}

async function anthropicChat({ system, messages, tools, maxTokens }) {
  const anMessages = [];
  for (const m of messages) {
    if (m.role === 'user') anMessages.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const blocks = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      (m.tool_calls || []).forEach((t) => blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input || {} }));
      anMessages.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      anMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] });
    }
  }
  const anTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const resp = await anthropicClient().messages.create({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, tools: anTools, messages: anMessages });
  const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const tool_calls = (resp.content || []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input || {} }));
  return { ok: true, text, tool_calls };
}

// Live connection probe: makes a tiny real call so staff can see whether the key
// AND the chosen model actually work — not just whether a key env var is present.
// Returns the exact provider error (bad key, no model access, etc.) rather than a
// vague "unavailable", so the real cause is visible without reading server logs.
async function probe(model) {
  const p = providerName();
  if (!p) {
    return { ok: false, provider: null, model: null, reason: 'no_key',
      detail: 'No AI provider key is set. Set OPENAI_API_KEY (or ANTHROPIC_API_KEY) on the server.' };
  }
  const tried = p === 'openai' ? (model || OPENAI_MODEL) : ANTHROPIC_MODEL;
  const out = await complete({ system: 'Reply with the single word: ok', user: 'ok', json: false, maxTokens: 64, model: model || null, fallback: false });
  if (out.ok) {
    return { ok: true, provider: p, model: tried, detail: 'Clay reached the model successfully.' };
  }
  return { ok: false, provider: p, model: tried, reason: out.reason || 'error',
    detail: out.error || 'The model call failed for an unknown reason.' };
}

// ---- live web search via the provider's own hosted tool ----
// So Clay can research with just the OpenAI key — no separate search service. Uses the
// Responses API web_search tool (gpt-5.x supports it; Chat Completions web_search_options
// does NOT and 400s on gpt-5). Returns the model's grounded synthesis plus the real source
// URLs it cited, or an honest empty/unavailable signal — never fabricated sources.
function parseOpenAISearch(resp) {
  const out = Array.isArray(resp && resp.output) ? resp.output : [];
  const searched = out.some((o) => o && o.type === 'web_search_call');
  const sources = []; const seen = new Set();
  let answer = '';
  for (const item of out) {
    if (item && item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (!c) continue;
        if (typeof c.text === 'string') answer += c.text;
        const anns = c.annotations || [];
        for (const a of anns) {
          if (a && a.type === 'url_citation' && a.url && !seen.has(a.url)) {
            seen.add(a.url);
            sources.push({ title: a.title || a.url, url: a.url, snippet: '' });
          }
        }
      }
    }
  }
  if (!answer && typeof resp.output_text === 'string') answer = resp.output_text;
  return { available: true, searched, results: sources, answer: (answer || '').trim() || null };
}

async function webSearch(query, { maxResults = 5, model = null } = {}) {
  const p = providerName();
  const q = String(query || '').trim();
  if (!q) return { available: true, searched: false, results: [], answer: null };
  if (p !== 'openai') {
    // Only OpenAI's hosted web_search is wired today; an Anthropic backend can be added later.
    return { available: false, reason: 'no_web_search_backend', results: [], answer: null };
  }
  try {
    const mdl = model || process.env.OPENAI_SEARCH_MODEL || OPENAI_MODEL;
    const resp = await openaiClient().responses.create({
      model: mdl,
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      max_output_tokens: 8192, // gpt-5.x burns reasoning tokens; too small returns status:incomplete
      input: 'Research the open web for current, factual information to answer the following, then give a concise sourced summary with real citations. Search at most twice. If the web has little on it, say so plainly rather than guessing.\n\n' + q.slice(0, 500),
    }, { timeout: 90000 });
    const parsed = parseOpenAISearch(resp);
    parsed.results = parsed.results.slice(0, maxResults);
    return parsed;
  } catch (err) {
    return { available: true, searched: false, results: [], answer: null, reason: (err && err.message) || 'search_failed' };
  }
}

module.exports = { available, providerName, modelName, complete, describeImage, chat, probe, autoEffort, resolveEffort, openaiToolTokenParams, webSearch, _parseOpenAISearch: parseOpenAISearch };
