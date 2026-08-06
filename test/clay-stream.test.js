'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const agent = flat(fs.readFileSync(require.resolve('../src/services/clay/agent.js'), 'utf8'));
const route = flat(fs.readFileSync(require.resolve('../src/routes/clay.js'), 'utf8'));
const client = flat(fs.readFileSync('public/js/clay-stream.js', 'utf8'));

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

test('the streamed answer comes from the same path as the plain one', () => {
  // Two copies of "what Clay knows" would drift, and streaming would quietly become a different Clay.
  assert.match(route, /async function buildChatContext/);
  const uses = route.split('buildChatContext(req)').length - 1;
  assert.ok(uses >= 2, 'both endpoints build context the same way');
  assert.match(route, /Streaming is a window onto the work, not a different way of working/i);
});

test('the stream says so when it dies, rather than hanging', () => {
  assert.match(route, /Clay stopped partway through and did not finish/);
  assert.match(client, /Clay stopped partway through and did not finish/);
});

test('screen readers are NOT given a firehose', () => {
  // The whole accessibility decision: everything is shown, very little is announced.
  assert.match(client, /aria-live', 'polite'/);
  assert.match(client, /aria-atomic', 'false'/);
  assert.match(client, /QUIET_MS/);
  assert.match(client, /aria-hidden', 'true'/);  // the visual log must not double-announce
  assert.match(client, /announcing each token to a screen reader turns the interface into a firehose/i);
});

test('a failed step interrupts; routine progress does not', () => {
  assert.match(client, /if \(!ev\.ok\) speak\(.*true\)/);
  assert.match(client, /A failure is always worth interrupting for/i);
});

test('there is always a way to stop', () => {
  assert.match(client, /AbortController/);
  assert.match(client, /clay-stop/);
});

test('the first signal is instant, before any work begins', () => {
  // Borrowed from Arbo: silence at the start is the worst moment, especially with no spinner to see.
  assert.match(route, /Instant first phase, sent BEFORE any work starts/i);
  const phaseAt = route.indexOf("send({ type: 'phase', key: 'reading'");
  const workAt = route.indexOf('buildChatContext(req)', phaseAt);
  assert.ok(phaseAt > -1 && phaseAt < workAt, 'the phase is sent before context is built');
});

test('answer pieces are shown but never announced piece by piece', () => {
  assert.match(client, /NEVER announced piece by piece/i);
  assert.match(client, /answerEl\.setAttribute\('aria-hidden', 'true'\)/);
});

test('the pauses are comprehension pacing, not theatre', () => {
  assert.match(route, /COMPREHENSION PACING, not theatre/i);
  assert.match(route, /time to announce one piece before the next arrives/i);
});

test('progress never nests inside an existing live region', () => {
  // The conversation logs are already aria-live. Mounting the stream inside one would make a
  // screen reader announce everything twice — which is the failure this whole design avoids.
  const appHtml = fs.readFileSync('public/app.html', 'utf8');
  const appJs = fs.readFileSync('public/js/app.js', 'utf8');
  const chatHtml = fs.readFileSync('public/clay-chat.html', 'utf8');
  assert.match(appHtml, /id="progress-host"/);
  assert.match(appJs, /streamChat\(chatBody, document\.getElementById\('progress-host'\)/);
  assert.match(chatHtml, /id="progress-host"/);
  assert.match(chatHtml, /getElementById\('progress-host'\)/);
});

test('a streaming failure falls back instead of losing the message', () => {
  const appJs = flat(fs.readFileSync('public/js/app.js', 'utf8'));
  assert.match(appJs, /A transport problem is ours, not theirs/i);
  assert.match(appJs, /Kiln\.api\('\/clay\/chat'/);
});
