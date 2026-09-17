// THE STAFF PORTAL SHELL (17 September 2026): one navigation, one way of loading, one way of speaking.
// Six short pages, always in the same order, so a place found once is in the same spot after.
(function () {
  var PAGES = [
    ['/staff/', 'Today', 'what needs a person right now'],
    ['/staff/members.html', 'Members', 'accounts, plans and usage'],
    ['/staff/money.html', 'Money', 'revenue and running costs'],
    ['/staff/penny.html', 'Penny', 'is she working'],
    ['/staff/desk.html', 'Desk', 'review and publish articles'],
    ['/staff/email.html', 'Email', 'what went out, what did not'],
  ];
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dollars(cents) {
    var n = Number(cents || 0) / 100, abs = Math.abs(n);
    var s = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return n < 0 ? 'minus ' + s : s;
  }
  function when(t) {
    if (!t) return 'never';
    var d = new Date(t), mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var h = Math.round(mins / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function say(t) { var s = document.getElementById('status'); if (s) s.textContent = t; }

  function nav() {
    var here = location.pathname.replace(/index\.html$/, '');
    var el = document.getElementById('staffnav');
    if (!el) return;
    el.innerHTML = '<ul>' + PAGES.map(function (p) {
      var cur = p[0] === here ? ' aria-current="page"' : '';
      return '<li><a href="' + p[0] + '"' + cur + '>' + esc(p[1]) + '<span class="sr-only">, ' + esc(p[2]) + '</span></a></li>';
    }).join('') + '<li><a href="/today.html">Leave staff area</a></li></ul>';
  }

  async function get(path) {
    var r = await fetch('/api/staff-portal' + path);
    if (r.status === 401) { location.href = '/login.html?next=' + encodeURIComponent(location.pathname); throw new Error('signed out'); }
    if (r.status === 403) throw new Error('This area is for staff. Your account does not have staff access.');
    var d = {}; try { d = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(d.error || d.message || 'The server did not answer (' + r.status + ').');
    return d;
  }
  async function send(url, body, method) {
    var r = await fetch(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    var d = {}; try { d = await r.json(); } catch (_) {}
    if (!r.ok || d.ok === false) throw new Error(d.message || d.error || (d.errors && 'Some of what was entered was not accepted.') || 'That did not work (' + r.status + ').');
    return d;
  }
  // Load a page: show what is happening, and a failure in words rather than an empty screen.
  async function load(fn) {
    var main = document.getElementById('content');
    try { await fn(main); }
    catch (e) { if (e.message !== 'signed out') { main.innerHTML = '<p>' + esc(e.message) + '</p>'; say(e.message); } }
  }
  function section(title, items, empty) {
    var id = 's-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return '<section class="panel" aria-labelledby="' + id + '"><h2 id="' + id + '">' + esc(title) + '</h2>'
      + (items && items.length ? '<ul class="lines">' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'
        : '<p class="muted">' + esc(empty || 'Nothing here.') + '</p>') + '</section>';
  }
  window.Staff = { esc: esc, dollars: dollars, when: when, plural: plural, say: say, get: get, send: send, load: load, section: section };
  document.addEventListener('DOMContentLoaded', nav);
})();
