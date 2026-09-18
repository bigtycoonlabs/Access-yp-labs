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
const Keys = require('../services/clay/keys');
const Allowance = require('../services/allowance');
const spine = require('../services/clay/spine');
const Voice = require('../services/clay/voice');
const Ears = require('../services/clay/ears');
const Notes = require('../services/clay/notes');
const Views = require('../services/clay/views');

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

// PENNY'S VOICE. One sentence in, sound back. Sentence by sentence on purpose: speaking takes about
// as long as the words last, so waiting for a whole answer would leave somebody in silence.
// A failure here is said in words and the page carries on with the screen reader, because silence
// with no reason given is the one thing a blind client cannot interpret.
router.post('/speak', authenticate, [
  body('text').isString().trim().isLength({ min: 1, max: Voice.MAX_CHARS }),
], asyncHandler(async (req, res) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, 'There was nothing to say.');
  const r = await Voice.speak(req.body.text);
  if (!r.ok) return res.status(r.kind === 'unclear' ? 422 : 503).json({ error: r.says, kind: r.kind });
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.send(r.audio);
}));

// How her answer is broken up for speaking, so the page asks for the same pieces she would say.
router.post('/sentences', authenticate, [
  body('text').isString(),
], asyncHandler(async (req, res) => {
  res.json({ sentences: Voice.sentences(req.body.text) });
}));

// PENNY LISTENING. The recording is held for one request and never stored.
router.post('/listen', authenticate,
  express.raw({ type: () => true, limit: Ears.MAX_BYTES + 1024 }),
  asyncHandler(async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const r = await Ears.hear(buf, req.get('Content-Type'));
    if (!r.ok) return res.status(r.kind === 'unavailable' ? 503 : 422).json({ error: r.says, kind: r.kind });
    res.json({ text: r.text });
  }));

// TALKING WHILE SHE WORKS.
//
// The same turn as /chat, reported as it happens rather than at the end. A compliance search takes
// minutes; going quiet for minutes reads as broken, and somebody who cannot see a spinner has
// nothing else to go on. Each event carries a sentence written for a person, so the page can speak
// it in Penny's voice as it arrives.
//
// It is the SAME agent, the same tools and the same allowance as /chat. Nothing here is a second
// implementation of anything: a feature with two implementations is two behaviours, and the person
// gets whichever one they happened to reach.
router.post('/chat/live', authenticate, [
  body('messages').isArray({ min: 1 }),
], asyncHandler(async (req, res) => {
  const e = validationResult(req);
  if (!e.isEmpty()) throw new ApiError(400, 'Say something first.');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const sse = (type, data) => {
    if (res.writableEnded) return;
    res.write('data: ' + JSON.stringify(Object.assign({ type }, data)) + '\n\n');
  };

  const scrubbed = Keys.scrub(req.body.messages);
  if (scrubbed.found.length) sse('note', { say: 'I took a key out of that message before it was sent anywhere.' });

  const allowed = await Allowance.check(req.user, 'penny_message');
  if (!allowed.ok) {
    sse('reply', { say: allowed.says, status: 'refused' });
    sse('done', { status: 'refused' });
    return res.end();
  }

  // WHAT SHE HAS BEEN TOLD, carried into the turn. Never blocks it: if it cannot be read she works
  // without it rather than refusing to answer.
  const told = await Notes.forPrompt(req.user.id).catch(() => '');
  const where = await Views.current(req.user.id).catch(() => ({ working_for: null }));
  const standing = where.working_for
    ? '\n\nYOU ARE IN ' + String(where.owner_name || 'somebody else').toUpperCase() + '\u2019S TEAM RIGHT NOW. '
      + 'This person was added to their business and can only do what they were allowed. Their own '
      + 'businesses are not part of this conversation, and what happens here counts against '
      + (where.owner_name || 'that owner') + '\u2019s plan.'
    : '';

  const events = [];
  let out;
  try {
    out = await agent.runChat({
      messages: scrubbed.messages,
      executors: buildExecutors(req.user),
      allowTools: WORKSPACE_TOOLS,
      systemOverride: PENNY_WORKSPACE + told + standing,
      assistantName: 'Penny',
      maxSteps: 12,
      viewer: { role: req.user.role, name: req.user.name },
      onEvent: (ev) => {
        events.push(ev);
        // Only what a person would want said aloud. 'thinking' carries step numbers, which are for
        // a log, not for somebody waiting.
        if (ev.type === 'tool_start' && ev.note) sse('working', { say: ev.note });
        if (ev.type === 'tool_done') {
          sse('worked', { tool: ev.tool, ok: ev.ok, say: ev.ok ? null : 'That one did not work: ' + (ev.note || 'no reason given') });
        }
      },
    });
  } catch (err) {
    sse('reply', { say: 'I could not think that through just now. That is a failure on my side, not '
      + 'an answer, and nothing has been changed.', status: 'unavailable' });
    sse('done', { status: 'unavailable' });
    return res.end();
  }

  if (out.status !== 'unavailable') await Allowance.record(req.user, 'penny_message');

  // Sentence by sentence, in order, so the page can speak each one as it lands.
  for (const line of Voice.sentences(out.reply || '')) sse('say', { say: line });

  sse('done', {
    status: out.status,
    reply: out.reply,
    tools_used: events.filter((x) => x.type === 'tool_done').map((x) => ({ tool: x.tool, ok: x.ok, note: x.note })),
    keys_removed: scrubbed.found.length ? scrubbed.messages.filter((m) => m.role === 'user').map((m) => m.content) : null,
    awaiting_confirmation: out.confirmation
      ? { tool: out.confirmation.tool, params: out.confirmation.params,
        ask: (spine.TOOLS[out.confirmation.tool] && spine.TOOLS[out.confirmation.tool].ask) || out.confirmation.reason }
      : null,
  });
  res.end();
}));

