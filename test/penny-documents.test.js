'use strict';
// PENNY WRITING THINGS DOWN (17 September 2026). The owner's point: she should not have to hold
// everything in her head. What is worth keeping goes into the business's own documents, where the
// person can read it, share it or delete it — not a private store only she can see.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const W = require('../src/services/clay/workspace');

test('she can write a document and read one back', () => {
  assert.deepStrictEqual(W.TOOLS.write_document.required, ['business_id', 'name', 'text']);
  assert.deepStrictEqual(W.TOOLS.read_document.required, ['file_id']);
  for (const t of ['write_document', 'read_document']) {
    assert.ok(W.TOOLS[t].summary.length < 1024, t);
    assert.strictEqual(typeof W.EXECUTORS[t], 'function', t);
  }
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8');
  assert.match(penny, /'write_document',/);
  assert.match(penny, /'read_document',/);
});

test('what she writes is an ordinary document of theirs, under the same rules', () => {
  const files = fs.readFileSync('src/services/clay/files.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(files, /It goes through the same upload as a file a person drops in/);
  assert.match(files, /const r = await upload\(viewer, \{/, 'one way in, so one set of rules');
  assert.match(files, /It is not a hidden store she alone can see/);
});

test('she will not pretend to read what she cannot', () => {
  const files = fs.readFileSync('src/services/clay/files.js', 'utf8');
  assert.match(files, /const READABLE = /);
  assert.match(files, /which I cannot read as words/);
  assert.match(files, /pretending otherwise would put invented contents into a conversation/);
  // A long document says it was cut rather than answering from half of it silently.
  assert.match(files, /it is longer than I read in one go/);
});

test('long things belong in a document, not in what she was told', () => {
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(penny, /Read it back with read_document when you need it instead of answering from memory/);
  assert.match(penny, /anything longer belongs in a document/);
});
