// Multi-page site helpers: slug + copy caps for a concept's site pages. Pure and testable;
// all DB work lives in siteStore / the routes.
const CAPS = { title: 120, body: 20000 };
const KINDS = ['page', 'post'];

function slugify(s) {
  const base = String(s || '')
    .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return base || 'page';
}
function cleanTitle(s) { const t = String(s || '').trim(); return t.length > CAPS.title ? t.slice(0, CAPS.title).trim() : t; }
function cleanBody(s) { const t = String(s == null ? '' : s); return t.length > CAPS.body ? t.slice(0, CAPS.body) : t; }
function normKind(k) { return KINDS.includes(k) ? k : 'page'; }

module.exports = { CAPS, KINDS, slugify, cleanTitle, cleanBody, normKind };