router.post('/chat', authenticate, [
  body('messages').isArray({ min: 1 }).withMessage('Say something first.'),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) throw new ApiError(400, errs.array()[0].msg);

  // KEYS NEVER REACH THE MODEL. Every message is scrubbed before anything else sees it, including
  // earlier turns the browser resends. A key the person just pasted is checked and stored in Keys
  // when there is exactly one business it can belong to; either way they are told what happened.
  const scrubbed = Keys.scrub(req.body.messages);
  let keyNote = null;
  if (scrubbed.found.length) {
    try { keyNote = await Keys.takeFromChat(req.user, scrubbed.found); } catch (e) {
      keyNote = 'I removed a key from our chat, but I could not store it: ' + e.message + ' Add it on the Keys page.';
    }
    scrubbed.messages.push({ role: 'user', content: '[Note from the system, not the person: a key was '
      + 'removed from this message before you saw it. What happened to it has already been told to the '
      + 'person. Do not ask them to paste it again; point them to the Keys page if they need to add one.]' });
  }

  // THE MONTH'S ALLOWANCE. Checked before the model is asked anything; counted only if she answered.
  const allowed = await Allowance.check(req.user, 'penny_message');
  if (!allowed.ok) {
    return res.json({ reply: (keyNote ? keyNote + '\n\n' : '') + allowed.says, status: 'refused',
      allowance: 'used_up', tools_used: [], keys_removed: null, awaiting_confirmation: null });
  }

  const told = await Notes.forPrompt(req.user.id).catch(() => '');
  const where = await Views.current(req.user.id).catch(() => ({ working_for: null }));
  const standing = where.working_for
    ? '\n\nYOU ARE IN ' + String(where.owner_name || 'somebody else').toUpperCase() + '\u2019S TEAM RIGHT NOW. '
      + 'This person was added to their business and can only do what they were allowed. Their own '
      + 'businesses are not part of this conversation, and what happens here counts against '
      + (where.owner_name || 'that owner') + '\u2019s plan.'
    : '';

  const events = [];
  let out;
  try {
    out = await agent.runChat({
      messages: scrubbed.messages,
      executors: buildExecutors(req.user),
      allowTools: WORKSPACE_TOOLS,
      systemOverride: PENNY_WORKSPACE + told + standing,
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

  let low = null;
  if (out.status !== 'unavailable') {
    await Allowance.record(req.user, 'penny_message');
    if (!allowed.unread) low = Allowance.lowNote(await Allowance.status(req.user, 'penny_message').catch(() => null));
  }

  res.json({
    reply: (keyNote ? keyNote + (out.reply ? '\n\n' + out.reply : '') : out.reply) + (low ? '\n\n' + low : ''),
    // Which of the person's messages had a key taken out, so the page can replace its own copy.
    keys_removed: scrubbed.found.length
      ? scrubbed.messages.filter((m) => m.role === 'user').map((m) => m.content) : null,
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
