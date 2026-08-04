// The coming-soon launch page: pure helpers for its editable copy and its public slug. DB work
// (slug uniqueness, storage) lives in the route; this stays pure and testable.

const CAPS = { headline: 120, subhead: 160, blurb: 600, cta_label: 40 };
const DEFAULT_CTA = 'Get early access';

// A URL-safe slug base from a title. Never empty.
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

// Normalize the editable copy fields. Always returns the four keys; cta_label falls back to a
// sensible default so the page always has a working button.
function parseConfig(input) {
  const o = input && typeof input === 'object' ? input : {};
  return {
    headline: clean(o.headline, CAPS.headline),
    subhead: clean(o.subhead, CAPS.subhead),
    blurb: clean(o.blurb, CAPS.blurb),
    cta_label: clean(o.cta_label, CAPS.cta_label) || DEFAULT_CTA,
  };
}

module.exports = { CAPS, DEFAULT_CTA, slugify, parseConfig };
