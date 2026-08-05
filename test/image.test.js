'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const image = require('../src/services/image');

const KEYS = ['IMAGE_API_KEY', 'IMAGE_API_URL', 'IMAGE_MODEL', 'IMAGE_WIDTH', 'IMAGE_HEIGHT',
  'IMAGE_STEPS', 'IMAGE_N', 'IMAGE_RESPONSE_FORMAT', 'IMAGE_SIZE', 'OPENAI_API_KEY',
  'OPENAI_IMAGE_MODEL', 'IMAGE_OPENAI_FALLBACK'];
function withEnv(overrides, fn) {
  const saved = {};
  KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.entries(overrides).forEach(([k, v]) => { process.env[k] = v; });
  try { return fn(); } finally {
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
}

test('dedicated provider body: only prompt when nothing extra is set (backward compatible)', () => {
  withEnv({}, () => {
    assert.deepStrictEqual(image._requestBody('a calm mountain'), { prompt: 'a calm mountain' });
  });
});

test('dedicated provider body: builds the Together/FLUX shape when its env is set', () => {
  withEnv({ IMAGE_MODEL: 'black-forest-labs/FLUX.1-schnell-Free', IMAGE_WIDTH: '1024', IMAGE_HEIGHT: '768', IMAGE_STEPS: '4', IMAGE_RESPONSE_FORMAT: 'b64_json' }, () => {
    const b = image._requestBody('x');
    assert.strictEqual(b.model, 'black-forest-labs/FLUX.1-schnell-Free');
    assert.strictEqual(b.width, 1024);
    assert.strictEqual(b.steps, 4);
    assert.strictEqual(b.response_format, 'b64_json');
  });
});

test('OpenAI fallback body: dall-e-3 gets size + b64_json + n:1', () => {
  const b = image._openaiBody('a logo', 'dall-e-3');
  assert.strictEqual(b.model, 'dall-e-3');
  assert.strictEqual(b.n, 1);
  assert.strictEqual(b.size, '1024x1024');
  assert.strictEqual(b.response_format, 'b64_json');
});

test('OpenAI fallback body: gpt-image models never get response_format (they reject it)', () => {
  const b = image._openaiBody('a logo', 'gpt-image-1');
  assert.ok(!('response_format' in b));
  assert.strictEqual(b.size, '1024x1024');
});

test('configured(): true from the OpenAI brain key alone (no dedicated provider needed)', () => {
  withEnv({ OPENAI_API_KEY: 'sk-test' }, () => {
    assert.strictEqual(image.configured(), true);
    assert.strictEqual(image.activeMode(), 'openai');
    assert.strictEqual(image.activeModel(), 'dall-e-3');
  });
});

test('configured(): false when the OpenAI fallback is switched off and no dedicated provider', () => {
  withEnv({ OPENAI_API_KEY: 'sk-test', IMAGE_OPENAI_FALLBACK: '0' }, () => {
    assert.strictEqual(image.configured(), false);
    assert.strictEqual(image.activeMode(), null);
  });
});

test('dedicated provider wins over the OpenAI fallback when both are present', () => {
  withEnv({ IMAGE_API_KEY: 'k', IMAGE_API_URL: 'https://api.together.xyz/v1/images/generations', OPENAI_API_KEY: 'sk-test' }, () => {
    assert.strictEqual(image.activeMode(), 'dedicated');
    assert.strictEqual(image.providerHost(), 'api.together.xyz');
  });
});
