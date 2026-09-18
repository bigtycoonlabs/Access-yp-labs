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
  assert.match(files, /const PLAIN = /);
  assert.match(files, /const SHEET = /);
  assert.match(files, /which I cannot read as words yet/);
  assert.match(files, /come back as a guess/);
  // A long document says it was cut rather than answering from half of it silently.
  assert.match(files, /it is longer than I read in one go/);
});

test('long things belong in a document, not in what she was told', () => {
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(penny, /Read it back with read_document when you need it instead of answering from memory/);
  assert.match(penny, /anything longer belongs in a document/);
});

test('she can open a PDF, a spreadsheet, a CSV and a photo', () => {
  const files = fs.readFileSync('src/services/clay/files.js', 'utf8');
  assert.match(files, /require\('pdf-parse'\)/);
  assert.match(files, /require\('xlsx'\)/);
  assert.match(files, /if \(f\.kind === 'photo' \|\| \/\^image\\\//);
  // A photo described when it arrived is not looked at twice for no reason.
  assert.match(files, /if \(f\.description\) return \{ ok: true/);
});

test('a scan with no text says so rather than being guessed at', () => {
  // Collapsed, and with the comment markers taken out: a rule is no less true for being wrapped.
  const files = fs.readFileSync('src/services/clay/files.js', 'utf8').replace(/\/\//g, ' ').replace(/\s+/g, ' ');
  assert.match(files, /That PDF has no text in it/);
  assert.match(files, /not guess at what it says/);
  assert.match(files, /made-up lease clause is worse than no answer/);
  assert.match(files, /I could not open that PDF, so I have not read it/);
});

test('she can make a spreadsheet, and will not make an empty one', () => {
  assert.deepStrictEqual(W.TOOLS.write_spreadsheet.required, ['business_id', 'name', 'rows']);
  assert.deepStrictEqual(W.TOOLS.write_spreadsheet.enums.format, ['xlsx', 'csv']);
  assert.strictEqual(typeof W.EXECUTORS.write_spreadsheet, 'function');
  const files = fs.readFileSync('src/services/clay/files.js', 'utf8');
  assert.match(files, /There were no rows to put in it, so nothing was saved/);
  assert.match(files, /await upload\(viewer, \{ business_id, name: filename/, 'one way in, same rules');
});

test('she is told to read the file rather than answer from its name', () => {
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8').replace(/\s+/g, ' ');
  assert.match(penny, /Read the file before answering a question about what it says; never answer from its name/);
  assert.match(penny, /A scan with no text in it is not something to guess at/);
});
