// Clay as a conversational, tool-calling agent — the Arbo spine, made live.
//
// Safety contract (non-negotiable, from a blind founder who can't visually
// verify outcomes): Clay may reason and ACT on reversible, free things
// (generate/enhance/social), but it may NEVER perform an irreversible action —
// spending money, publishing a public listing, or deleting — without EXPLICIT
// human confirmation. Enum guardrails reject out-of-vocabulary params before
// anything runs. If Clay can't help, it says so; it never fabricates.

const spine = require('./spine');
const provider = require('./provider');

const PARAM_TYPES = {
  concept_id: 'string', listing_id: 'string', prompt: 'string', category: 'string', query: 'string',
  goal: 'string', format: 'string', platforms: 'array', price: 'number', count: 'number',
};

// Build Anthropic tool schemas from the spine registry, carrying the enum
// guardrails into the model's own input schema.
function toolSchemas() {
  return Object.entries(spine.TOOLS).map(([name, tool]) => {
    const properties = {};
    const keys = new Set([...(tool.required || []), ...(tool.optional || []), ...Object.keys(tool.enums || {})]);
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

const SYSTEM = `You are Clay, the conversational idea printer and build partner for Access YP Labs. Access YP Labs runs the Dreamhold, its marketplace and collective dreamspace of business ideas the world never got around to launching. You believe an idea can be proven profitable before launch. The user works with you in their Laboratory. You help both builders shaping dreams and buyers claiming them. You reason; you never recite or fabricate. You help with everything EXCEPT writing the final code, which the user completes; for that you lay out a clear flow.

Your voice: you talk like a sharp, funny, genuinely confident partner messaging someone who's building something — first person, warm, direct, a little playful. You're excited to build, you challenge people to go bigger, and you speak TO the person, never at them or about them. You have opinions and you share them. Call to the part of them that had the idea in the first place. But your confidence never means faking data, glossing over risk, or sounding certain when you're not — when you're unsure you say so out loud, and that honesty IS the confidence. The people you help often can't see the screen to double-check you, so a confident wrong answer is the one thing you never give. Keep it conversational and human — never corporate, never a form, never a wall of bullet points when a few real sentences will do.

You have tools, including read-only ones to see the user's own concepts and to search the marketplace. Use them to actually help — whether the person wants to BUILD a concept or is a BUYER exploring concepts to purchase and launch. Look things up before assuming. But you must respect these rules absolutely:
- You may run reversible, free tools (generating or enhancing a concept, generating social content) directly.
- You have a research tool that searches the live web and returns sources. Use it BEFORE asserting market size, demand, competitors, pricing, or regulation — reason from what you find, then CITE the sources by name and link so the user can verify. If research isn't connected or comes back empty, say so plainly and label anything you still offer as your own reasoning, never as researched fact. Recall is not research.
- You may NEVER finalize an irreversible action — publishing a listing, buying, or deleting — on your own. Propose it, then wait for the person's explicit confirmation. The system enforces this too.
- If a request is under-specified for an irreversible action, ask for the missing details before proposing it.
- If you cannot do something, say so plainly. Never invent results, traction, or data.`;

// Run one chat exchange over the normalized provider. Executes reversible tools
// via injected executors; returns a confirmation request (without acting) for
// irreversible ones. `messages` is the normalized transcript; `executors` maps
// tool name -> async (params) => resultObject.
async function runChat({ messages, executors = {}, maxSteps = 4 }) {
  if (!provider.available()) {
    return { status: 'unavailable',
      reply: 'Clay could not run right now (generation service is not configured). Nothing was fabricated.' };
  }
  const tools = toolSchemas();
  const convo = messages.slice();

  for (let step = 0; step < maxSteps; step++) {
    const resp = await provider.chat({ system: SYSTEM, messages: convo, tools });
    if (!resp.ok) {
      return { status: 'unavailable',
        reply: resp.reason === 'unavailable'
          ? 'Clay could not run right now (generation service is not configured). Nothing was fabricated.'
          : `Clay could not reach the generation service: ${resp.error}. Nothing was fabricated.` };
    }
    const toolCalls = resp.tool_calls || [];
    const text = (resp.text || '').trim();

    if (!toolCalls.length) {
      convo.push({ role: 'assistant', text });
      return { status: 'answered', reply: text || '(no reply)', messages: convo };
    }

    convo.push({ role: 'assistant', text, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      const plan = planToolInvocation(tc.name, tc.input || {});
      if (plan.action === 'reject') {
        convo.push({ role: 'tool', tool_call_id: tc.id, content: 'Rejected: ' + plan.reason });
      } else if (plan.action === 'confirm') {
        // Stop and ask the human — do NOT execute. Keep the conversation
        // well-formed for replay: every tool_call in this assistant turn needs a
        // matching tool result, so mark the pending call (and any later calls in
        // the same batch) as awaiting confirmation instead of leaving them
        // dangling — otherwise continuing the chat after a confirm/cancel sends
        // an unanswered tool_call and the provider rejects the whole turn.
        const idx = toolCalls.indexOf(tc);
        for (let j = idx; j < toolCalls.length; j++) {
          convo.push({ role: 'tool', tool_call_id: toolCalls[j].id, content: 'Not executed — awaiting the user\'s explicit confirmation.' });
        }
        return {
          status: 'confirmation_required',
          reply: text || plan.reason,
          confirmation: { tool: tc.name, params: tc.input || {}, reason: plan.reason },
          messages: convo,
        };
      } else {
        const exec = executors[tc.name];
        let out;
        try { out = exec ? await exec(tc.input || {}) : { note: 'This action is not available in chat yet.' }; }
        catch (e) { out = { error: e.message }; }
        convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 4000) });
      }
    }
  }
  return { status: 'answered', reply: 'Clay reached its step limit for this turn. Ask me to continue.', messages: convo };
}

module.exports = { toolSchemas, planToolInvocation, runChat };
