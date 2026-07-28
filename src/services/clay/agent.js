// Clay as a conversational, tool-calling agent — the Arbo spine, made live.
//
// Safety contract (non-negotiable, from a blind founder who can't visually
// verify outcomes): Clay may reason and ACT on reversible, free things
// (generate/enhance/social), but it may NEVER perform an irreversible action —
// spending money, publishing a public listing, or deleting — without EXPLICIT
// human confirmation. Enum guardrails reject out-of-vocabulary params before
// anything runs. If Clay can't help, it says so; it never fabricates.

const spine = require('./spine');

const MODEL = process.env.CLAY_MODEL || 'claude-sonnet-4-5';
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch (_) { /* optional */ }
function client() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const PARAM_TYPES = {
  concept_id: 'string', listing_id: 'string', prompt: 'string', category: 'string',
  goal: 'string', format: 'string', platforms: 'array', price: 'number', count: 'number',
};

// Build Anthropic tool schemas from the spine registry, carrying the enum
// guardrails into the model's own input schema.
function toolSchemas() {
  return Object.entries(spine.TOOLS).map(([name, tool]) => {
    const properties = {};
    const keys = new Set([...(tool.required || []), ...Object.keys(tool.enums || {})]);
    for (const key of keys) {
      const t = PARAM_TYPES[key] || 'string';
      if (t === 'array') {
        properties[key] = { type: 'array', items: tool.enums[key] ? { type: 'string', enum: tool.enums[key] } : { type: 'string' } };
      } else {
        properties[key] = tool.enums && tool.enums[key] ? { type: 'string', enum: tool.enums[key] } : { type: t };
      }
    }
    return {
      name,
      description: tool.summary + (tool.requires_confirmation ? ' Requires explicit human confirmation.' : ''),
      input_schema: { type: 'object', properties, required: tool.required || [] },
    };
  });
}

// Pure, testable safety decision for a proposed tool call.
//   reject  — invalid params / unknown tool (enum guardrail)
//   confirm — irreversible or confirmation-required: must ask the human first
//   execute — reversible & valid: safe to run now
function planToolInvocation(name, params, { confirmed = false } = {}) {
  const valid = spine.validateParams(name, params);
  if (!valid.ok) return { action: 'reject', reason: valid.errors.join(' ') };
  const ask = spine.shouldAsk(name, params);
  if (ask.ask && !confirmed) return { action: 'confirm', reason: ask.reason };
  return { action: 'execute', reason: '' };
}

const SYSTEM = `You are Clay, the conversational idea printer and build partner for Access YP Labs — a neutral launchpad for pre-proven remote/digital/micro businesses. You reason; you never recite or fabricate. You help with everything EXCEPT writing the final code, which the user completes; for that you lay out a clear flow.

You have tools. Use them to actually help. But you must respect these rules absolutely:
- You may run reversible, free tools (generating or enhancing a concept, generating social content) directly.
- You may NEVER finalize an irreversible action — publishing a listing, buying, or deleting — on your own. Propose it, then wait for the person's explicit confirmation. The system enforces this too.
- If a request is under-specified for an irreversible action, ask for the missing details before proposing it.
- If you cannot do something, say so plainly. Never invent results, traction, or data.`;

// Run one chat exchange. Executes reversible tools via injected executors;
// returns a confirmation request (without acting) for irreversible ones.
// `executors` maps tool name -> async (params) => resultObject.
async function runChat({ messages, executors = {}, maxSteps = 4 }) {
  const anthropic = client();
  if (!anthropic) {
    return { status: 'unavailable',
      reply: 'Clay could not run right now (generation service is not configured). Nothing was fabricated.' };
  }
  const tools = toolSchemas();
  const convo = messages.slice();

  for (let step = 0; step < maxSteps; step++) {
    let resp;
    try {
      resp = await anthropic.messages.create({ model: MODEL, max_tokens: 4000, system: SYSTEM, tools, messages: convo });
    } catch (err) {
      return { status: 'unavailable', reply: `Clay could not reach the generation service: ${err.message}. Nothing was fabricated.` };
    }
    const toolUses = (resp.content || []).filter((b) => b.type === 'tool_use');
    const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

    if (!toolUses.length) {
      convo.push({ role: 'assistant', content: resp.content });
      return { status: 'answered', reply: text || '(no reply)', messages: convo };
    }

    convo.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const tu of toolUses) {
      const plan = planToolInvocation(tu.name, tu.input || {});
      if (plan.action === 'reject') {
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: plan.reason });
      } else if (plan.action === 'confirm') {
        // Stop and ask the human — do NOT execute.
        return {
          status: 'confirmation_required',
          reply: text || plan.reason,
          confirmation: { tool: tu.name, params: tu.input || {}, reason: plan.reason },
          messages: convo,
        };
      } else {
        const exec = executors[tu.name];
        let out;
        try { out = exec ? await exec(tu.input || {}) : { note: 'This action is not available in chat yet.' }; }
        catch (e) { out = { error: e.message }; }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 4000) });
      }
    }
    convo.push({ role: 'user', content: results });
  }
  return { status: 'answered', reply: 'Clay reached its step limit for this turn. Ask me to continue.', messages: convo };
}

module.exports = { toolSchemas, planToolInvocation, runChat, MODEL };
