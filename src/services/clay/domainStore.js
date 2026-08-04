// DB access for site web addresses. db is loaded lazily so importing stays cheap.
function query(...a) { return require('../../config/db').query(...a); }

async function listForConcept(conceptId) {
  const r = await query(
    'SELECT id, hostname, kind, status, verification, created_at FROM site_domains WHERE concept_id=$1 ORDER BY created_at',
    [conceptId]);
  return r.rows;
}

// Resolve an incoming Host to the concept whose ACTIVE site it serves.
async function conceptForHost(hostname) {
  const r = await query(
    "SELECT concept_id FROM site_domains WHERE hostname=$1 AND status='active' LIMIT 1", [hostname]);
  return r.rows[0] ? r.rows[0].concept_id : null;
}

async function hostnameTaken(hostname) {
  const r = await query('SELECT 1 FROM site_domains WHERE hostname=$1 LIMIT 1', [hostname]);
  return !!r.rows.length;
}

async function addSubdomain(conceptId, ownerId, hostname) {
  const r = await query(
    "INSERT INTO site_domains (concept_id, owner_id, hostname, kind, status) VALUES ($1,$2,$3,'subdomain','active') RETURNING id, hostname, kind, status",
    [conceptId, ownerId, hostname]);
  return r.rows[0];
}

async function addCustom(conceptId, ownerId, hostname, cfId, verification) {
  const r = await query(
    "INSERT INTO site_domains (concept_id, owner_id, hostname, kind, status, cf_hostname_id, verification) VALUES ($1,$2,$3,'custom','pending',$4,$5) RETURNING id, hostname, kind, status, verification",
    [conceptId, ownerId, hostname, cfId || null, verification ? JSON.stringify(verification) : null]);
  return r.rows[0];
}

async function getForOwner(conceptId, domainId, ownerId) {
  const r = await query('SELECT * FROM site_domains WHERE id=$1 AND concept_id=$2 AND owner_id=$3 LIMIT 1', [domainId, conceptId, ownerId]);
  return r.rows[0] || null;
}

async function setStatus(id, status) {
  await query('UPDATE site_domains SET status=$2, updated_at=NOW() WHERE id=$1', [id, status]);
}

async function remove(conceptId, id, ownerId) {
  const r = await query('DELETE FROM site_domains WHERE id=$1 AND concept_id=$2 AND owner_id=$3 RETURNING cf_hostname_id, kind', [id, conceptId, ownerId]);
  return r.rows[0] || null;
}

module.exports = { listForConcept, conceptForHost, hostnameTaken, addSubdomain, addCustom, getForOwner, setStatus, remove };
