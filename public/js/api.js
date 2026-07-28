// API layer. Stores tokens, attaches auth, and transparently refreshes.
(function () {
  const KEY = 'kiln.tokens';

  function getTokens() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } }
  function setTokens(t) { localStorage.setItem(KEY, JSON.stringify(t)); }
  function clearTokens() { localStorage.removeItem(KEY); }
  function isLoggedIn() { return !!getTokens().accessToken; }

  async function raw(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const tokens = getTokens();
    if (auth && tokens.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
    const res = await fetch(`/api${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  async function refresh() {
    const { refreshToken } = getTokens();
    if (!refreshToken) return false;
    const res = await raw('/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens({ ...getTokens(), accessToken: data.accessToken, refreshToken: data.refreshToken });
    return true;
  }

  // Main call: returns parsed JSON, throws Error(message) on failure.
  async function api(path, opts = {}) {
    let res = await raw(path, opts);
    if (res.status === 401 && opts.auth !== false) {
      if (await refresh()) res = await raw(path, opts);
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      const msg = (data && (data.error || (data.errors && data.errors[0] && data.errors[0].msg))) || `Request failed (${res.status})`;
      const err = new Error(msg); err.status = res.status; err.data = data; throw err;
    }
    return data;
  }

  window.Kiln = { api, getTokens, setTokens, clearTokens, isLoggedIn };
})();
