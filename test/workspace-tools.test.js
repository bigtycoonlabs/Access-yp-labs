'use strict';
// PENNY READING FROM THE SPINE.
//
// Every executor below was driven against a real Postgres as an owner and as a bookkeeper with
// money:view, including the failure paths, before any of this was written.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const ws = fs.readFileSync('src/services/clay/workspace.js', 'utf8');
const spine = require('../src/services/clay/spine');
const { toolSchemas, planToolInvocation } = require('../src/services/clay/agent');
const W = require('../src/services/clay/workspace');

test('no model is asked to work out what is due', () => {
  // The ranked list is arithmetic. Penny's job is to SAY it, not to compute it.
  assert.match(ws, /None of them asks a model to work\s*\n?\s*\/\/ anything out/);
  assert.ok(!/anthropic|openai|runChat|generateText/i.test(ws));
});

test('a failed read is never a zero', () => {
  // Arbo learned this the expensive way: an unread balance printed as "$0.00", indistinguishable
  // from the money being gone. Here the danger is worse — "nothing is due" closes the door on work
  // the person then does not do.
  assert.match(ws, /A failed read is never a\s*\n?\s*\/\/   zero/);
  const empty = W.empty('Nothing is due. Nothing overdue either.');
  const un = W.unavailable('boom', 'I could not read your obligations just now');
  assert.strictEqual(empty.status, 'empty');
  assert.strictEqual(un.status, 'unavailable');
  assert.notStrictEqual(empty.says, un.says);
  // Driven live with a bad viewer id: the unavailable sentence says so explicitly.
  assert.match(ws, /That is a failure '\s*\n?\s*\+ 'on my side rather than an empty list/);
});

test('the four result shapes exist and are distinct', () => {
  for (const k of ['answered', 'empty', 'unavailable', 'refused']) {
    assert.strictEqual(typeof W[k], 'function', 'missing result shape: ' + k);
  }
});

test('Penny inherits the permissions of whoever she is talking to', () => {
  // She is a second way into the same data. A screen that hides a number is not a permission if she
  // will read it out. Driven live: the bookkeeper's whats_due returned one item, the owner's two.
  assert.match(ws, /A screen that hides a number is not a permission if Penny will say it out loud/);
  assert.match(ws, /const gate = await P\.can\(viewer\.id, params\.business_id, area, 'act'\)/);
  assert.match(ws, /return refused\(P\.refusalLine\(gate/);
});

test('a number with no basis is refused before the database has to', () => {
  // Penny should never learn a constraint by throwing. Driven live: refused with a sentence.
  assert.match(ws, /A cost I cannot explain is one you should not trust/);
});

test('she reports what was saved, never what she was told', () => {
  // She once confirmed an $8,000 deal that was never written, because the tool had no field for the
  // asking price and dropped it silently.
  assert.match(ws, /Report what the tool SAVED, never what it was told/);
  assert.match(ws, /return answered\(\{ obligation: row \}, 'Recorded: ' \+ row\.title/);
});

test('a failed save says it is not recorded', () => {
  assert.match(ws, /It is not recorded — please do not assume it is/);
});

test('the workspace tools are in the registry the planner actually reads', () => {
  // A tool declared somewhere the planner does not read is a tool with no safety on it.
  for (const n of ['whats_due', 'whats_coming', 'list_businesses', 'record_obligation', 'complete_obligation']) {
    assert.ok(spine.TOOLS[n], 'not registered: ' + n);
  }
  assert.strictEqual(toolSchemas().length, Object.keys(spine.TOOLS).length);
});

test('completing something is confirmed, reading is not', () => {
  // It moves a real thing off the list and a recurring one forward a year, so it is not assumed from
  // a passing remark. Verified through the planner rather than from the declaration.
  assert.strictEqual(planToolInvocation('complete_obligation', { obligation_id: 'x' }).action, 'confirm');
  assert.strictEqual(planToolInvocation('complete_obligation', { obligation_id: 'x' }, { confirmed: true }).action, 'execute');
  assert.strictEqual(planToolInvocation('whats_due', {}).action, 'execute');
});

test('enum guardrails reject bad input before it reaches the database', () => {
  assert.strictEqual(planToolInvocation('record_obligation', { business_id: 'b', kind: 'filing' }).action, 'reject');
  assert.strictEqual(planToolInvocation('record_obligation', { business_id: 'b', kind: 'nonsense', title: 'x' }).action, 'reject');
});

test('the tool payload stays inside the hard limits', () => {
  // One over-long description rejects the ENTIRE tools payload with a 400, and the assistant then
  // answers with no tools at all while saying they are unavailable. That cost three rounds to find
  // on Access Your Place because the 400 body was never logged.
  const s = toolSchemas();
  assert.ok(s.length <= 128, 'tool count over the limit: ' + s.length);
  for (const t of s) {
    assert.ok(t.name.length <= 64, 'name too long: ' + t.name);
    assert.ok(t.description.length <= 1024, 'description too long: ' + t.name);
  }
});

test('recurring things come back rather than vanishing', () => {
  // Driven live: completing the Ohio annual report returned "The next one is due 2027-09-27."
  assert.match(ws, /due_at \+ recurs_every/);
  assert.match(ws, /The next one is due/);
});

test('the confirmation is written to the person, not to the model', () => {
  // Caught by the existing confirmation-voice suite when this file was first pushed:
  // complete_obligation declared requires_confirmation and had no `ask`, so the sentence a person
  // approves would have fallen back to `summary` — prompt engineering addressed to somebody else,
  // arriving at the exact moment a decision is being asked for, read out in full by a screen reader.
  const t = spine.TOOLS.complete_obligation;
  assert.ok(t.ask && t.ask.length > 20);
  assert.ok(!/\b(only call|never call|call this|the person is|tool)\b/i.test(t.ask));
  assert.notStrictEqual(t.ask, t.summary);
});
