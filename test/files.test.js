'use strict';
// FILES AND PHOTOS.
//
// Walked 16 Sept 2026 against the real model: a photo, a PDF, a text file and an HTML page named
// .pdf were uploaded together. The photo was described accurately and labelled as Penny's; the HTML
// was refused by name; a share link opened signed out inside a sandbox, counted its open, and
// returned 404 once stopped; a deleted file's link died with it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const F = require('../src/services/clay/files');

const jpg = Buffer.from('ffd8ffe000104a464946000101', 'hex');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

test('the type comes from the bytes, not the name', () => {
  assert.strictEqual(F.sniff(jpg, 'contract.pdf').mime, 'image/jpeg');
  assert.strictEqual(F.sniff(png, 'x').kind, 'photo');
  assert.strictEqual(F.sniff(Buffer.from('%PDF-1.4\n'), 'a.jpg').mime, 'application/pdf');
  assert.strictEqual(F.sniff(Buffer.from('a,b\n1,2\n'), 'sheet.csv').kind, 'spreadsheet');
  assert.strictEqual(F.sniff(Buffer.from('Gate code 4471\n'), 'n.txt').mime, 'text/plain');
});

test('anything a browser would run is refused, whatever it is called', () => {
  assert.match(F.sniff(Buffer.from('<html><script>x</script>'), 'lease.pdf').refused, /can run code/);
  assert.match(F.sniff(Buffer.from('<svg onload="x"/>'), 'logo.png').refused, /can run code/);
  assert.match(F.sniff(Buffer.from('<?xml version="1.0"?><svg/>'), 'a.txt').refused, /can run code/);
  assert.match(F.sniff(Buffer.from('4d5a900003', 'hex'), 'invoice.pdf').refused, /program/);
  assert.match(F.sniff(Buffer.from('#!/bin/sh\nrm -rf /'), 'notes.txt').refused, /program/);
  assert.match(F.sniff(Buffer.from([0, 1, 2, 3, 250, 251, 252]), 'x').refused, /could not tell/);
});

test('names are cleaned and keep the real extension', () => {
  assert.strictEqual(F.cleanName('../../etc/passwd', 'txt'), '.. .. etc passwd.txt');
  assert.strictEqual(F.cleanName('roof.png', 'jpg'), 'roof.jpg');
  assert.strictEqual(F.cleanName('', 'pdf'), 'file.pdf');
});

test('the summary counts photos without descriptions and open links', () => {
  assert.match(F.summarise([]), /^No files yet/);
  assert.strictEqual(F.summarise([
    { kind: 'photo', description: null, shares: [] },
    { kind: 'photo', description: 'x', shares: [{}] },
    { kind: 'document', shares: [] },
  ]), '3 files, 2 of them photos. One photo has no description yet. One is shared by a link that is still open.');
});

test('the database makes a share end, and says who described a photo', () => {
  const sql = fs.readFileSync('docs/migrations/063_files.sql', 'utf8').replace(/\s+/g, ' ');
  assert.match(sql, /expires_at <= created_at \+ interval '30 days 1 minute'/);
  assert.match(sql, /\(description IS NULL\) = \(description_by IS NULL\)/);
  assert.match(sql, /bytes <= 10485760/);
  const order = fs.readFileSync('docs/migrations/ORDER.txt', 'utf8');
  assert.ok(order.indexOf('063_files.sql') > order.indexOf('062_builds_mock_is_a_choice.sql'));
});

test('stored files are never rendered as a page on our origin', () => {
  const r = fs.readFileSync('src/routes/files.js', 'utf8');
  assert.match(r, /'Content-Security-Policy': "sandbox;/);
  assert.match(r, /const inline = f\.kind === 'photo'/);
  assert.match(r, /'X-Content-Type-Options': 'nosniff'/);
});

test('a share lasts at most 30 days, checked before anything is read', async () => {
  const r = await F.share({ id: 'u' }, 'not-even-a-file', { days: 90 });
  assert.strictEqual(r.ok, false);
  assert.match(r.says, /up to 30 days/);
});

test('the screen is reachable from Today and signs its requests', () => {
  const today = fs.readFileSync('public/today.html', 'utf8');
  assert.match(today, /href="\/files\.html"/);
  const page = fs.readFileSync('public/files.html', 'utf8');
  assert.ok(page.indexOf('/js/desk-auth.js') < page.indexOf('<script>\nvar $'));
  const server = fs.readFileSync('src/server.js', 'utf8');
  assert.match(server, /imgSrc: \["'self'", 'data:', 'blob:', 'https:'\]/);
});
