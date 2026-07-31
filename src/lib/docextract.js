'use strict';
// Reading text out of PDFs and Word (.docx) documents for Clay.
//
// Both parsers are OPTIONAL requires: if a library isn't installed (or fails to load in some
// environment), the app still boots and the file is honestly reported as unreadable rather
// than crashing. And we never fabricate: a PDF with no text layer (a scan / image-only PDF)
// returns ok:false with reason 'no_text_layer' so Clay says it couldn't read it instead of
// inventing contents.

let pdfParse = null;
try { pdfParse = require('pdf-parse'); } catch (_) { pdfParse = null; }
let mammoth = null;
try { mammoth = require('mammoth'); } catch (_) { mammoth = null; }

const MAX_CHARS = 24000;
function cap(s) {
  s = String(s || '');
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + '\n…[truncated]' : s;
}

async function extractPdf(buf) {
  if (!pdfParse) return { ok: false, reason: 'no_parser' };
  try {
    const data = await pdfParse(buf);
    const text = (data && data.text ? data.text : '').replace(/\u0000/g, '').trim();
    if (!text) return { ok: false, reason: 'no_text_layer' }; // likely a scanned/image PDF
    return { ok: true, text: cap(text) };
  } catch (_) {
    return { ok: false, reason: 'error' };
  }
}

async function extractDocx(buf) {
  if (!mammoth) return { ok: false, reason: 'no_parser' };
  try {
    const out = await mammoth.extractRawText({ buffer: buf });
    const text = (out && out.value ? out.value : '').trim();
    if (!text) return { ok: false, reason: 'empty' };
    return { ok: true, text: cap(text) };
  } catch (_) {
    return { ok: false, reason: 'error' };
  }
}

module.exports = { extractPdf, extractDocx, hasPdf: !!pdfParse, hasDocx: !!mammoth };
