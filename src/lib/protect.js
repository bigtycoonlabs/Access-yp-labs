// Pre-purchase protection: watermark + obfuscate previews so assets are hard to
// lift before payment, and scan uploaded code for malware signatures.
// Note: this is deterrence + heuristic scanning. For production-grade AV, wire a
// real scanner (ClamAV / an AV API) at scanCode's marked integration point.

const crypto = require('crypto');

function stamp(label) {
  const id = crypto.randomBytes(4).toString('hex');
  return `Access YP Labs preview · ${label || 'watermarked'} · ref ${id} · not for redistribution`;
}

// Text preview: truncate to a fraction and wrap in watermark banners.
function watermarkText(body, label) {
  const text = String(body || '');
  const cut = Math.max(200, Math.floor(text.length * 0.4));
  const shown = text.slice(0, cut);
  const s = stamp(label);
  return `— ${s} —\n\n${shown}${text.length > cut ? '\n\n…(remainder available after purchase)…' : ''}\n\n— ${s} —`;
}

// HTML preview: inject a fixed watermark overlay and a copy/right-click guard.
// (Guards are deterrents, not security; the clean file stays behind the paywall.)
function watermarkHtml(html, label) {
  const s = stamp(label);
  const overlay = `<div style="position:fixed;inset:0;pointer-events:none;z-index:2147483647;
    background:repeating-linear-gradient(45deg,transparent,transparent 140px,rgba(124,45,18,.06) 140px,rgba(124,45,18,.06) 280px);
    font:700 13px system-ui;color:rgba(124,45,18,.55)">
    <div style="position:fixed;bottom:10px;left:10px">${s}</div>
    <div style="position:fixed;top:10px;right:10px">${s}</div></div>`;
  const guard = `<script>document.addEventListener('contextmenu',e=>e.preventDefault());
    document.addEventListener('copy',e=>e.preventDefault());<\/script>`;
  const safe = String(html || '');
  if (/<\/body>/i.test(safe)) return safe.replace(/<\/body>/i, overlay + guard + '</body>');
  return overlay + safe + guard;
}

// Obfuscate a preview payload so it isn't trivially scraped as clean text.
function obfuscate(str) {
  return Buffer.from(String(str || ''), 'utf8').toString('base64');
}

// Heuristic malware/virus scan for code assets. Returns {status, detail}.
const SIGNATURES = [
  [/rm\s+-rf\s+[~/]/i, 'destructive filesystem command'],
  [/:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;/,'fork bomb'],
  [/\beval\s*\(\s*(atob|Buffer\.from|base64)/i, 'obfuscated eval of encoded payload'],
  [/powershell.*-enc(odedcommand)?\b/i, 'encoded PowerShell command'],
  [/(curl|wget)\s+[^|;`]*\|\s*(sudo\s+)?(sh|bash)\b/i, 'pipe-to-shell remote execution'],
  [/child_process[\s\S]{0,40}(exec|spawn)[\s\S]{0,80}(http|curl|wget)/i, 'remote command execution'],
  [/nc\s+-e\b|\/dev\/tcp\//i, 'reverse shell'],
  [/document\.write\(unescape\(/i, 'obfuscated script injection'],
  [/crypto.*(miner|coinhive|xmrig)/i, 'cryptominer reference'],
  [/(process\.env|fs\.readFileSync)[\s\S]{0,60}(fetch|axios|https?:\/\/)/i, 'possible secret exfiltration'],
];
function scanCode(text) {
  const t = String(text || '');
  for (const [re, detail] of SIGNATURES) {
    if (re.test(t)) return { status: 'flagged', detail };
  }
  // INTEGRATION POINT: call a real AV/API here for defense in depth.
  return { status: 'clean', detail: null };
}

// Which asset types are downloadable code/files that must be scanned.
const SCANNABLE_TYPES = ['code_file', 'built_site', 'html_demo', 'website_prompt', 'build_instructions'];
const needsScan = (type) => SCANNABLE_TYPES.includes(type);

module.exports = { watermarkText, watermarkHtml, obfuscate, scanCode, needsScan, SCANNABLE_TYPES };
