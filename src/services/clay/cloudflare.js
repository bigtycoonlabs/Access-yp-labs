// Cloudflare for SaaS — custom hostnames. Creates/checks/deletes a customer's domain so Cloudflare
// issues TLS and routes it to our origin. Guarded: when CF_API_TOKEN / CF_ZONE_ID aren't set it
// returns { configured:false } instead of throwing, so subdomains keep working and the UI can say
// "custom domains aren't switched on yet." Uses global fetch (Node 18+). Not exercised in the
// sandbox (no creds/network); runs live on Railway.

function configured() { return !!(process.env.CF_API_TOKEN && process.env.CF_ZONE_ID); }

async function cf(pathname, opts) {
  const r = await fetch('https://api.cloudflare.com/client/v4' + pathname, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + process.env.CF_API_TOKEN,
      'Content-Type': 'application/json',
      ...((opts && opts.headers) || {}),
    },
  });
  let body = {};
  try { body = await r.json(); } catch (_) { body = {}; }
  return { ok: r.ok && body && body.success, status: r.status, body };
}

// Ask Cloudflare to start managing a custom hostname. Returns the CF id + the DNS records the
// creator must add (ownership + SSL validation), shaped for display.
async function createCustomHostname(hostname) {
  if (!configured()) return { configured: false };
  const res = await cf('/zones/' + process.env.CF_ZONE_ID + '/custom_hostnames', {
    method: 'POST',
    body: JSON.stringify({ hostname, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } }),
  });
  const r = (res.body && res.body.result) || {};
  return {
    configured: true, ok: res.ok, id: r.id || null, status: r.status || null,
    ssl: r.ssl || null, ownership: r.ownership_verification || null,
    errors: (res.body && res.body.errors) || null,
  };
}

async function getCustomHostname(id) {
  if (!configured()) return { configured: false };
  const res = await cf('/zones/' + process.env.CF_ZONE_ID + '/custom_hostnames/' + encodeURIComponent(id), { method: 'GET' });
  const r = (res.body && res.body.result) || {};
  return { configured: true, ok: res.ok, status: r.status || null, ssl: r.ssl || null, result: r };
}

async function deleteCustomHostname(id) {
  if (!configured()) return { configured: false };
  const res = await cf('/zones/' + process.env.CF_ZONE_ID + '/custom_hostnames/' + encodeURIComponent(id), { method: 'DELETE' });
  return { configured: true, ok: res.ok };
}

module.exports = { configured, createCustomHostname, getCustomHostname, deleteCustomHostname };
