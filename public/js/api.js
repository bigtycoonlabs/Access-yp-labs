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
      method, headers, credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  async function refresh() {
    // The refresh token may live only in an HttpOnly cookie — localStorage can be wiped by the
    // browser (iOS/Safari do this after ~7 days), which is what silently logs returning users
    // out. The cookie is sent automatically on this same-origin call, so we try to refresh even
    // with nothing stored locally; that's what keeps someone signed in across a storage wipe.
    const { refreshToken } = getTokens();
    const res = await raw('/auth/refresh', { method: 'POST', body: refreshToken ? { refreshToken } : {}, auth: false });
    if (!res.ok) return false;
    let data = null; try { data = await res.json(); } catch (_) { return false; }
    if (!data || !data.accessToken) return false;
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
      const err = new Error(msg); err.status = res.status; err.data = data;
      // Unrecoverable auth failure: drop the stale token and flag a session end so
      // pages can send the user to sign in again (in Clay's voice) instead of
      // surfacing a raw token error.
      if (res.status === 401 && opts.auth !== false) { clearTokens(); err.sessionExpired = true; }
      throw err;
    }
    return data;
  }

  window.Kiln = { api, getTokens, setTokens, clearTokens, isLoggedIn, refresh };
})();
