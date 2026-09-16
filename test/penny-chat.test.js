'use strict';
// PENNY'S CONVERSATION SURFACE.
//
// Walked over real HTTP with no model key in the environment, which is the condition that matters
// most: the degraded path is the one nobody tests and the one a person actually hits.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const route = fs.readFileSync('src/routes/penny.js', 'utf8');
const persona = fs.readFileSync('src/services/clay/penny.js', 'utf8');
const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');
const { PENNY_WORKSPACE, WORKSPACE_TOOLS } = require('../src/services/clay/penny');

test('Penny is a persona and a tool set, not a fork of the agent', () => {
  // Forking would mean two places to fix every safety rule, and the second would drift.
  assert.match(persona, /Not a new agent\. The same runChat, the same planner, the same confirmation gate/);
  assert.match(route, /systemOverride: PENNY_WORKSPACE/);
  assert.match(route, /allowTools: WORKSPACE_TOOLS/);
});

test('she carries only the workspace tools', () => {
  // The concept and marketplace tools belong to a product being retired. Sending their schemas
  // spends the token budget describing work this person cannot do, and a real 429 followed that
  // mistake on Access Your Place: 75 schemas were ~10,700 tokens against a 30,000/minute limit.
  // Pinned deliberately rather than loosely: this list is the token budget. Adding to it is a
  // decision, and this assertion is where that decision has to be made on purpose.
  assert.deepStrictEqual(WORKSPACE_TOOLS,
    ['whats_due', 'whats_coming', 'list_businesses', 'record_obligation', 'complete_obligation',
      'whats_missing', 'whats_outstanding_with_customers', 'start_build', 'list_builds', 'list_files']);
  // Comment text wraps, so normalise the line breaks rather than guessing where they fall.
  const flat = persona.replace(/\s*\n\s*\/\/\s*/g, ' ');
  assert.match(flat, /A real 429 followed that mistake on Access Your Place/);
});

test('the route reads the shape runChat actually returns', () => {
  // The first version read out.text, out.stoppedEarly and out.pending. None exist. runChat returns
  // { status, reply, messages } and surfaces a confirmation as status 'confirmation_required'.
  assert.match(route, /reply: out\.reply/);
  assert.match(route, /status: out\.status/);
  assert.match(route, /out\.confirmation/);
  // Checked against the CODE rather than the file. The first version of this assertion failed on the
  // comment above, which names the three fields in order to explain why they are gone — a test that
  // cannot tell commentary from behaviour will either fail honest documentation or pass a real
  // regression, and both are worse than the check it was meant to be.
  const code = route.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/out\.text|out\.stoppedEarly|out\.pending/.test(code));
});

test('tools_used is read from the events the agent emits', () => {
  // tool_done carries { tool, ok, note }. If Penny's prose and this list disagree, the list is true.
  assert.match(route, /e\.type === 'tool_done'/);
  assert.match(route, /tool: e\.tool, ok: e\.ok, note: e\.note/);
});

test('a degraded turn speaks in her voice, not the retired product\u2019s', () => {
  // Walked with no model key: the reply was "Clay could not run just now... your idea is saved
  // exactly as you wrote it" — to somebody who had asked what they owe. Right shape, wrong product,
  // wrong assistant, and reassurance about something they never mentioned.
  assert.match(agent, /function unavailableLine\(assistantName\)/);
  assert.match(route, /assistantName: 'Penny'/);
  // And the honest part survived the rewrite.
  assert.match(agent, /nothing happened and nothing was invented/);
});

test('the fix covers the guard that actually fires', () => {
  // Seven copies of that sentence existed. I fixed one, re-walked, and nothing changed — because the
  // guard that fires when there is no model key at all was a different copy from the one I edited.
  assert.match(agent, /seven copies is how the first fix changed nothing/);
  assert.strictEqual((agent.match(/unavailableLine\(assistantName\)/g) || []).length, 3);
  assert.ok(!/reply: 'Clay could not run just now/.test(agent));
});

test('an unreachable model is never a blank considered answer', () => {
  assert.match(route, /that is a failure on my side, not an answer/);
  assert.match(route, /Nothing has been changed/);
});

test('confirm is its own request, and still goes through the planner', () => {
  // A confirmation is a decision, and a decision should not be a flag buried in a message. Walked:
  // a bad enum was rejected with the allowed values even though confirmed was set.
  assert.match(route, /router\.post\('\/confirm'/);
  assert.match(route, /planToolInvocation\(req\.body\.tool, req\.body\.params, \{ confirmed: true \}\)/);
  assert.match(route, /The gate is not bypassed by having asked/);
});

test('confirm refuses tools outside the workspace set', () => {
  // Walked: delete_concept came back "That is not something I can do here."
  assert.match(route, /if \(!WORKSPACE_TOOLS\.includes\(req\.body\.tool\)\)/);
});

test('permissions are decided against the viewer, never a client-supplied role', () => {
  // Walked as the bookkeeper: record_obligation for a filing came back refused, with the sentence.
  assert.match(route, /never against a role passed in from the client/);
  assert.match(route, /fn\(\{ id: user\.id, name: user\.name \}, params \|\| \{\}\)/);
});

test('money goes to Arbo and she does not relay his answers', () => {
  assert.match(PENNY_WORKSPACE, /Invoicing, books, cash flow, payments/);
  assert.match(PENNY_WORKSPACE, /you do not repeat his answers as your own/);
});

test('the persona forbids the failures this estate has actually had', () => {
  assert.match(PENNY_WORKSPACE, /Never invent a figure/);
  assert.match(PENNY_WORKSPACE, /report what the tool says it\s*\nsaved/);
  assert.match(PENNY_WORKSPACE, /"Nothing is due" and "I could not check" are different/);
  assert.match(PENNY_WORKSPACE, /Never agree to do something and then not do it/);
  assert.match(PENNY_WORKSPACE, /whether it is known or an estimate/);
});

test('the route is mounted', () => {
  assert.match(server, /app\.use\('\/api\/penny'/);
});
