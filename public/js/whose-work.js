// WHICH WORK AM I IN — the workspace's own switcher.
//
// The first version of this went into nav.js, which the workspace pages do not use: they carry a
// quiet links row instead of a navigation bar. It rendered on the retired marketplace pages and
// nowhere a person actually works — the same reachability mistake this codebase keeps making, and
// the reason for walking the live page rather than trusting the file.
//
// Shown only to somebody who is on somebody else's team: a control with one option is noise.
(function () {
  function place(el) {
    var links = document.querySelector('nav.quiet-links');
    if (links) { links.parentNode.insertBefore(el, links); return true; }
    var main = document.querySelector('main');
    if (main) { main.insertBefore(el, main.firstChild); return true; }
    return false;
  }
  async function build() {
    if (!window.Kiln || !Kiln.api) return;
    var v;
    try { v = await Kiln.api('/team/views/mine'); } catch (_) { return; }
    if (!v || !v.views || v.views.length < 2) return;

    var wrap = document.createElement('p');
    wrap.className = 'whose-work';
    var lab = document.createElement('label');
    lab.setAttribute('for', 'whose-work');
    lab.textContent = 'Whose work you are in';
    var sel = document.createElement('select');
    sel.id = 'whose-work';
    sel.className = 'box';
    v.views.forEach(function (w) {
      var o = document.createElement('option');
      o.value = w.owner_id || '';
      o.textContent = w.name;
      if ((w.owner_id || null) === (v.working_for || null)) o.selected = true;
      sel.appendChild(o);
    });
    var status = document.getElementById('live') || (function () {
      var s = document.createElement('p');
      s.id = 'whose-work-status';
      s.setAttribute('role', 'status');
      s.setAttribute('aria-live', 'polite');
      s.className = 'muted';
      wrap.appendChild(s);
      return s;
    })();
    sel.addEventListener('change', function () {
      sel.disabled = true;
      status.textContent = 'Moving…';
      Kiln.api('/team/views/mine', { method: 'POST', body: { owner_id: sel.value || null } })
        .then(function (r) {
          // Said before the page turns over, so nobody is moved without being told.
          status.textContent = (r && r.says) || 'Moved.';
          setTimeout(function () { location.reload(); }, 900);
        })
        .catch(function (e) {
          sel.disabled = false;
          status.textContent = (e && e.message) || 'That did not change, so you are where you were.';
        });
    });
    wrap.insertBefore(sel, wrap.firstChild);
    wrap.insertBefore(lab, wrap.firstChild);
    place(wrap);
  }
  document.addEventListener('DOMContentLoaded', build);
})();
