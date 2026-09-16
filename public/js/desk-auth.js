// SIGNING THE PENNY DESK PAGES' OWN REQUESTS.
//
// The Today, Businesses, People and Penny pages called the API with fetch() and
// credentials:'include', but the server only accepts a Bearer token and never a cookie. Every call
// answered 401, every page treated 401 as "not signed in" and sent the person to sign in, and
// signing in sent them straight back. A signed-in person could not reach a single Penny Desk screen,
// and every check that looked at HTTP status or the page source passed.
//
// Rather than rewrite each call, this wraps fetch for same-origin /api/ requests only: it adds the
// session the rest of the site already keeps (window.Kiln, from api.js), and on a 401 it tries one
// refresh before letting the page decide the person is signed out. Nothing else is touched, and a
// request that already carries an Authorization header is left alone.
(function () {
  if (!window.Kiln || !window.fetch || window.__deskAuth) return;
  window.__deskAuth = true;
  var base = window.fetch.bind(window);

  function isOurApi(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    try {
      var u = new URL(url, location.href);
      return u.origin === location.origin && u.pathname.indexOf('/api/') === 0
        && u.pathname.indexOf('/api/auth/') !== 0;
    } catch (_) { return false; }
  }

  function withToken(init) {
    var next = Object.assign({}, init || {});
    var h = new Headers(next.headers || {});
    if (h.has('Authorization')) return null;
    var t = window.Kiln.getTokens().accessToken;
    if (t) h.set('Authorization', 'Bearer ' + t);
    next.headers = h;
    return next;
  }

  window.fetch = async function (input, init) {
    if (!isOurApi(input)) return base(input, init);
    var signed = withToken(init);
    if (!signed) return base(input, init);
    var res = await base(input, signed);
    if (res.status !== 401) return res;
    // One refresh, then the page's own 401 handling decides. Never a loop.
    var ok = false;
    try { ok = await window.Kiln.refresh(); } catch (_) { ok = false; }
    if (!ok) return res;
    return base(input, withToken(init));
  };
})();
