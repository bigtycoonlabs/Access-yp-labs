'use strict';
// THE CONFIRMATION READ CLAY'S INSTRUCTIONS TO THE BUILDER.
//
// Walked on a real production account. Asked Clay to build, and this is verbatim what came back as
// the thing to approve:
//
//   "Shape a full project package with Clay. Only call this once you actually understand the idea —
//    never on a raw one-liner you have not pressure-tested with a sharpening question or two first,
//    unless the person clearly says to just build it. The person is ALWAYS asked to approve before
//    the build starts, so calling this is a PROPOSAL, not the act itself — say what you understood
//    and what you are about to build, and let them say go."
//
// That is `tool.summary`: prompt-engineering written TO CLAY, in the second person, about when he
// may call a tool. shouldAsk() handed it straight to the person as the sentence they approve.
//
// It lands at the single most important moment in the product — the moment somebody says yes to
// something — and it lands hardest on the people this platform is built for: a sighted user might
// squint past it, but through VoiceOver it is a paragraph of instructions addressed to somebody
// else, arriving exactly when a decision is being asked for.
//
// Two audiences, two strings. `ask` is for the person; `summary` stays for the model.

const { test } = require('node:test');
const assert = require('node:assert');
const spine = require('../src/services/clay/spine');

const STOPPERS = Object.entries(spine.TOOLS)
  .filter(([, t]) => t.requires_confirmation || t.irreversible);

test('every tool that stops to ask has a sentence written for a person', () => {
  assert.ok(STOPPERS.length >= 12);
  for (const [name, tool] of STOPPERS) {
    assert.ok(tool.ask && tool.ask.length > 20, name + ' needs human-facing confirmation text');
  }
});

test('the confirmation never addresses Clay instead of the builder', () => {
  // The tell: instructions to the model. "Only call this", "never call", "the person", "Clay will".
  // A person being asked to approve something is not "the person" in their own confirmation.
  const MODEL_TALK = /\b(only call|never call|call this|do not call|the person is|clay will|clay must|you have not pressure-tested|tool)\b/i;
  for (const [name, tool] of STOPPERS) {
    assert.ok(!MODEL_TALK.test(tool.ask), name + ': confirmation reads like an instruction to Clay');
  }
});

test('what a person is asked comes from ask, not from summary', () => {
  const r = spine.shouldAsk('generate_concept', { prompt: 'a bike repair round' });
  assert.strictEqual(r.ask, true);
  assert.strictEqual(r.reason, spine.TOOLS.generate_concept.ask);
  assert.ok(!/pressure-tested/.test(r.reason));
});

test('the irreversible ones say what it costs and whether it can be undone', () => {
  // Somebody approving a purchase or a delete deserves the consequence in the sentence, not in a
  // screen they may never see.
  assert.match(spine.TOOLS.purchase_concept.ask, /spends real money/);
  assert.match(spine.TOOLS.remove_concept.ask, /cannot be undone/);
  assert.match(spine.TOOLS.clear_memory.ask, /cannot be undone/);
  assert.match(spine.TOOLS.list_on_marketplace.ask, /20%/);
});

test('a missing detail says plainly that nothing has happened', () => {
  const r = spine.shouldAsk('purchase_concept', {});
  assert.strictEqual(r.ask, true);
  assert.match(r.reason, /Nothing has happened yet/);
});

test('irreversible tools still stop even if nobody marked them requires_confirmation', () => {
  // The old condition only checked requires_confirmation, so an irreversible tool with all its
  // params and that flag unset would have run without asking. Belt and braces on the money path.
  for (const [name, tool] of STOPPERS) {
    if (!tool.irreversible) continue;
    const params = {};
    for (const k of (tool.required || [])) params[k] = 'x';
    assert.strictEqual(spine.shouldAsk(name, params).ask, true, name + ' must always ask');
  }
});
