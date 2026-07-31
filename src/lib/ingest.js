'use strict';
// Turning an uploaded file into something Clay can actually use.
//
// Two honest rules run through this whole module:
//   1. We only ever READ files as data. Code is treated as text to understand — never run.
//   2. We never pretend to have read something we couldn't. A file that is neither text nor
//      image is recorded as a real attachment but marked unreadable, so Clay can acknowledge
//      it exists instead of inventing its contents.

const MAX_TEXT_CHARS = 24000;          // per-file cap on stored/used text
const MAX_TOTAL_INJECT_CHARS = 40000;  // cap on everything fed into a single build

// Extensions we can read as text. Broad on purpose — the founder wants "any file type",
// and the content sniffing below is the real gate; this just helps label kind.
const CODE_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c',
  'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'html', 'htm', 'css',
  'scss', 'sass', 'less', 'vue', 'svelte', 'ini', 'env', 'conf', 'cfg', 'dockerfile',
  'makefile', 'gradle', 'r', 'lua', 'pl', 'dart', 'ex', 'exs', 'erl', 'clj', 'scala', 'vb',
  'ps1', 'bat', 'gd', 'sol', 'proto', 'graphql', 'gql',
]);
const DATA_EXT = new Set(['json', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'toml']);
const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'text', 'rtf', 'log']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tiff', 'tif', 'avif']);
const IMAGE_MIME = /^image\//i;

function ext(filename) {
  const base = String(filename || '').toLowerCase();
  const m = base.match(/\.([a-z0-9]+)$/i);
  if (m) return m[1];
  if (base === 'dockerfile' || base === 'makefile') return base; // extension-less well-knowns
  return '';
}

// Heuristic: does this buffer look like human-readable text (so we can read it directly)?
// A NUL byte, or a high share of odd control bytes, means treat it as binary. Deliberately
// conservative — better to honestly mark something unreadable than to feed Clay garbage.
function isProbablyText(buf) {
  if (!buf || !buf.length) return false;
  const n = Math.min(buf.length, 8192);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false; // NUL => binary
    // control chars other than tab(9) newline(10) vtab(11) formfeed(12) return(13) esc(27)
    if ((b < 9 || (b > 13 && b < 32)) && b !== 27) suspicious++;
  }
  return suspicious / n < 0.10;
}

// Decide what kind of file this is, using mime, extension, and content sniffing together.
function classify(filename, mimeType, buf) {
  const e = ext(filename);
  const mime = String(mimeType || '').toLowerCase();
  if (IMAGE_MIME.test(mime) || IMAGE_EXT.has(e)) return 'image';
  if (!isProbablyText(buf)) return 'binary'; // content is the real gate
  if (DATA_EXT.has(e)) return 'data';
  if (CODE_EXT.has(e)) return 'code';
  if (TEXT_EXT.has(e) || /^text\//.test(mime)) return 'text';
  return 'text'; // decodes cleanly as text but unknown extension -> still readable
}

// Pull readable text out of a text-like buffer, capped and BOM-stripped.
function extractText(buf) {
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); // strip UTF-8 BOM
  if (s.length > MAX_TEXT_CHARS) s = s.slice(0, MAX_TEXT_CHARS) + '\n…[truncated]';
  return s;
}

// A short, speakable line telling the user exactly what happened to one file — this is what
// gets read out over VoiceOver, so it must be honest about what could and couldn't be read.
function outcomeLine(u) {
  if (u.skipped === 'too_large') return `${u.filename} — too large to attach (over 6 MB). Nothing was read.`;
  if (u.skipped === 'batch_too_large') return `${u.filename} — skipped because the whole batch was too large. Try fewer or smaller files.`;
  if (u.skipped === 'empty') return `${u.filename} — appeared empty, so nothing was attached.`;
  if (u.read_status === 'described') return `${u.filename} — read as an image and described for the build.`;
  if (u.read_status === 'read') {
    const c = u.chars ? `, ${Number(u.chars).toLocaleString()} characters` : '';
    return `${u.filename} — read as ${u.kind}${c}.`;
  }
  return `${u.filename} — attached, but its contents couldn't be read, so Clay will note it's there without guessing what's inside.`;
}

module.exports = {
  MAX_TEXT_CHARS, MAX_TOTAL_INJECT_CHARS,
  ext, isProbablyText, classify, extractText, outcomeLine,
};
