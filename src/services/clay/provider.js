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
function isReasoningModel(m) { return /^(gpt-5|o\d)/i.test(String(m)); }
function openaiTokenParams(maxTokens) {
  if (isReasoningModel(OPENAI_MODEL)) {
    const p = { max_completion_tokens: maxTokens };
    if (OPENAI_REASONING_EFFORT) p.reasoning_effort = OPENAI_REASONING_EFFORT;
    return p;
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

function openaiClient() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
function anthropicClient() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }

// ---- single-shot text completion ----
async function complete({ system, user, json = false, maxTokens = 6000 }) {
  const p = providerName();
  if (!p) return { ok: false, reason: 'unavailable', text: '' };
  try {
    if (p === 'openai') {
      const resp = await openaiClient().chat.completions.create({
        model: OPENAI_MODEL, ...openaiTokenParams(maxTokens),
        response_format: json ? { type: 'json_object' } : undefined,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      return { ok: true, text: resp.choices?.[0]?.message?.content || '' };
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
  const resp = await openaiClient().chat.completions.create({ model: OPENAI_MODEL, ...openaiTokenParams(maxTokens), messages: oaMessages, tools: oaTools });
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

module.exports = { available, providerName, modelName, complete, describeImage, chat };
