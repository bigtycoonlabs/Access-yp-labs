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

  // WHAT A LISTING COSTS, SAID HONESTLY. The browser half of src/lib/price.js — same three states,
  // same words. Every page had its own `money(c)` doing `(c || 0) / 100`, which turns a listing that
  // has no price into a listing that costs nothing. A live auction was showing as "$0.00" on the
  // public page, in the staff console, and as "You earn $0.00" to the movers being asked to promote
  // it. An auction has a starting bid, not a price, and a missing number is not zero.
  function priceLabel(listing) {
    const l = listing || {};
    const money = (c) => '$' + (Number(c) / 100).toFixed(2);
    if (String(l.format || '') === 'auction') {
      if (l.starting_bid_cents == null) return 'Auction — no starting bid set';
      return 'Auction, bidding from ' + money(l.starting_bid_cents);
    }
    if (l.price_cents == null) return 'Price not set';
    return money(l.price_cents);
  }

  // The figure a buyer would first be asked for, in cents, or null. For arithmetic — a commission,
  // a sort — where a label cannot be used and a zero would be a wrong answer rather than no answer.
  function askingCents(listing) {
    const l = listing || {};
    if (String(l.format || '') === 'auction') return l.starting_bid_cents == null ? null : Number(l.starting_bid_cents);
    return l.price_cents == null ? null : Number(l.price_cents);
  }

  window.Kiln = { api, getTokens, setTokens, clearTokens, isLoggedIn, refresh, priceLabel, askingCents };
})();
