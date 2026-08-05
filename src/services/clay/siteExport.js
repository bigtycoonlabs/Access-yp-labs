// Static export: turn a concept's site into ONE self-contained, themed HTML file the creator can
// host anywhere (any static host, their own server) — they own it, fully independent of us. Pure
// string building; all HTML is escaped, so authored content can't inject markup.
const fs = require('fs');
const path = require('path');
const store = require('./store');

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

// Render the storefront: a "Shop" section of product cards — image, name, price, description —
// for a concept's active products. A real catalog on the ownable site. (The live buy/checkout
// action is wired separately, through the platform's Stripe Connect, once the owner sets the
// store's payment policy — so this renders the products honestly without a dead button.)
function shopHtml(products, conceptId) {
  const list = (products || []).filter(function (p) { return p && p.active !== false; });
  if (!list.length) return '';
  const base = (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
  const cards = list.map(function (p) {
    const priced = store.formatPrice(p.price_cents, p.currency);
    let card = '<div class="product-card">';
    if (p.image_url) card += '<img class="product-img" src="' + esc(p.image_url) + '" alt="' + esc(p.name || '') + '">';
    card += '<h3 class="product-name">' + esc(p.name || '') + '</h3>';
    card += '<p class="product-price">' + esc(priced) + '</p>';
    if (p.description) card += '<p class="product-desc">' + esc(p.description) + '</p>';
    // A real Buy button — a form POST to the platform checkout, which starts a direct charge on the
    // creator's own Stripe account. Works even in the exported static file, hosted anywhere. If the
    // creator hasn't set up payments yet, the checkout endpoint says so honestly and charges nothing.
    if (conceptId && p.id) {
      card += '<form class="buy-form" method="POST" action="' + esc(base) + '/api/store/' + esc(conceptId) + '/checkout">'
        + '<input type="hidden" name="product_id" value="' + esc(p.id) + '">'
        + '<button class="btn-cta buy-btn" type="submit" aria-label="Buy ' + esc(p.name || '') + ' for ' + esc(priced) + '">Buy — ' + esc(priced) + '</button>'
        + '</form>';
    }
    card += '</div>';
    return card;
  }).join('');
  return '<section id="shop" class="shop"><h1>Shop</h1><div class="product-grid">' + cards + '</div></section>';
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
function buildSingleFile(concept, pages, products) {
  const lp = concept.launch_page || {};
  const theme = lp.theme || 'warm';
  const title = lp.headline || concept.title || 'My site';
  const shop = shopHtml(products, concept && concept.id);
  const nav = ['<a href="#home">Home</a>']
    .concat(shop ? ['<a href="#shop">Shop</a>'] : [])
    .concat((pages || []).map(function (p) { return '<a href="#' + esc(p.slug) + '">' + esc(p.title) + '</a>'; }))
    .join('');
  let sections = '<section id="home">';
  if (lp.hero_image) sections += '<img class="site-hero" src="' + esc(lp.hero_image) + '" alt="">';
  sections += '<h1>' + esc(lp.headline || concept.title || '') + '</h1>';
  if (lp.subhead) sections += '<p class="site-sub">' + esc(lp.subhead) + '</p>';
  if (lp.blurb) sections += '<p class="site-blurb">' + esc(lp.blurb) + '</p>';
  sections += '</section>';
  sections += shop;
  (pages || []).forEach(function (p) {
    sections += '<section id="' + esc(p.slug) + '" class="article"><h1>' + esc(p.title) + '</h1>' + bodyHtml(p.body) + '</section>';
  });
  const shopCss = '\n.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px;margin-top:12px}'
    + '\n.product-card{border:1px solid var(--line,#e5e0d8);border-radius:12px;padding:14px;background:var(--card,#fff)}'
    + '\n.product-img{width:100%;height:auto;border-radius:8px;display:block;margin-bottom:10px}'
    + '\n.product-name{margin:0 0 4px}\n.product-price{font-weight:700;margin:0 0 8px}\n.product-desc{margin:0;opacity:.85}';
  const html = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + esc(title) + '</title>'
    + '<style>' + themeCss() + '\nsection{padding-top:8px}\n.sitenav{position:sticky;top:0;background:var(--bg)}' + shopCss + '</style></head>'
    + '<body class="sitebody" data-theme="' + esc(theme) + '"><div class="site-wrap">'
    + '<nav class="sitenav" aria-label="Site pages">' + nav + '</nav>'
    + sections
    + '<p class="site-foot">Exported from Access YP Labs. This site is yours to host anywhere.</p>'
    + '</div></body></html>';
  return { filename: (lp.slug || 'my-site') + '.html', html: html };
}

module.exports = { buildSingleFile, shopHtml, bodyHtml, inlineHtml, esc };
