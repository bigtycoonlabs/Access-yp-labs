'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const image = require('../src/services/image');

const KEYS = ['IMAGE_MODEL', 'IMAGE_WIDTH', 'IMAGE_HEIGHT', 'IMAGE_STEPS', 'IMAGE_N', 'IMAGE_RESPONSE_FORMAT'];
function withEnv(overrides, fn) {
  const saved = {};
  KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.entries(overrides).forEach(([k, v]) => { process.env[k] = v; });
  try { return fn(); } finally {
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
}

test('requestBody sends only the prompt when no optional env is set (backward compatible)', () => {
  withEnv({}, () => {
    assert.deepStrictEqual(image._requestBody('a calm mountain'), { prompt: 'a calm mountain' });
  });
});

test('requestBody builds the Together/FLUX shape when its env vars are set', () => {
  withEnv({
    IMAGE_MODEL: 'black-forest-labs/FLUX.1-schnell-Free',
    IMAGE_WIDTH: '1024', IMAGE_HEIGHT: '768', IMAGE_STEPS: '4', IMAGE_RESPONSE_FORMAT: 'b64_json',
  }, () => {
    const b = image._requestBody('a calm mountain');
    assert.strictEqual(b.model, 'black-forest-labs/FLUX.1-schnell-Free');
    assert.strictEqual(b.width, 1024);
    assert.strictEqual(b.height, 768);
    assert.strictEqual(b.steps, 4);
    assert.strictEqual(b.response_format, 'b64_json');
  });
});

test('non-numeric optional env is ignored, never sent as garbage', () => {
  withEnv({ IMAGE_STEPS: 'lots' }, () => {
    assert.ok(!('steps' in image._requestBody('x')));
  });
});
