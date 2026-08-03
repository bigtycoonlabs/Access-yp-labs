const { test } = require('node:test');
const assert = require('node:assert');
const storage = require('../src/services/storage');

test('extFor maps media types to file extensions', () => {
  assert.strictEqual(storage.extFor('image/png'), 'png');
  assert.strictEqual(storage.extFor('image/jpeg'), 'jpg');
  assert.strictEqual(storage.extFor('image/webp'), 'webp');
  assert.strictEqual(storage.extFor(undefined), 'png'); // sensible default
});

test('keyFor namespaces by concept id and uses the right extension', () => {
  assert.match(storage.keyFor('abc-123', 'image/webp'), /^abc-123\/\d+-[a-z0-9]+\.webp$/);
  assert.match(storage.keyFor('c1', 'image/png'), /^c1\/\d+-[a-z0-9]+\.png$/);
});

test('publicUrl targets the public bucket path; unconfigured by default', () => {
  assert.match(storage.publicUrl('abc/def.png'), /\/storage\/v1\/object\/public\/concept-images\/abc\/def\.png$/);
  assert.strictEqual(storage.configured(), false); // no SUPABASE_URL / key in the test env
});
