// Pure helpers for site web addresses: subdomain labels, custom hostnames, and which host is the
// main app vs a served site. No DB, no network — safe to import anywhere and unit-tested.

const RESERVED = new Set([
  'www', 'app', 'api', 'mail', 'admin', 'dashboard', 'static', 'cdn', 'assets', 'labs', 'desk',
  'dreamhold', 'dreammarket', 'market', 'support', 'help', 'blog', 'status', 'ftp', 'ns', 'ns1',
  'ns2', 'sites', 'site', 'clay', 'accessyplabs', 'test', 'staging', 'dev',
  'connect', 'origin', 'go', 'link',
]);

function sitesRoot() {
  // First-level by default: <label>.accessyplabs.com is covered by free Universal SSL (a wildcard
  // cert only covers one subdomain level), so instant addresses need no paid certificate. Set
  // SITES_ROOT to move them under a deeper subdomain (which then needs Advanced Certificate Manager).
  return (process.env.SITES_ROOT || 'accessyplabs.com').toLowerCase().replace(/^\.+|\.+$/g, '');
}

function normalizeLabel(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
}
function validLabel(label) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && !RESERVED.has(label);
}
function subdomainHost(label) { return label + '.' + sitesRoot(); }

function normalizeCustomHost(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
}
function validCustomHost(h) {
  if (!h || h.length > 253 || !h.includes('.')) return false;
  if (!/^[a-z0-9.-]+$/.test(h)) return false;
  if (h === sitesRoot() || h.endsWith('.' + sitesRoot())) return false; // that's a subdomain, not custom
  return h.split('.').every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l));
}

function appHostSet() {
  const env = (process.env.APP_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const defaults = ['accessyplabs.com', 'www.accessyplabs.com', 'localhost', '127.0.0.1'];
  return new Set(env.concat(defaults));
}
// Host of the main platform (serves the app/SPA), as opposed to a creator's served site.
function isAppHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  if (!h) return true;
  if (appHostSet().has(h)) return true;
  if (h.endsWith('.railway.app') || h.endsWith('.up.railway.app')) return true;
  return false;
}
function isSiteHost(host) { return !isAppHost(host); }

// The Host the request actually arrived on (respecting the proxy in front of us).
function hostOf(req) {
  const xf = req.headers && req.headers['x-forwarded-host'];
  const h = (xf ? String(xf).split(',')[0] : (req.headers && req.headers.host)) || '';
  return h.trim().toLowerCase().replace(/:\d+$/, '');
}

// What the creator points their DNS at for a custom domain (CNAME target).
// What a creator points their own domain's CNAME at. Never the apex (you can't CNAME an apex to it
// cleanly), so default to a dedicated reserved host under our root.
function cnameTarget() {
  const env = (process.env.CF_CNAME_TARGET || '').trim().toLowerCase();
  if (env) return env;
  const root = sitesRoot();
  return root.split('.').length <= 2 ? 'connect.' + root : root;
}

module.exports = {
  RESERVED, sitesRoot, normalizeLabel, validLabel, subdomainHost,
  normalizeCustomHost, validCustomHost, isAppHost, isSiteHost, hostOf, cnameTarget,
};
