// Static export: turn a concept's site into ONE self-contained, themed HTML file the creator can
// host anywhere (any static host, their own server) — they own it, fully independent of us. Pure
// string building; all HTML is escaped, so authored content can't inject markup.
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function inlineHtml(text) {
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g; let out = '', last = 0, mm;
  while ((mm = re.exec(text))) {
    out += esc(text.slice(last, mm.index));
    out += '<a href="' + esc(mm[2]) + '" target="_blank" rel="noopener">' + esc(mm[1]) + '</a>';
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}
function bodyHtml(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n'); let i = 0; const out = [];
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    const img = line.match(/^\s*!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/);
    if (img) { out.push('<img src="' + esc(img[2]) + '" alt="' + esc(img[1] || '') + '">'); i++; continue; }
    const btn = line.match(/^\s*\[\[([^\]]+)\]\]\((https?:\/\/[^\s)]+)\)\s*$/);
    if (btn) { out.push('<a class="btn-cta" href="' + esc(btn[2]) + '" target="_blank" rel="noopener">' + esc(btn[1]) + '</a>'); i++; continue; }
    if (/^>\s?/.test(line)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; } out.push('<blockquote>' + inlineHtml(q.join(' ')) + '</blockquote>'); continue; }
    if (/^##\s+/.test(line)) { out.push('<h3>' + inlineHtml(line.replace(/^##\s+/, '')) + '</h3>'); i++; continue; }
    if (/^#\s+/.test(line)) { out.push('<h2>' + inlineHtml(line.replace(/^#\s+/, '')) + '</h2>'); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { const items = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push('<li>' + inlineHtml(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>'); i++; } out.push('<ul>' + items.join('') + '</ul>'); continue; }
    const para = [lines[i]]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^#{1,2}\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^\s*!\[/.test(lines[i]) && !/^\s*\[\[/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push('<p>' + inlineHtml(para.join(' ')) + '</p>');
  }
  return out.join('\n');
}

let CSS_CACHE = null;
function themeCss() {
  if (CSS_CACHE != null) return CSS_CACHE;
  try { CSS_CACHE = fs.readFileSync(path.join(__dirname, '../../../public/css/site-themes.css'), 'utf8'); }
  catch (e) { CSS_CACHE = ''; }
  return CSS_CACHE;
}

// Build one self-contained HTML document: home section + every page as its own section, with an
// in-page anchor nav. `concept.launch_page` holds the home copy/look; `pages` are the site pages.
function buildSingleFile(concept, pages) {
  const lp = concept.launch_page || {};
  const theme = lp.theme || 'warm';
  const title = lp.headline || concept.title || 'My site';
  const nav = ['<a href="#home">Home</a>'].concat(
    (pages || []).map(function (p) { return '<a href="#' + esc(p.slug) + '">' + esc(p.title) + '</a>'; })
  ).join('');
  let sections = '<section id="home">';
  if (lp.hero_image) sections += '<img class="site-hero" src="' + esc(lp.hero_image) + '" alt="">';
  sections += '<h1>' + esc(lp.headline || concept.title || '') + '</h1>';
  if (lp.subhead) sections += '<p class="site-sub">' + esc(lp.subhead) + '</p>';
  if (lp.blurb) sections += '<p class="site-blurb">' + esc(lp.blurb) + '</p>';
  sections += '</section>';
  (pages || []).forEach(function (p) {
    sections += '<section id="' + esc(p.slug) + '" class="article"><h1>' + esc(p.title) + '</h1>' + bodyHtml(p.body) + '</section>';
  });
  const html = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + esc(title) + '</title>'
    + '<style>' + themeCss() + '\nsection{padding-top:8px}\n.sitenav{position:sticky;top:0;background:var(--bg)}</style></head>'
    + '<body class="sitebody" data-theme="' + esc(theme) + '"><div class="site-wrap">'
    + '<nav class="sitenav" aria-label="Site pages">' + nav + '</nav>'
    + sections
    + '<p class="site-foot">Exported from Access YP Labs. This site is yours to host anywhere.</p>'
    + '</div></body></html>';
  return { filename: (lp.slug || 'my-site') + '.html', html: html };
}

module.exports = { buildSingleFile, bodyHtml, inlineHtml, esc };
