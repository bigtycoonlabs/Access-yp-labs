'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const conv = fs.readFileSync(require.resolve('../src/services/clay/conversations.js'), 'utf8');
const next = fs.readFileSync(require.resolve('../src/services/clay/nextStep.js'), 'utf8');
const agent = fs.readFileSync(require.resolve('../src/services/clay/agent.js'), 'utf8');
const admin = fs.readFileSync(require.resolve('../src/routes/admin.js'), 'utf8');
const nextStep = require('../src/services/clay/nextStep');

test('recording can never break the conversation', () => {
  // Analytics must not cost someone the thing they came for.
  const fns = ['openSession', 'recordTurn', 'forgetMine'];
  fns.forEach((fn) => {
    const start = conv.indexOf('async function ' + fn);
    assert.ok(start > -1, fn + ' exists');
    assert.match(conv.slice(start, start + 1600), /catch \(e\)/, fn + ' must swallow its own errors');
  });
  assert.match(flat(conv), /RECORDING NEVER BREAKS THE CONVERSATION/i);
});

test('staff see shape, never message content', () => {
  // A chat log is among the most sensitive things a platform holds, and "we need the data" is
  // exactly the argument that erodes that.
  assert.match(admin, /where-people-stop/);
  assert.ok(!/clay_messages[\s\S]{0,200}content/.test(admin), 'no route exposes message content');
  assert.match(flat(admin), /never what somebody actually wrote/i);
});

test('a creator can erase their own history for real', () => {
  assert.match(conv, /DELETE FROM clay_sessions WHERE user_id = \$1/);
  const clay = fs.readFileSync(require.resolve('../src/routes/clay.js'), 'utf8');
  assert.match(clay, /router\.delete\('\/history'/);
  assert.match(clay, /gone, not hidden/);
});

test('a returning conversation is the same conversation', () => {
  // Someone stepping away to think is not a new visit; counting it as one would make the numbers
  // say people bounce when they are actually working.
  assert.match(conv, /last_at > now\(\) - interval '60 minutes'/);
});

test('every lane has ONE action, not a list', () => {
  // A list is a way of saying "good luck".
  Object.values(nextStep.NEXT_STEP).forEach((s) => {
    assert.ok(s.ask && s.how && s.reply);
    assert.ok(!/\n\s*[-*]/.test(s.ask), 'the ask is a single action');
  });
  // The instruction lives in Clay's own guidance, which is where it has to hold.
  assert.match(flat(agent), /a list is a way of saying "good luck"/i);
});

test('the nudge is not marked sent when the email failed', () => {
  // Marking it would burn the ONE message this project ever gets on an email nobody received.
  assert.match(next, /if \(!out \|\| !out\.sent\)/);
  const mark = next.indexOf('UPDATE concepts SET nudged_at');
  const guard = next.indexOf('if (!out || !out.sent)');
  assert.ok(guard > -1 && guard < mark, 'the failure check runs before the record is marked');
});

test('Clay ends a build with an action, not a summary', () => {
  assert.match(flat(agent), /THE MOMENT AFTER YOU BUILD SOMETHING IS WHERE PEOPLE ARE LOST/i);
  assert.match(flat(agent), /MORE MATERIAL IS NOT THE ANSWER when someone is stuck/i);
});
