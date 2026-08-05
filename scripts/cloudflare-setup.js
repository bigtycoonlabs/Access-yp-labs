#!/usr/bin/env node
/**
 * One-shot Cloudflare wiring for Access YP Labs creator web addresses (free-path default).
 *
 * Does the API-scriptable half of the setup so nobody has to click through the dashboard for it:
 * the wildcard subdomain record, the custom-domain "connect" target, and the Cloudflare-for-SaaS
 * fallback origin. Idempotent (safe to run again) and never deletes anything.
 *
 * It CANNOT do the account-owner steps — putting the domain on Cloudflare, pointing nameservers,
 * creating the token, or setting Railway variables. Those stay with you.
 *
 * With the default first-level root (accessyplabs.com), instant addresses are <label>.accessyplabs.com
 * and are covered by free Universal SSL — no certificate to buy or order. If you set SITES_ROOT to a
 * deeper subdomain (e.g. sites.accessyplabs.com), that wildcard needs Advanced Certificate Manager;
 * this script will tell you and skip the cert either way (order it in the dashboard).
 *
 * Run it where it can reach api.cloudflare.com, with these environment variables (never pass the
 * token as a command-line argument — it would land in your shell history):
 *
 *   CF_API_TOKEN     Token scoped to the accessyplabs.com zone with DNS:Edit and SSL:Edit.
 *   CF_ZONE_ID       Zone ID from the accessyplabs.com overview page.
 *   APP_ORIGIN_HOST  The hostname Cloudflare proxies to (the Railway app domain).
 *   SITES_ROOT       Optional. Defaults to accessyplabs.com.
 */

const TOKEN = process.env.CF_API_TOKEN;
const ZONE = process.env.CF_ZONE_ID;
const ORIGIN = (process.env.APP_ORIGIN_HOST || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const SITES_ROOT = (process.env.SITES_ROOT || 'accessyplabs.com').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
const WILDCARD = '*.' + SITES_ROOT;
const CONNECT = 'connect.' + SITES_ROOT;
const APEX_LEVEL = SITES_ROOT.split('.').length <= 2; // first-level → free Universal SSL covers *.root

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

async function ensureCname(name, content) {
  const found = await cf(`/zones/${ZONE}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`);
  if (found.ok && found.body.result && found.body.result.length) {
    console.log(`  • ${name} already exists → leaving it as is`);
    return true;
  }
  const made = await cf(`/zones/${ZONE}/dns_records`, {
    method: 'POST', body: JSON.stringify({ type: 'CNAME', name, content, proxied: true, ttl: 1 }),
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
  const a = await ensureCname(WILDCARD, ORIGIN); // instant subdomains: <label>.<root>
  const b = await ensureCname(CONNECT, ORIGIN);  // where creators' own domains CNAME to

  console.log('\n2) Cloudflare for SaaS fallback origin');
  const fb = await cf(`/zones/${ZONE}/custom_hostnames/fallback_origin`, {
    method: 'PUT', body: JSON.stringify({ origin: CONNECT }),
  });
  if (fb.ok) console.log(`  ✓ fallback origin set to ${CONNECT} (it may take a few minutes to become Active)`);
  else console.error(`  ✗ could not set fallback origin: ${errText(fb)} (set it in SSL/TLS → Custom Hostnames)`);

  console.log('\n3) Certificate for the subdomains');
  if (APEX_LEVEL) {
    console.log(`  • ${WILDCARD} is a first-level wildcard — free Universal SSL already covers it. Nothing to order.`);
  } else {
    const cert = await cf(`/zones/${ZONE}/ssl/certificate_packs/order`, {
      method: 'POST',
      body: JSON.stringify({ type: 'advanced', hosts: [SITES_ROOT, WILDCARD], validation_method: 'txt', validity_days: 365, certificate_authority: 'google' }),
    });
    if (cert.ok) console.log(`  ✓ ordered an advanced certificate for ${SITES_ROOT} and ${WILDCARD}`);
    else console.error(`  ✗ could not order the certificate: ${errText(cert)}\n    A deeper wildcard needs the Advanced Certificate Manager add-on — enable it in\n    SSL/TLS → Edge Certificates, then re-run this script.`);
  }

  console.log('\n' + '─'.repeat(64));
  console.log('Now set these on the Access YP Labs service in Railway, then it will redeploy:');
  console.log('  CF_API_TOKEN     = (a token with Custom Hostnames edit on this zone)');
  console.log('  CF_ZONE_ID       = ' + ZONE);
  console.log('  CF_CNAME_TARGET  = ' + CONNECT);
  if (!APEX_LEVEL) console.log('  SITES_ROOT       = ' + SITES_ROOT);
  console.log('─'.repeat(64));
  console.log((a && b) ? '\nDNS is wired. Custom domains switch on once the Railway variables are set.\n'
                       : '\nSome records did not apply — see the messages above.\n');
}
main().catch((e) => die(e && e.message ? e.message : String(e)));
