'use strict';
// THREE THINGS THE OWNER FOUND BY USING IT (17 September 2026).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const W = require('../src/services/clay/workspace');
const S = require('../src/services/clay/standing');

test('the page is allowed to play her voice at all', () => {
  // She was silent twice. The first fix blamed iOS; the real cause was our own content security
  // policy, which had no rule for audio, so the browser refused both the blob her voice arrives in
  // and the moment of silence that wakes the player.
  const server = fs.readFileSync('src/server.js', 'utf8').replace(/\/\//g, ' ').replace(/\s+/g, ' ');
  assert.match(server, /mediaSrc: \["'self'", 'blob:', 'data:'\]/);
  assert.match(server, /she\s*was silent with no error a person could see/);
});

test('what she is doing sits behind her answer, never in front of it', () => {
  const js = fs.readFileSync('public/js/penny-voice.js', 'utf8');
  assert.match(js, /WHAT SHE IS DOING GOES BEHIND HER ANSWER, NEVER IN FRONT OF IT/);
  assert.match(js, /progress\(body, ev\.say\)/);
  assert.match(js, /note\.textContent = 'Working: ' \+ text/);
  // And it is gone the moment her words start.
  assert.match(js, /\} else if \(ev\.type === 'say' && ev\.say\) \{\s*\n\s*clearProgress\(\);/);
  assert.doesNotMatch(js, /body\.textContent = ev\.say/, 'progress must never be written as the reply');
});

test('she can take a business out of the workspace, with a yes, and erases nothing', () => {
  assert.strictEqual(W.TOOLS.remove_business.requires_confirmation, true);
  assert.ok(!S.UNATTENDED_TOOLS().includes('remove_business'), 'never on a schedule');
  assert.ok(W.TOOLS.remove_business.ask.includes('nothing it owed is erased'));
  const src = fs.readFileSync('src/services/clay/workspace.js', 'utf8')
    .replace(/\/\//g, ' ').replace(/'\s*\+\s*'/g, '').replace(/\s+/g, ' ');
  assert.match(src, /a teammate with full access to a business still does not get to remove it/);
  assert.match(src, /SET archived_at=now\(\)/, 'archived, not deleted');
  assert.match(src, /Nothing it owed has been erased/);
  assert.match(src, /That is not a business you own, so I have not touched it/);
});
