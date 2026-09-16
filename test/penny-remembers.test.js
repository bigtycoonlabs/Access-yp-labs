'use strict';
// Found 16 Sept 2026 by metering real turns: the chat page resends Penny's earlier replies as
// { role: 'assistant', content }, and the model layer read only `text`, so every earlier reply was
// dropped and she answered the first question again on every turn.
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../src/services/clay/provider');

const history = [
  { role: 'user', content: 'What do I owe?' },
  { role: 'assistant', content: 'Nothing is overdue.' },
  { role: 'user', content: 'Which builds are ready?' },
];

test('earlier replies sent by the chat page reach the model', () => {
  const input = P.toResponsesInput(history);
  assert.deepStrictEqual(input.map((i) => i.role), ['user', 'assistant', 'user']);
  assert.strictEqual(input[1].content, 'Nothing is overdue.');
});

test('replies the agent writes itself still work, and text wins when both are present', () => {
  assert.strictEqual(P.assistantText({ role: 'assistant', text: 'A', content: 'B' }), 'A');
  assert.strictEqual(P.assistantText({ role: 'assistant', content: 'B' }), 'B');
  assert.strictEqual(P.assistantText({ role: 'assistant', text: '', tool_calls: [] }), '');
});
