'use strict';
// Found 16 Sept 2026 while testing compliance research through Penny.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const P = require('../src/services/clay/provider');

test('tool calls are never written into Penny\'s own words, so she cannot copy them', () => {
  const input = P.toResponsesInput([
    { role: 'user', content: 'Is it done?' },
    { role: 'assistant', text: '', tool_calls: [{ id: 't1', name: 'research_compliance', input: { action: 'status' } }] },
    { role: 'tool', tool_call_id: 't1', content: '{"status":"answered"}' },
  ]);
  assert.deepStrictEqual(input.map((i) => i.role), ['user', 'user']);
  assert.doesNotMatch(JSON.stringify(input), /\[Called/);
  assert.match(input[1].content, /the research_compliance tool, which you used with \{"action":"status"\}/);
  assert.match(input[1].content, /not the person speaking/);
});

test('notes the agent writes as text still reach the model', () => {
  assert.strictEqual(P.userText({ role: 'user', text: 'fix this' }), 'fix this');
  assert.strictEqual(P.userText({ role: 'user', content: 'hello', text: 'x' }), 'hello');
  assert.strictEqual(P.toResponsesInput([{ role: 'user', text: 'fix this' }])[0].content, 'fix this');
  const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
  assert.doesNotMatch(agent, /role: 'user', text:/);
});

test('a reply that is only a written-out tool call is never handed to the person', () => {
  const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');
  assert.match(agent, /\/\^\\\[\?\\s\*Called\\s\+\[a-z_\]\+\\s\*\\\(\/i/);
  assert.match(agent, /I tried to look that up and it did not work/);
});
