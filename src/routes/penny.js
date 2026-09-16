// THE CONVERSATION SURFACE.
//
// Penny answers from the spine. This route wires her tools to the same agent, planner and
// confirmation gate the rest of the platform already uses, so there is one place where a tool call
// is judged safe rather than two that drift apart.
//
// THE THING THIS ROUTE EXISTS TO GET RIGHT: what comes back is not just prose. Every tool result
// carries its own status — answered, empty, unavailable, refused — and the client is told which,
// because "nothing is due" and "I could not check" must never render the same way.

const express = require('express');
const { body, validationResult } = require('express-validator');
const { asyncHandler, ApiError } = require('../lib/http');
const { authenticate } = require('../middleware/auth');
const agent = require('../services/clay/agent');
const { PENNY_WORKSPACE, WORKSPACE_TOOLS } = require('../services/clay/penny');
const workspace = require('../services/clay/workspace');
const spine = require('../services/clay/spine');

const router = express.Router();

// Executors bound to the viewer. Permission is decided inside each executor against this person,
// never against a role passed in from the client.
function buildExecutors(user) {
  const out = {};
  for (const name of WORKSPACE_TOOLS) {
    const fn = workspace.EXECUTORS[name];
    if (fn) out[name] = (params) => fn({ id: user.id, name: user.name }, params || {});
  }
  return out;
}

router.post('/chat', authenticate, [
  body('messages').isArray({ min: 1 }).withMessage('Say something first.'),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) throw new ApiError(400, errs.array()[0].msg);

  const events = [];
  let out;
  try {
    out = await agent.runChat({
      messages: req.body.messages,
      executors: buildExecutors(req.user),
      allowTools: WORKSPACE_TOOLS,
      systemOverride: PENNY_WORKSPACE,
      // So a degraded turn is in her voice rather than in the retired product's.
      assistantName: 'Penny',
      // Twelve rather than six. A person asking "what do I owe and can you add the licence renewal"
      // is two reads and a write, and stopping mid-way leaves them believing something was recorded.
      maxSteps: 12,
      viewer: { role: req.user.role, name: req.user.name },
      onEvent: (e) => events.push(e),
    });
  } catch (e) {
    // The model being unreachable is not the same as Penny having nothing to say, and the person
    // must not be left with a blank turn that reads like a considered answer.
    throw new ApiError(503,
      'I could not think that through just now — that is a failure on my side, not an answer. '
      + 'Nothing has been changed. Try again in a moment.');
  }

  // WHAT THE TOOLS ACTUALLY DID, surfaced rather than summarised. If Penny's prose and this list
  // disagree, the list is true — and the client can show the difference instead of trusting her.
  //
  // Read from the events the agent actually emits — tool_done carries { tool, ok, note } — rather
  // than from a shape I assumed. The first version of this route read out.text, out.stoppedEarly
  // and out.pending, none of which exist; runChat returns { status, reply, messages } and surfaces
  // a confirmation as status 'confirmation_required' with a confirmation object.
  const used = events
    .filter((e) => e.type === 'tool_done')
    .map((e) => ({ tool: e.tool, ok: e.ok, note: e.note }));

  res.json({
    reply: out.reply,
    // 'answered' | 'incomplete' | 'unavailable' | 'confirmation_required', passed straight through.
    // A turn that ran out of room must never be dressed up as a complete answer, and the agent
    // already refuses to let 'incomplete' back a completion claim downstream.
    status: out.status,
    tools_used: used,
    // The sentence written for a person, never the one written for the model.
    awaiting_confirmation: out.confirmation
      ? {
        tool: out.confirmation.tool,
        params: out.confirmation.params,
        ask: (spine.TOOLS[out.confirmation.tool] && spine.TOOLS[out.confirmation.tool].ask)
          || out.confirmation.reason,
      }
      : null,
  });
}));

// Running a tool the person has explicitly confirmed. Separate from /chat on purpose: a confirmation
// is a decision, and a decision should be its own request rather than a flag buried in a message.
router.post('/confirm', authenticate, [
  body('tool').isString(),
  body('params').isObject(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) throw new ApiError(400, errs.array()[0].msg);

  if (!WORKSPACE_TOOLS.includes(req.body.tool)) {
    throw new ApiError(400, 'That is not something I can do here.');
  }
  // Still goes through the planner, with confirmed set. The gate is not bypassed by having asked —
  // enum guardrails and required params are checked again on the way in.
  const plan = agent.planToolInvocation(req.body.tool, req.body.params, { confirmed: true });
  if (plan.action === 'reject') throw new ApiError(400, plan.reason);

  const fn = workspace.EXECUTORS[req.body.tool];
  const result = await fn({ id: req.user.id, name: req.user.name }, req.body.params);
  res.json({ result });
}));

module.exports = router;
