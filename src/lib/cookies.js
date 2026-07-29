// Minimal first-party cookie helpers — no dependency. Cookies are HttpOnly so the
// browser can't read them; only our server does, which is both safer and enough
// for anonymous visitor memory.
function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i > -1) {
      const k = pair.slice(0, i).trim();
      try { out[k] = decodeURIComponent(pair.slice(i + 1).trim()); } catch (_) { out[k] = pair.slice(i + 1).trim(); }
    }
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  parts.push(`Max-Age=${opts.maxAge != null ? opts.maxAge : 60 * 60 * 24 * 365}`);
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  const cookie = parts.join('; ');
  const prev = res.getHeader('Set-Cookie');
  if (prev) res.setHeader('Set-Cookie', [].concat(prev, cookie));
  else res.setHeader('Set-Cookie', cookie);
}

module.exports = { parseCookies, setCookie };
