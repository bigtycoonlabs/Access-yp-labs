// Data access for a concept's multi-page site. Shared by Clay's tools and the owner routes so
// the two stay in lockstep. Ownership is always checked by the caller (ownsConcept).
const { query } = require('../../config/db');
const sp = require('./sitePages');

async function ownsConcept(conceptId, ownerId) {
  const r = await query('SELECT 1 FROM concepts WHERE id=$1 AND owner_id=$2', [conceptId, ownerId]);
  return !!r.rows.length;
}

async function ensureUniqueSlug(conceptId, base, exceptId) {
  let slug = base, i = 1;
  for (;;) {
    const args = exceptId ? [conceptId, slug, exceptId] : [conceptId, slug];
    const clause = exceptId ? 'AND id<>$3' : '';
    const taken = await query(`SELECT 1 FROM site_pages WHERE concept_id=$1 AND slug=$2 ${clause} LIMIT 1`, args);
    if (!taken.rows.length) return slug;
    i += 1; slug = `${base}-${i}`;
    if (i > 60) return `${base}-${Date.now().toString(36)}`;
  }
}

async function listPages(conceptId, { publishedOnly = false } = {}) {
  const clause = publishedOnly ? 'AND published=true' : '';
  const r = await query(
    `SELECT id, slug, title, kind, nav_order, published, updated_at
       FROM site_pages WHERE concept_id=$1 ${clause} ORDER BY nav_order, created_at`, [conceptId]);
  return r.rows;
}

async function getPage(conceptId, slug, { publishedOnly = false } = {}) {
  const clause = publishedOnly ? 'AND published=true' : '';
  const r = await query(
    `SELECT id, slug, title, body, kind, nav_order, published, updated_at
       FROM site_pages WHERE concept_id=$1 AND slug=$2 ${clause} LIMIT 1`, [conceptId, slug]);
  return r.rows[0] || null;
}

async function addPage(conceptId, ownerId, { title, body, kind, publish, nav_order }) {
  const t = sp.cleanTitle(title);
  if (!t) throw new Error('A page title is required.');
  const slug = await ensureUniqueSlug(conceptId, sp.slugify(t));
  const r = await query(
    `INSERT INTO site_pages (concept_id, owner_id, slug, title, body, kind, nav_order, published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, slug, title, kind, nav_order, published`,
    [conceptId, ownerId, slug, t, sp.cleanBody(body), sp.normKind(kind),
     Number.isInteger(nav_order) ? nav_order : 0, publish === true]);
  return r.rows[0];
}

// Find by slug OR id, update title/body/publish/order. Returns null if not found.
async function editPage(conceptId, pageRef, { title, body, publish, nav_order }) {
  const cur = await query(
    'SELECT id, title, body FROM site_pages WHERE concept_id=$1 AND (slug=$2 OR id::text=$2) LIMIT 1',
    [conceptId, String(pageRef)]);
  if (!cur.rows.length) return null;
  const row = cur.rows[0];
  const newTitle = title != null ? sp.cleanTitle(title) : row.title;
  const newBody = body != null ? sp.cleanBody(body) : row.body;
  const r = await query(
    `UPDATE site_pages SET title=$3, body=$4,
        published=COALESCE($5, published), nav_order=COALESCE($6, nav_order), updated_at=NOW()
     WHERE id=$1 AND concept_id=$2
     RETURNING id, slug, title, kind, nav_order, published`,
    [row.id, conceptId, newTitle || row.title, newBody,
     typeof publish === 'boolean' ? publish : null,
     Number.isInteger(nav_order) ? nav_order : null]);
  return r.rows[0];
}

module.exports = { ownsConcept, ensureUniqueSlug, listPages, getPage, addPage, editPage };
