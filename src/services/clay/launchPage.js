// A concept's site: its home (launch) page copy, look (theme + hero image), and public slug.
// Pure helpers only; DB work lives in the routes. Kept small and testable.

const CAPS = { headline: 120, subhead: 160, blurb: 600, cta_label: 40 };
const DEFAULT_CTA = 'Get early access';

// Site themes. The names are the contract shared with the public renderer (launch.html); the
// palettes live there. Keep this list and that CSS in sync.
const THEMES = ['warm', 'ink', 'clean', 'bold', 'forest', 'dusk'];
const DEFAULT_THEME = 'warm';

function slugify(s) {
  const base = String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base || 'idea';
}

function clean(s, cap) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  return t.length > cap ? t.slice(0, cap).trim() : t;
}

// Only keep an http(s) image URL; anything else becomes empty.
function cleanImageUrl(s) {
  const t = typeof s === 'string' ? s.trim() : '';
  return /^https?:\/\/[^\s]+$/i.test(t) ? t.slice(0, 500) : '';
}

function normTheme(t) {
  return THEMES.includes(t) ? t : DEFAULT_THEME;
}

// Normalize the editable fields. Always returns copy keys; theme + hero_image are included so the
// site's look persists. cta_label falls back to a working default.
function parseConfig(input) {
  const o = input && typeof input === 'object' ? input : {};
  return {
    headline: clean(o.headline, CAPS.headline),
    subhead: clean(o.subhead, CAPS.subhead),
    blurb: clean(o.blurb, CAPS.blurb),
    cta_label: clean(o.cta_label, CAPS.cta_label) || DEFAULT_CTA,
    theme: normTheme(o.theme),
    hero_image: cleanImageUrl(o.hero_image),
  };
}

module.exports = { CAPS, DEFAULT_CTA, THEMES, DEFAULT_THEME, slugify, parseConfig, cleanImageUrl, normTheme };
