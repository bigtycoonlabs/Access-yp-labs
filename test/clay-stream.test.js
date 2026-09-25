'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const agent = flat(fs.readFileSync(require.resolve('../src/services/clay/agent.js'), 'utf8'));

test('a tool failure is streamed as a failure, not swallowed', () => {
  // A progress signal that only ever reports success teaches people to trust something that
  // cannot say no — which is worse than showing nothing at all.
  assert.match(agent, /emit\('tool_done', \{ tool: tc\.name, ok: !failed/);
  assert.match(agent, /only ever reports success is worse than none/i);
});

test('a broken listener cannot break the work it is watching', () => {
  assert.match(agent, /try \{ onEvent\(\{ type, \.\.\.data \}\); \} catch/);
});

test('streaming is optional — existing callers are untouched', () => {
  assert.match(agent, /onEvent = null/);
  assert.match(agent, /every existing caller passes nothing and behaves exactly as before/i);
});
