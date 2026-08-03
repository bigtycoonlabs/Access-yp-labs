// Concept vault — a calm, screen-reader-first home for ONE concept's materials.
// The Laboratory chat now sends people here with a single button instead of stacking a
// "View" button per asset in the conversation (which was overwhelming with VoiceOver).
// Here each section can be viewed, downloaded, and sent back to Clay for an edit.
(function () {
  if (!Kiln.isLoggedIn()) {
    // The HttpOnly refresh cookie may still hold a live session even if localStorage was wiped.
    Kiln.refresh().then(function (ok) { if (ok) location.reload(); else location.replace('/login.html'); });
    return;
  }

  // Must match the server's PREVIEW_TYPES (lib/entitlement.js): the pieces anyone can see free.
  var PREVIEW_TYPES = ['business_plan', 'marketing_strategy', 'html_demo', 'built_site'];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function typeWords(t) { return String(t || '').replace(/_/g, ' '); }
  function safeName(s) {
    return String(s || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
  }
  function saveText(text, name) {
    var blob = new Blob([text], { type: 'text/markdown' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function goSignIn() {
    announce('Your session ended — taking you to sign in. Your work is saved.', true);
    setTimeout(function () { location.href = '/login.html?session=expired'; }, 1400);
  }

  var signout = document.getElementById('signout');
  if (signout) signout.addEventListener('click', function (e) { e.preventDefault(); Kiln.clearTokens(); location.href = '/'; });

  var params = new URLSearchParams(location.search);
  var id = /^[0-9a-f-]{36}$/i.test(params.get('id') || '') ? params.get('id') : null;
  var titleEl = document.getElementById('concept-title');
  var takeEl = document.getElementById('clays-take');
  var assetsEl = document.getElementById('assets');
  var actionsEl = document.getElementById('concept-actions');

  if (!id) {
    titleEl.textContent = 'Concept not found';
    assetsEl.appendChild(el('p', 'muted', 'This link is missing a concept. Head back to your Laboratory to pick one.'));
    var back0 = el('a', 'btn', 'Back to your Laboratory'); back0.href = '/app.html'; assetsEl.appendChild(back0);
    return;
  }

  // View toggles the section's body open/closed, so a reader isn't forced through every asset.
  async function viewAsset(section, assetId, label) {
    var existing = section.querySelector('.asset-body');
    if (existing) { existing.remove(); announce(label + ' hidden.'); return; }
    announce('Loading ' + label + '…');
    try {
      var r = await Kiln.api('/assets/' + assetId);
      var body = el('div', 'asset-body', (r.asset && r.asset.body) || '(empty)');
      body.setAttribute('tabindex', '-1');
      body.setAttribute('role', 'region');
      body.setAttribute('aria-label', label);
      section.appendChild(body);
      focusEl(body, label + ' loaded.');
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      if (e.status === 402) { announce(label + ' unlocks when you keep this concept.', true); return; }
      announce('Could not load ' + label + ': ' + e.message, true);
    }
  }

  async function downloadAsset(assetId, label) {
    // A direct link to /assets/:id/download wouldn't carry the auth header, so fetch the body
    // through Kiln (which authenticates) and save it as a file.
    announce('Preparing ' + label + '…');
    try {
      var r = await Kiln.api('/assets/' + assetId);
      var a = r.asset || {};
      saveText('# ' + (a.title || label) + '\n\n' + (a.body || '') + '\n', safeName(a.title || label) + '.md');
      announce(label + ' downloaded.', true);
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      if (e.status === 402) { announce(label + ' unlocks when you keep this concept.', true); return; }
      announce('Could not download ' + label + ': ' + e.message, true);
    }
  }

  async function downloadAll(conceptId) {
    announce('Preparing your package…');
    try {
      var r = await Kiln.api('/concepts/' + conceptId + '/export');
      var text = (r.assets || []).map(function (a) { return '# ' + (a.title || a.type) + '\n\n' + (a.body || '') + '\n'; }).join('\n\n');
      saveText(text, 'concept-package.md');
      announce('Your package download has started.', true);
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      if (e.status === 402) { announce('Keep this concept to download the full package.', true); return; }
      announce('Could not export: ' + e.message, true);
    }
  }

  async function keep(conceptId, btn) {
    if (btn) btn.disabled = true;
    try {
      var r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'maker', concept_id: conceptId } });
      if (r && r.url) { location.href = r.url; return; }
      announce((r && r.message) || 'Billing isn’t set up yet, so nothing was charged.', true);
    } catch (e) { if (e.sessionExpired) return goSignIn(); announce(e.message, true); }
    if (btn) btn.disabled = false;
  }

  // Unlimited (Sculptor) — offered alongside per-concept Maker at the keep moment.
  async function goUnlimited(btn) {
    if (btn) btn.disabled = true;
    try {
      var r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'sculptor' } });
      if (r && r.url) { location.href = r.url; return; }
      announce((r && r.message) || 'Billing isn’t set up yet, so nothing was charged.', true);
    } catch (e) { if (e.sessionExpired) return goSignIn(); announce(e.message, true); }
    if (btn) btn.disabled = false;
  }

  (async function load() {
    try {
      var data = await Kiln.api('/concepts/' + id);
      var concept = data.concept || {};
      var entitled = data.entitled !== false;
      var assets = (data.assets || []).filter(function (a) { return a && a.is_current !== false; });

      document.title = (concept.title || 'Your concept') + ' — Access YP Labs';
      titleEl.textContent = concept.title || 'Your concept';
      if (concept.clays_take) { takeEl.textContent = concept.clays_take; takeEl.hidden = false; }

      assetsEl.appendChild(el('h2', null, 'Your vault' + (assets.length ? ' — ' + assets.length + ' section' + (assets.length === 1 ? '' : 's') : '')));

      if (!assets.length) {
        assetsEl.appendChild(el('p', 'muted', 'Nothing is built here yet. Head back to your Laboratory and Clay will build this out with you.'));
      }

      var lockedCount = 0;
      assets.forEach(function (a) {
        var label = a.title || typeWords(a.type);
        var unlocked = entitled || PREVIEW_TYPES.indexOf(a.type) !== -1;
        var sec = el('section', 'asset-item');
        sec.setAttribute('aria-label', label);
        sec.appendChild(el('h3', null, label));
        var acts = el('div', 'actions');
        if (unlocked) {
          var v = el('button', 'btn secondary', 'View'); v.type = 'button';
          v.addEventListener('click', function () { viewAsset(sec, a.id, label); });
          acts.appendChild(v);
          var d = el('button', 'btn secondary', 'Download'); d.type = 'button';
          d.addEventListener('click', function () { downloadAsset(a.id, label); });
          acts.appendChild(d);
        } else {
          lockedCount++;
          sec.appendChild(el('p', 'muted', 'Built and waiting — unlocks when you keep this concept.'));
        }
        var edit = el('a', 'btn secondary', 'Request an edit');
        edit.href = '/app.html?concept=' + encodeURIComponent(id) + '&edit=' + encodeURIComponent(a.type) + '&editTitle=' + encodeURIComponent(label);
        acts.appendChild(edit);
        sec.appendChild(acts);
        assetsEl.appendChild(sec);
      });

      // ---- concept-level actions ----
      var cActs = el('div', 'actions');
      if (entitled) {
        var dlAll = el('button', 'btn', 'Download the whole package'); dlAll.type = 'button';
        dlAll.addEventListener('click', function () { downloadAll(id); });
        cActs.appendChild(dlAll);
      }
      var chat = el('a', 'btn' + (entitled ? ' secondary' : ''), 'Keep building with Clay');
      chat.href = '/app.html?concept=' + encodeURIComponent(id);
      cActs.appendChild(chat);
      if (assets.some(function (a) { return a.type === 'html_demo' || a.type === 'built_site'; })) {
        var demo = el('a', 'btn secondary', 'Open the live demo');
        demo.href = '/sandbox.html?concept=' + encodeURIComponent(id);
        cActs.appendChild(demo);
      }
      if (!concept.is_operating) {
        var list = el('a', 'btn secondary', 'List this in the Dreamhold');
        list.href = '/app.html?concept=' + encodeURIComponent(id) + '&action=list';
        cActs.appendChild(list);
      }
      var consult = el('a', 'btn secondary', 'Book a consultant');
      consult.href = '/consultants.html?concept=' + encodeURIComponent(id);
      cActs.appendChild(consult);
      actionsEl.appendChild(cActs);

      // ---- keep / unlock, only when something is actually locked ----
      if (!entitled && lockedCount) {
        var keepBox = el('div', 'keep-note'); keepBox.setAttribute('role', 'note');
        keepBox.appendChild(el('p', null, 'Your business plan, marketing strategy, and live demo stay open for free. Keep this concept to unlock and download every section.'));
        var kb = el('button', 'btn', 'Keep this concept — $2.99'); kb.type = 'button';
        kb.addEventListener('click', function () { keep(id, kb); });
        keepBox.appendChild(kb);
        var unlim = el('button', 'btn secondary', 'Or go unlimited — $49.99/month'); unlim.type = 'button';
        unlim.addEventListener('click', function () { goUnlimited(unlim); });
        keepBox.appendChild(unlim);
        actionsEl.appendChild(keepBox);
      }

      announce('Your vault for ' + (concept.title || 'your concept') + '. ' + assets.length + ' section' + (assets.length === 1 ? '' : 's') + ' listed, each with View, Download, and Request an edit.', true);
      focusEl(titleEl);
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      titleEl.textContent = 'Couldn’t open this concept';
      var msg = (e.status === 410 || e.status === 404)
        ? 'That concept isn’t available anymore.'
        : ('Something went wrong: ' + (e.message || 'unknown error'));
      assetsEl.appendChild(el('p', 'msg err', msg));
      var back = el('a', 'btn', 'Back to your Laboratory'); back.href = '/app.html'; assetsEl.appendChild(back);
      announce(msg, true);
    }
  })();
})();
