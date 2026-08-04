#!/usr/bin/env node
/**
 * One-shot Cloudflare wiring for Access YP Labs creator web addresses.
 *
 * This does the API-scriptable half of the setup so nobody has to click through the dashboard for
 * it: the wildcard subdomain record, the Cloudflare-for-SaaS fallback origin, and the certificate
 * order. It is idempotent (safe to run again) and never deletes anything.
 *
 * It CANNOT do the account-owner steps — putting the domain on Cloudflare, pointing nameservers,
 * enabling the certificate add-on (billing), creating the token, or setting Railway variables.
 * Those stay with you.
 *
 * Run it in an environment that can reach api.cloudflare.com, with these environment variables set
 * (never pass the token as a command-line argument — it would land in your shell history):
 *
 *   CF_API_TOKEN     A Cloudflare API token scoped to the accessyplabs.com zone with
 *                    Zone > DNS > Edit  AND  Zone > SSL and Certificates > Edit.
 *   CF_ZONE_ID       The Zone ID from the accessyplabs.com overview page.
 *   APP_ORIGIN_HOST  The hostname Cloudflare should proxy to — the Railway app domain
 *                    (for example something-production.up.railway.app).
 *   SITES_ROOT       Optional. Defaults to sites.accessyplabs.com.
 *
 * Example:
 *   CF_API_TOKEN=xxx CF_ZONE_ID=yyy APP_ORIGIN_HOST=your-app.up.railway.app \
 *     node scripts/cloudflare-setup.js
 */

const TOKEN = process.env.CF_API_TOKEN;
const ZONE = process.env.CF_ZONE_ID;
const ORIGIN = (process.env.APP_ORIGIN_HOST || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SITES_ROOT = (process.env.SITES_ROOT || 'sites.accessyplabs.com').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
const WILDCARD = '*.' + SITES_ROOT;

function die(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }
if (!TOKEN) die('Set CF_API_TOKEN (do not paste it as an argument — use the environment).');
if (!ZONE) die('Set CF_ZONE_ID (from the accessyplabs.com overview page in Cloudflare).');
if (!ORIGIN) die('Set APP_ORIGIN_HOST to the Railway app domain Cloudflare should proxy to.');

const API = 'https://api.cloudflare.com/client/v4';
async function cf(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body = {};
  try { body = await r.json(); } catch (_) { body = {}; }
  return { ok: r.ok && body.success, status: r.status, body };
}
const errText = (res) => (res.body && res.body.errors || []).map((e) => e.message).join('; ') || ('HTTP ' + res.status);

// Create a proxied CNAME if it isn't already there (idempotent).
async function ensureCname(name, content) {
  const found = await cf(`/zones/${ZONE}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`);
  if (found.ok && found.body.result && found.body.result.length) {
    console.log(`  • ${name} already exists → leaving it as is`);
    return true;
  }
  const made = await cf(`/zones/${ZONE}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'CNAME', name, content, proxied: true, ttl: 1 }),
  });
  if (!made.ok) { console.error(`  ✗ could not create ${name}: ${errText(made)}`); return false; }
  console.log(`  ✓ created ${name} → ${content} (proxied)`);
  return true;
}

async function main() {
  console.log('\nChecking the token and zone…');
  const zone = await cf(`/zones/${ZONE}`);
  if (!zone.ok) die('Token or Zone ID rejected: ' + errText(zone));
  console.log(`  ✓ zone: ${zone.body.result.name}`);

  console.log('\n1) DNS records');
  const a = await ensureCname(WILDCARD, ORIGIN);   // instant subdomains
  const b = await ensureCname(SITES_ROOT, ORIGIN); // the CNAME target creators point to + fallback

  console.log('\n2) Cloudflare for SaaS fallback origin');
  const fb = await cf(`/zones/${ZONE}/custom_hostnames/fallback_origin`, {
    method: 'PUT', body: JSON.stringify({ origin: SITES_ROOT }),
  });
  if (fb.ok) console.log(`  ✓ fallback origin set to ${SITES_ROOT} (it may take a few minutes to become Active)`);
  else console.error(`  ✗ could not set fallback origin: ${errText(fb)} (you can set it in SSL/TLS → Custom Hostnames)`);

  console.log('\n3) Certificate for the subdomains');
  const cert = await cf(`/zones/${ZONE}/ssl/certificate_packs/order`, {
    method: 'POST',
    body: JSON.stringify({ type: 'advanced', hosts: [SITES_ROOT, WILDCARD], validation_method: 'txt', validity_days: 365, certificate_authority: 'google' }),
  });
  if (cert.ok) console.log(`  ✓ ordered an advanced certificate for ${SITES_ROOT} and ${WILDCARD}`);
  else console.error(`  ✗ could not order the certificate: ${errText(cert)}\n    This usually means the Advanced Certificate add-on isn't enabled yet — turn it on in\n    SSL/TLS → Edge Certificates, then re-run this script (everything else will skip cleanly).`);

  console.log('\n' + '─'.repeat(64));
  console.log('Now set these on the Access YP Labs service in Railway, then it will redeploy:');
  console.log('  CF_API_TOKEN     = (a token with Custom Hostnames edit on this zone)');
  console.log('  CF_ZONE_ID       = ' + ZONE);
  console.log('  CF_CNAME_TARGET  = ' + SITES_ROOT);
  console.log('  SITES_ROOT       = ' + SITES_ROOT + '   (optional; this is the default)');
  console.log('─'.repeat(64));
  console.log((a && b) ? '\nDNS is wired. Custom domains switch on once the Railway variables are set.\n'
                       : '\nSome records did not apply — see the messages above.\n');
}
main().catch((e) => die(e && e.message ? e.message : String(e)));
