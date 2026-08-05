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
      var asset = r.asset || {};
      var body;
      var raw = String(asset.body || '');
      var isImage = asset.type === 'example_image'
        || /^data:image\//i.test(raw)
        || /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(raw);
      if (isImage && raw) {
        body = el('div', 'asset-body');
        var img = document.createElement('img');
        img.src = raw;
        img.alt = asset.title || label;   // the description Clay wrote, spoken by VoiceOver
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        body.appendChild(img);
      } else {
        body = el('div', 'asset-body', asset.body || '(empty)');
      }
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

  // Compute REAL unit economics for this concept (the platform does the math; Clay only estimates
  // the inputs). Shows the computed figures right here and upgrades the money section for next time.
  async function computeEconomics(conceptId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Computing the real numbers…'; }
    announce('Computing the real unit economics. This can take a moment.');
    try {
      var r = await Kiln.api('/clay/concept/' + conceptId + '/economics', { method: 'POST' });
      if (r && r.ok && r.body) {
        var out = document.getElementById('econ-out');
        if (!out) {
          out = el('div', 'asset-body'); out.id = 'econ-out'; out.setAttribute('tabindex', '-1');
          out.setAttribute('role', 'region'); out.setAttribute('aria-label', 'Computed unit economics');
          var host = document.getElementById('concept-actions');
          if (host) host.appendChild(out);
        }
        out.hidden = false; out.textContent = r.body;
        announce(r.message || 'Computed the real unit economics.', true);
        if (window.focusEl) focusEl(out, 'Computed unit economics');
      } else {
        announce((r && r.message) || 'Couldn’t compute the numbers right now, so nothing was changed.', true);
      }
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      announce(e.message || 'Couldn’t compute the numbers right now.', true);
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Compute the real numbers'; }
  }

  // ---- Extras: per-concept image budget, packs, and manual generation ----
  function extrasSummary(b) {
    var s = b.used_this_month + ' of ' + b.monthly_included + ' monthly image'
      + (b.monthly_included === 1 ? '' : 's') + ' used — ' + b.free_remaining + ' left this month.';
    if (b.purchased_balance > 0) s += ' Plus ' + b.purchased_balance + ' from your Extras packs.';
    return s;
  }

  async function refreshExtras(conceptId, sect) {
    try {
      var r = await Kiln.api('/clay/concept/' + conceptId + '/images');
      if (!r || !r.ok) return;
      var line = sect.querySelector('.extras-summary');
      if (line) line.textContent = extrasSummary(r.budget || {});
    } catch (e) { /* leave the last summary in place */ }
  }

  async function makeImage(conceptId, btn, sect) {
    var status = sect.querySelector('.extras-status');
    var was = btn.textContent; btn.disabled = true; btn.textContent = 'Making an image…';
    if (status) status.textContent = 'Making an image…';
    try {
      var r = await Kiln.api('/clay/concept/' + conceptId + '/image', { method: 'POST', body: { kind: 'logo' } });
      var msg = (r && r.message) ? r.message : (r && r.ok ? 'Image added to your vault.' : 'Couldn’t make an image right now.');
      if (status) status.textContent = msg;
      announce(msg, true);
      await refreshExtras(conceptId, sect);
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      var m = e.message || 'Couldn’t make an image right now.';
      if (status) status.textContent = m; announce(m, true);
    }
    btn.disabled = false; btn.textContent = was;
  }

  async function buyPack(conceptId, packId, btn, sect) {
    var status = sect.querySelector('.extras-status');
    var was = btn.textContent; btn.disabled = true; btn.textContent = 'Opening checkout…';
    try {
      var r = await Kiln.api('/clay/concept/' + conceptId + '/image-pack', { method: 'POST', body: { pack_id: packId } });
      if (r && r.ok && r.url) { announce('Opening secure checkout.', true); window.location.href = r.url; return; }
      var m = (r && r.message) ? r.message : 'Couldn’t start checkout, so nothing was charged.';
      if (status) status.textContent = m; announce(m, true);
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      var m2 = e.message || 'Couldn’t start checkout, so nothing was charged.';
      if (status) status.textContent = m2; announce(m2, true);
    }
    btn.disabled = false; btn.textContent = was;
  }

  async function loadExtras(conceptId) {
    try {
      var r = await Kiln.api('/clay/concept/' + conceptId + '/images');
      if (!r || !r.ok) return;   // owner/staff only — skip quietly for anyone else
      var sect = el('section', 'extras'); sect.setAttribute('aria-label', 'Extras — images');
      sect.appendChild(el('h2', null, 'Extras — images'));
      sect.appendChild(el('p', 'extras-summary', extrasSummary(r.budget || {})));
      var acts = el('div', 'actions');
      var mk = el('button', 'btn secondary', 'Make an image'); mk.type = 'button';
      mk.addEventListener('click', function () { makeImage(conceptId, mk, sect); });
      acts.appendChild(mk);
      (r.packs || []).forEach(function (p) {
        var lbl = 'Buy ' + p.images + ' more images — $' + (p.price_cents / 100).toFixed(2);
        var pb = el('button', 'btn secondary', lbl); pb.type = 'button';
        pb.addEventListener('click', function () { buyPack(conceptId, p.id, pb, sect); });
        acts.appendChild(pb);
      });
      sect.appendChild(acts);
      var status = el('p', 'muted extras-status');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      sect.appendChild(status);
      actionsEl.appendChild(sect);
    } catch (e) { /* skip silently */ }
  }

  function saleDate(s) { try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } }

  // Your sales — a truthful read of this concept's storefront orders. Owner-only (the endpoint
  // 404s for anyone else, so we skip quietly). Paid orders count toward the total; started-but-
  // unfinished checkouts are noted separately and never counted as money.
  async function loadSales(conceptId) {
    try {
      var r = await Kiln.api('/concepts/' + conceptId + '/orders');
      if (!r || !r.ok) return;
      var sum = r.summary || {};
      var orders = r.orders || [];
      var paid = orders.filter(function (o) { return o.status === 'paid'; });
      // Only show the section once there's a store selling — no empty "sales" box on every concept.
      if (!paid.length && !orders.length) return;
      var sect = el('section', 'sales'); sect.setAttribute('aria-label', 'Your sales');
      sect.appendChild(el('h2', null, 'Your sales'));
      var line = (sum.paid_count === 1)
        ? 'You’ve made 1 sale, ' + (sum.paid_total_display || '$0.00') + ' in total. This money goes to your own account.'
        : 'You’ve made ' + (sum.paid_count || 0) + ' sales, ' + (sum.paid_total_display || '$0.00') + ' in total. This money goes to your own account.';
      sect.appendChild(el('p', 'sales-summary', line));
      if (!paid.length) {
        sect.appendChild(el('p', 'muted', 'No completed sales yet. When someone buys, it’ll show up here.'));
      } else {
        var ul = el('ul', 'sales-list');
        paid.forEach(function (o) {
          var when = saleDate(o.paid_at || o.created_at);
          var txt = o.product_name + ' — ' + o.amount_display + (when ? ' on ' + when : '') + (o.buyer_email ? ' — ' + o.buyer_email : '');
          ul.appendChild(el('li', null, txt));
        });
        sect.appendChild(ul);
      }
      var unfinished = orders.length - paid.length;
      if (unfinished > 0) {
        sect.appendChild(el('p', 'muted', (unfinished === 1
          ? '1 checkout was started but not completed'
          : unfinished + ' checkouts were started but not completed') + ' — not counted above, and nothing was charged for those.'));
      }
      actionsEl.appendChild(sect);
    } catch (e) { /* skip silently */ }
  }

  // Your store — manual catalog management, owner-only (the endpoint 404s otherwise, so we skip
  // quietly). A creator adds/edits/hides/removes their own products here without needing Clay:
  // digital items (delivered by a link after payment) or physical items (a shipping address is
  // collected at checkout). Screen-reader-first: every field is labelled, actions announce results.
  async function loadStore(conceptId) {
    var first;
    try { first = await Kiln.api('/concepts/' + conceptId + '/products'); } catch (e) { return; }
    if (!first || !first.ok) return;

    var sect = el('section', 'store-mgr'); sect.setAttribute('aria-label', 'Your store');
    sect.appendChild(el('h2', null, 'Your store'));
    sect.appendChild(el('p', 'muted', 'Add what you want to sell — digital items delivered by a link, or physical items you ship. You set the price, and when someone buys, the money goes to your own account.'));
    var status = el('p', 'muted'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    var listWrap = el('div', 'product-list');

    function mkField(labelText, input, idBase, key) {
      var id = 'pf-' + idBase + '-' + key; input.id = id;
      var wrap = el('div', 'field');
      var lab = el('label', null, labelText); lab.setAttribute('for', id);
      wrap.appendChild(lab); wrap.appendChild(input);
      return wrap;
    }
    function textInput(val) { var i = document.createElement('input'); i.type = 'text'; if (val != null) i.value = val; return i; }
    function textArea(val) { var t = document.createElement('textarea'); if (val != null) t.value = val; t.rows = 2; return t; }

    async function reload() {
      try { var rr = await Kiln.api('/concepts/' + conceptId + '/products'); if (rr && rr.ok) renderList(rr.products || []); } catch (e) { /* keep current */ }
    }

    function buildForm(existing) {
      var idBase = existing ? existing.id : 'new';
      var form = el('div', 'product-form');
      var nameI = textInput(existing ? existing.name : '');
      var priceI = textInput(existing ? (existing.price_cents / 100).toFixed(2) : ''); priceI.setAttribute('inputmode', 'decimal');
      var descI = textArea(existing ? existing.description : '');
      var imgI = textInput(existing ? existing.image_url : '');
      var fulI = textInput(existing ? existing.fulfillment_url : '');
      form.appendChild(mkField('Product name', nameI, idBase, 'name'));
      form.appendChild(mkField('Price (like 19.99)', priceI, idBase, 'price'));
      var fs = el('fieldset', 'kind-choices'); fs.appendChild(el('legend', null, 'Type'));
      var curKind = (existing && existing.kind) || 'digital';
      ['digital', 'physical'].forEach(function (k) {
        var rowk = el('div', 'kind-choice');
        var ri = document.createElement('input'); ri.type = 'radio'; ri.name = 'kind-' + idBase; ri.id = 'pf-' + idBase + '-kind-' + k; ri.value = k;
        if (curKind === k) ri.checked = true;
        var rl = el('label', null, k === 'digital' ? 'Digital (delivered by a link)' : 'Physical (you ship it)'); rl.setAttribute('for', ri.id);
        rowk.appendChild(ri); rowk.appendChild(rl); fs.appendChild(rowk);
      });
      form.appendChild(fs);
      form.appendChild(mkField('Description (optional)', descI, idBase, 'desc'));
      form.appendChild(mkField('Image link, https (optional)', imgI, idBase, 'img'));
      form.appendChild(mkField('Delivery link for a digital item, https (optional)', fulI, idBase, 'ful'));
      var save = el('button', 'btn', existing ? 'Save changes' : 'Add product'); save.type = 'button';
      save.addEventListener('click', async function () {
        var chosen = form.querySelector('input[name="kind-' + idBase + '"]:checked');
        var body = { name: nameI.value, price: priceI.value, kind: (chosen && chosen.value) || 'digital',
          description: descI.value, image_url: imgI.value, fulfillment_url: fulI.value };
        save.disabled = true;
        try {
          if (existing) { await Kiln.api('/concepts/' + conceptId + '/products/' + existing.id, { method: 'PATCH', body: body }); status.textContent = 'Saved “' + (nameI.value || 'product') + '”.'; announce('Product saved.'); }
          else { await Kiln.api('/concepts/' + conceptId + '/products', { method: 'POST', body: body }); status.textContent = 'Added “' + (nameI.value || 'product') + '”.'; announce('Product added.'); nameI.value = ''; priceI.value = ''; descI.value = ''; imgI.value = ''; fulI.value = ''; }
          await reload();
        } catch (e) {
          if (e.sessionExpired) return goSignIn();
          status.textContent = e.message || 'Could not save that, so nothing changed.'; announce(status.textContent, true);
        }
        save.disabled = false;
      });
      form.appendChild(save);
      return form;
    }

    function renderList(products) {
      listWrap.textContent = '';
      if (!products.length) { listWrap.appendChild(el('p', 'muted', 'No products yet. Add your first one below.')); return; }
      products.forEach(function (p) {
        var row = el('div', 'product-row');
        row.appendChild(el('h3', null, p.name + ' — ' + p.price_display + ' (' + p.kind + ')' + (p.active ? '' : ' — hidden')));
        if (p.description) row.appendChild(el('p', 'muted', p.description));
        var acts = el('div', 'actions');
        var vis = el('button', 'btn secondary', p.active ? 'Hide' : 'Show'); vis.type = 'button';
        vis.addEventListener('click', async function () {
          try { await Kiln.api('/concepts/' + conceptId + '/products/' + p.id, { method: 'PATCH', body: { active: !p.active } }); announce(p.active ? 'Hidden.' : 'Shown.'); reload(); }
          catch (e) { if (e.sessionExpired) return goSignIn(); status.textContent = e.message || 'Could not change that.'; announce(status.textContent, true); }
        });
        acts.appendChild(vis);
        var editForm = buildForm(p); editForm.hidden = true;
        var edit = el('button', 'btn secondary', 'Edit'); edit.type = 'button'; edit.setAttribute('aria-expanded', 'false');
        edit.addEventListener('click', function () { var open = !editForm.hidden; editForm.hidden = open; edit.setAttribute('aria-expanded', String(!open)); });
        acts.appendChild(edit);
        var rm = el('button', 'btn secondary', 'Remove'); rm.type = 'button';
        rm.addEventListener('click', async function () {
          try { await Kiln.api('/concepts/' + conceptId + '/products/' + p.id, { method: 'DELETE' }); announce('Product removed.'); reload(); }
          catch (e) { if (e.sessionExpired) return goSignIn(); status.textContent = e.message || 'Could not remove that.'; announce(status.textContent, true); }
        });
        acts.appendChild(rm);
        row.appendChild(acts); row.appendChild(editForm);
        listWrap.appendChild(row);
      });
    }

    renderList(first.products || []);
    sect.appendChild(listWrap);
    sect.appendChild(el('h3', null, 'Add a product'));
    sect.appendChild(buildForm(null));
    sect.appendChild(status);
    actionsEl.appendChild(sect);
  }

  // ---- Creator Path: where are you taking THIS concept? (per-concept intent) ----
  // The plan shapes how Clay coaches this concept and is settable in plain conversation too; this is
  // the visible, screen-reader-first control for it. There is no wrong answer and no ceiling.
  async function savePlan(conceptId, pathId, label, status) {
    status.textContent = 'Saving…';
    try {
      await Kiln.api('/clay/concept/' + conceptId + '/path', { method: 'POST', body: { path: pathId } });
      status.textContent = 'Saved. Clay will help you ' + (label ? label.toLowerCase() : 'with this') + '.';
      announce('Plan saved: ' + label + '.', true);
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      status.textContent = 'Could not save that just now, so nothing changed.';
      announce('Could not save your plan.', true);
    }
  }

  function earnDisclosure() {
    var wrap = el('div', 'earn-wrap');
    var region = el('div', 'earn-region'); region.id = 'earn-region'; region.hidden = true;
    region.setAttribute('role', 'region'); region.setAttribute('aria-label', 'Ways to earn here');
    var btn = el('button', 'btn secondary', 'See the ways to earn here'); btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', region.id);
    btn.addEventListener('click', async function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      if (open) { region.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'See the ways to earn here'; return; }
      if (!region.dataset.loaded) {
        try {
          var r = await Kiln.api('/clay/earning-paths');
          (r.earning_paths || []).forEach(function (p) {
            region.appendChild(el('h3', null, p.title));
            region.appendChild(el('p', null, p.how));
          });
          region.dataset.loaded = '1';
        } catch (e) { region.appendChild(el('p', 'muted', 'Couldn’t load these right now.')); }
      }
      region.hidden = false; btn.setAttribute('aria-expanded', 'true'); btn.textContent = 'Hide the ways to earn';
      announce('Ways to earn shown.');
    });
    wrap.appendChild(btn); wrap.appendChild(region);
    return wrap;
  }

  async function renderPlan(conceptId) {
    var host = el('section', 'plan-section');
    host.setAttribute('aria-label', 'Your plan for this concept');
    host.appendChild(el('h2', null, 'Your plan for this concept'));
    host.appendChild(el('p', 'muted', 'Tell Clay where you’re taking this one — it shapes how he helps, and you can change it anytime. There’s no wrong answer and no ceiling: a concept can go as far as you want.'));
    var status = el('p', 'muted'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    try {
      var r = await Kiln.api('/clay/concept/' + conceptId + '/path');
      var current = (r.intent && r.intent.path) || null;
      var fs = el('fieldset', 'plan-choices');
      fs.appendChild(el('legend', null, 'Choose a plan'));
      (r.paths || []).forEach(function (p) {
        var row = el('div', 'plan-choice');
        var input = document.createElement('input');
        input.type = 'radio'; input.name = 'plan-' + conceptId;
        input.id = 'plan-' + conceptId + '-' + p.id; input.value = p.id;
        if (current === p.id) input.checked = true;
        input.addEventListener('change', function () { if (input.checked) savePlan(conceptId, p.id, p.label, status); });
        var lab = el('label'); lab.setAttribute('for', input.id);
        lab.appendChild(el('strong', null, p.label));
        lab.appendChild(document.createTextNode(' — ' + (p.short || '')));
        row.appendChild(input); row.appendChild(lab);
        fs.appendChild(row);
      });
      host.appendChild(fs);
      host.appendChild(status);
      if (r.intent && r.intent.note) { host.appendChild(el('p', 'muted', 'Your note: ' + r.intent.note)); }
    } catch (e) {
      if (e.sessionExpired) return;
      host.appendChild(el('p', 'muted', 'Your plan options couldn’t load right now.'));
    }
    host.appendChild(earnDisclosure());
    assetsEl.parentNode.insertBefore(host, assetsEl);
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

      renderPlan(id);

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
        var list = el('a', 'btn secondary', 'List this in the Dream Market');
        list.href = '/app.html?concept=' + encodeURIComponent(id) + '&action=list';
        cActs.appendChild(list);
      }
      var consult = el('a', 'btn secondary', 'Book a consultant');
      consult.href = '/consultants.html?concept=' + encodeURIComponent(id);
      cActs.appendChild(consult);
      var econ = el('button', 'btn secondary', 'Compute the real numbers'); econ.type = 'button';
      econ.addEventListener('click', function () { computeEconomics(id, econ); });
      cActs.appendChild(econ);
      actionsEl.appendChild(cActs);
      loadExtras(id);
      loadStore(id);
      loadSales(id);

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
