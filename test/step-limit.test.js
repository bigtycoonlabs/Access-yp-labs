'use strict';
// RUNNING OUT OF STEPS IS NOT AN ANSWER.
//
// Found by walking production. Somebody asked Clay to build their project and got:
//
//   "Clay reached its step limit for this turn. Ask me to continue."
//
// It was the last thing in their Laboratory. It names nothing that happened, admits nothing that did
// not, uses a phrase that means nothing outside this codebase, and hands the person an instruction
// they have to work out for themselves.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const agent = fs.readFileSync('src/services/clay/agent.js', 'utf8');

test('a turn that ran out of room is not reported as answered', () => {
  // The serious one. The honesty audit downstream reads this status, so a turn that ran out of room
  // must never be able to back a completion claim.
  assert.match(agent, /status: 'incomplete'/);
  assert.ok(!/reply: 'Clay reached its step limit/.test(agent));
});

test('it says what got done, so the person knows whether to redo or resume', () => {
  // Without this they cannot tell if half their project exists.
  assert.match(agent, /const did = Array\.from\(backedActions\);/);
  assert.match(agent, /I did get this far: ' \+ did\.join\(', '\)/);
  // And when nothing was saved it says that plainly, rather than leaving them to wonder.
  assert.match(agent, /I have not saved anything yet, so nothing is half-finished/);
});

test('it speaks like a person, and the way back is a sentence not a command', () => {
  assert.match(agent, /more work than fits in one go, so I stopped partway rather than/);
  assert.match(agent, /Say "keep going" and I will pick up exactly where I left off/);
  assert.ok(!/step limit/i.test(agent.replace(/^\s*\/\/.*$/gm, ' ')), 'no jargon in the reply');
});

test('how many steps a turn used is recorded, so the number stops being a guess', () => {
  // The budget was 6 for every caller and nobody knew whether that was generous or nowhere near
  // enough, because it was never measured. Guessing twice is how this stays broken.
  assert.match(agent, /let stepsUsed = 0;/);
  assert.match(agent, /stepsUsed = step \+ 1;/);
  assert.match(agent, /stepsUsed,\s*\n\s*maxSteps,/);
});
