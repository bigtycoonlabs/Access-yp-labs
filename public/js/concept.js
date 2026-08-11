// Project vault — a calm, screen-reader-first home for ONE project's materials.
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
  var titleEl = document.getElementById('project-title');
  var takeEl = document.getElementById('clays-take');
  var assetsEl = document.getElementById('assets');
  var actionsEl = document.getElementById('project-actions');

  if (!id) {
    titleEl.textContent = 'Project not found';
    assetsEl.appendChild(el('p', 'muted', 'This link is missing a project. Head back to your Laboratory to pick one.'));
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
      // Render as a picture ONLY when the body really IS one (a data: image or an image URL).
      // The 'example_image' TYPE alone is not enough: Clay also stores written image BRIEFS under
      // that type, and pointing an <img> at prose renders nothing — which, for a screen-reader
      // user, silently swallows the text instead of reading it. Judge the content, not the label.
      var isImage = /^data:image\//i.test(raw)
        || /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(raw)
        || /^https?:\/\/\S*\/storage\/v1\/object\/public\/concept-images\//i.test(raw);
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
      if (e.status === 402) { announce(label + ' unlocks when you keep this project.', true); return; }
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
      if (e.status === 402) { announce(label + ' unlocks when you keep this project.', true); return; }
      announce('Could not download ' + label + ': ' + e.message, true);
    }
  }

  async function downloadAll(conceptId) {
    announce('Preparing your package…');
    try {
      var r = await Kiln.api('/concepts/' + conceptId + '/export');
      var text = (r.assets || []).map(function (a) { return '# ' + (a.title || a.type) + '\n\n' + (a.body || '') + '\n'; }).join('\n\n');
      saveText(text, 'project-package.md');
      announce('Your package download has started.', true);
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      if (e.status === 402) { announce('Keep this project to download the full package.', true); return; }
      announce('Could not export: ' + e.message, true);
    }
  }

  async function keep(conceptId, btn) {
    if (btn) btn.disabled = true;
    try {
      var r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'builder', concept_id: conceptId } });
      if (r && r.url) { location.href = r.url; return; }
      announce((r && r.message) || 'Billing isn’t set up yet, so nothing was charged.', true);
    } catch (e) { if (e.sessionExpired) return goSignIn(); announce(e.message, true); }
    if (btn) btn.disabled = false;
  }

  // The plan — offered at the moment someone wants to keep a project beyond their free first one.
  async function goUnlimited(btn) {
    if (btn) btn.disabled = true;
    try {
      var r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'builder' } });
      if (r && r.url) { location.href = r.url; return; }
      announce((r && r.message) || 'Billing isn’t set up yet, so nothing was charged.', true);
    } catch (e) { if (e.sessionExpired) return goSignIn(); announce(e.message, true); }
    if (btn) btn.disabled = false;
  }

  // Compute REAL unit economics for this project (the platform does the math; Clay only estimates
  // the inputs). Shows the computed figures right here and upgrades the money section for next time.

  // ---- What this is worth, and what would raise it ----------------------------------------------
  //
  // The platform tells people their idea has value. Until now it never told them HOW MUCH, or what
  // adding one more piece would do to it — so "add a marketing strategy" was a chore with no visible
  // payoff, and listing it for sale was a decision nobody had the information to make.
  //
  // Two rules this holds to, because a number attached to somebody's hopes is easy to abuse:
  //   * It is called an EXAMPLE range. Never recommended, suggested, advised, or a valuation —
  //     those words turn a description of what comparable packages have listed at into a number the
  //     platform is telling somebody to charge, and we are not in a position to tell anybody that.
  //   * The ceiling RISES with what has been built. A number that cannot respond to somebody's work
  //     gives them no reason to keep working, which is the opposite of the point.
  //   * It never implies the thing will sell. Most listed things do not, and a platform that lets
  //     somebody read a number as a promise has mis-sold them.
  async function renderValue(conceptId){
    const panel = document.getElementById('value-panel');
    const body = document.getElementById('value-body');
    if (!panel || !body) return;
    let v;
    try { v = await Kiln.api('/concepts/' + conceptId + '/value'); }
    catch (e) {
      // Silent rather than an error box: this is a helpful extra, and a project page that shouts
      // about a failed sidebar is worse than one that quietly does without it.
      return;
    }
    panel.hidden = false;
    body.innerHTML = '';

    body.appendChild(el('p', null, v.tier_label + '.'));

    const range = el('p');
    // EXAMPLE, always. Not recommended, suggested or advised — those words turn a description of
    // what other packages have listed at into a number the platform is telling somebody to charge,
    // and we are not in a position to tell anybody that.
    range.appendChild(el('strong', null, 'Example range: $' + v.range_usd.low.toLocaleString()
      + ' to $' + v.range_usd.high.toLocaleString()));
    body.appendChild(range);
    body.appendChild(el('p', 'muted',
      'An example of what packages carrying this much have listed at. Not a valuation, not a '
      + 'recommendation, and not a promise that it sells — most listed projects do not. You set '
      + 'your own price.'));

    // The ceiling moves with depth, so say so plainly. Somebody who cannot see that the number
    // responds to their work has no reason to keep working.
    if (v.depth) {
      body.appendChild(el('p', 'muted',
        v.depth.kinds + ' different kinds of material so far'
        + (v.depth.beyond_baseline > 0
            ? (', ' + v.depth.beyond_baseline + ' of them beyond a first build — which is why the top of that range is where it is.')
            : '. Each further kind you add moves the top of that range.')
        + (v.depth.uncapped ? ' At this stage there is no ceiling on it.' : '')));
    }

    if (v.drivers && v.drivers.length){
      body.appendChild(el('h3', null, 'What it is built on'));
      const ul = el('ul');
      v.drivers.forEach(function(d){ ul.appendChild(el('li', null, d)); });
      body.appendChild(ul);
    }

    if (v.to_raise && v.to_raise.length){
      // The whole point of the panel. Somebody will not add a piece they do not know is worth
      // adding, so the next step is named rather than left to be inferred from a low number.
      body.appendChild(el('h3', null, 'What would raise it'));
      const ul2 = el('ul');
      v.to_raise.forEach(function(r){ ul2.appendChild(el('li', null, r)); });
      body.appendChild(ul2);
      const ask = el('p');
      const a = el('button', 'btn secondary', 'Ask Clay to do the next one');
      a.type = 'button';
      a.addEventListener('click', function(){
        // Hand Clay the specific next step rather than dropping somebody into an empty box.
        location.href = '/app.html?project=' + encodeURIComponent(conceptId)
          + '&ask=' + encodeURIComponent(v.to_raise[0]);
      });
      ask.appendChild(a);
      body.appendChild(ask);
    } else {
      body.appendChild(el('p', null,
        'This carries everything that moves the example range. The next move is a decision rather than '
        + 'another piece: launch it yourself, or list it.'));
    }
  }

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
          var host = document.getElementById('project-actions');
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

  // ---- THIS PROJECT'S DREAM MARKET LISTING ----
  //
  // The project page had no idea a listing existed. It showed the vault, the images, the store, the
  // sales and the plan, and said nothing about the thing being sold — the word "listing" appeared
  // once on the whole page, inside a comment. Editing lived on a different page entirely
  // (dashboard.html) and nothing here pointed at it.
  //
  // The owner's own auction sat unedited for a week for exactly this reason: "I go to my listing in
  // my account and I don't know where to edit anything." A feature nobody can find is not a feature,
  // and this is the same fault as a component that renders correctly and is announced to nobody.
  //
  // It also has to say WHY, not just where. A live listing's terms are locked on purpose so nobody
  // can change a price out from under a bidder. Sending somebody to an edit screen that will refuse
  // them, without saying so first, is a worse version of not sending them at all.
  async function listingBox(conceptId, project) {
    var sect = el('section', 'panel');
    sect.setAttribute('aria-labelledby', 'listing-h');
    var h = el('h2', null, 'Your Dream Market listing'); h.id = 'listing-h';
    sect.appendChild(h);
    actionsEl.appendChild(sect);

    var listing = null;
    try {
      var r = await Kiln.api('/listings/mine');
      listing = (r.listings || []).filter(function (x) { return x.concept_id === conceptId; })[0] || null;
    } catch (e) {
      if (e && e.sessionExpired) return goSignIn();
      // A failed read is not "no listing". Saying "not listed" here would tell somebody their
      // listing had vanished.
      sect.appendChild(el('p', 'msg err', 'Could not check whether this project is listed: '
        + ((e && e.message) || 'unknown reason') + '. That is a failed read, not an empty one — '
        + 'your listing has not changed.'));
      return;
    }

    if (!listing) {
      // A business somebody already runs cannot be listed — the API refuses it with a 409, and that
      // is the right rule: the Dream Market sells unlaunched projects, not live operations.
      //
      // I wrote this section earlier in the same session as the staff fix that says an offered
      // button the server will refuse is the same as a button that does nothing, and then made that
      // exact mistake here. Opening it on the live site is what caught it: a Cleveland cleaning
      // business, already running, being offered "List this project for sale" that could only ever
      // end in a refusal.
      if (project && project.is_operating) {
        sect.appendChild(el('p', null, 'This is a business you already run, so it is not for sale '
          + 'here. The Dream Market sells projects that have not launched yet, not live operations '
          + 'somebody is depending on. Everything else on this page still works — keep building it, '
          + 'and it stays yours.'));
        return;
      }
      sect.appendChild(el('p', null, 'This project is not on the Dream Market. Listing it puts it in '
        + 'front of buyers looking for a business to start. Most listed projects do not sell.'));
      var sell = el('a', 'btn', 'List this project for sale');
      sell.href = '/sell.html?project=' + encodeURIComponent(conceptId);
      sect.appendChild(sell);
      return;
    }

    var STATE = {
      draft: 'a draft — nobody can see it yet',
      in_review: 'waiting for staff to approve it',
      live: 'live on the market',
      sold: 'sold',
      withdrawn: 'taken off the market',
      rejected: 'not approved',
    };
    sect.appendChild(el('p', null, 'This project is ' + (STATE[listing.status] || listing.status) + '.'));
    sect.appendChild(el('p', 'price', Kiln.priceLabel(listing)));

    if (listing.format === 'auction' && !listing.auction_close_at) {
      sect.appendChild(el('p', 'msg err', 'This auction has no closing time, so no winner can ever be '
        + 'decided and nobody can bid on it or buy it. To fix it: take it off the market, set an end '
        + 'date, and put it back.'));
    }

    var acts = el('p');
    acts.style.display = 'flex'; acts.style.gap = '10px'; acts.style.flexWrap = 'wrap';

    if (listing.status === 'live' || listing.status === 'in_review') {
      // Say the rule before offering the button, so nobody walks into a refusal.
      sect.appendChild(el('p', 'muted', 'Its price and terms are locked while people can act on it. '
        + 'Take it off the market to change anything — then you can put it straight back.'));
      var wd = el('button', 'btn secondary', 'Take it off the market so I can edit it'); wd.type = 'button';
      var said = el('div'); said.setAttribute('role', 'alert'); said.setAttribute('aria-live', 'assertive');
      wd.addEventListener('click', async function () {
        wd.disabled = true; announce('Taking it off the market\u2026');
        try {
          await Kiln.api('/listings/' + listing.id + '/withdraw', { method: 'POST' });
          said.textContent = 'Taken off the market. You can edit it now and put it straight back.';
          announce(said.textContent, true);
          var go = el('a', 'btn', 'Edit this listing');
          go.href = '/dashboard.html#listings';
          said.appendChild(document.createTextNode(' '));
          said.appendChild(go);
          if (window.focusEl) focusEl(said, 'Taken off the market');
        } catch (e2) {
          wd.disabled = false;
          if (e2 && e2.sessionExpired) return goSignIn();
          said.textContent = 'That did not go through, so nothing changed: ' + ((e2 && e2.message) || 'unknown reason');
          announce(said.textContent, true);
        }
      });
      acts.appendChild(wd);
      sect.appendChild(acts);
      sect.appendChild(said);
    } else if (listing.status === 'draft' || listing.status === 'withdrawn') {
      var edit = el('a', 'btn', 'Edit this listing');
      edit.href = '/dashboard.html#listings';
      acts.appendChild(edit);
      sect.appendChild(acts);
    }

    if (listing.status === 'live') {
      var view = el('a', 'btn secondary', 'See it the way a buyer does');
      view.href = '/listing.html?id=' + encodeURIComponent(listing.id);
      acts.appendChild(view);
    }
  }

  // ---- delete this project ----
  // A creator must be able to remove their own work. Two steps on purpose: the first button only
  // reveals the confirmation, so a mis-tap can never delete anything, and the confirm step states
  // plainly and out loud that it is permanent. Owner-scoped server-side.
  function deleteBox(conceptId, title) {
    var box = el('div', 'danger-zone');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Delete this project');
    box.appendChild(el('h2', null, 'Delete this project'));
    box.appendChild(el('p', 'muted', 'Removes ' + title + ' and everything in it \u2014 every section, image, and product. This cannot be undone.'));

    var start = el('button', 'btn secondary', 'Delete this project'); start.type = 'button';
    box.appendChild(start);

    start.addEventListener('click', function () {
      if (box.querySelector('.confirm-row')) return;
      // Focus returns to the control that opened this. Removing it otherwise drops the user at
      // the top of the document, losing their place.
      var opener = document.activeElement;
      var restore = function () { try { if (opener && opener.focus && document.contains(opener)) opener.focus(); } catch (e) {} };
      var row = el('div', 'confirm-row');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Confirm deleting this project');
      row.appendChild(el('p', null, 'Permanently delete ' + title + '? This cannot be undone.'));
      var yes = el('button', 'btn', 'Yes, permanently delete'); yes.type = 'button';
      var no = el('button', 'btn secondary', 'No, keep it'); no.type = 'button';
      row.appendChild(yes); row.appendChild(no);
      box.appendChild(row);
      announce('Confirm required. Permanently delete ' + title + '? This cannot be undone.', true);
      if (no.focus) no.focus();

      no.addEventListener('click', function () {
        row.remove(); restore();
        announce('Okay \u2014 nothing was deleted.', true);
        if (start.focus) start.focus();
      });

      yes.addEventListener('click', async function () {
        yes.disabled = true; no.disabled = true;
        try {
          await Kiln.api('/concepts/' + conceptId, { method: 'DELETE' });
          announce(title + ' was deleted. Taking you back to your Laboratory.', true);
          setTimeout(function () { location.href = '/dashboard.html'; }, 1400);
        } catch (e) {
          yes.disabled = false; no.disabled = false;
          if (e && e.sessionExpired) return goSignIn();
          row.appendChild(el('p', 'msg err', 'That didn\u2019t go through \u2014 nothing was deleted.'));
          announce('That did not go through. Nothing was deleted.', true);
        }
      });
    });

    actionsEl.appendChild(box);
  }

  // ---- Images: the account's monthly allowance, and making one on demand ----
  function extrasSummary(b) {
    var s = b.used_this_month + ' of ' + b.monthly_included + ' monthly image'
      + (b.monthly_included === 1 ? '' : 's') + ' used — ' + b.free_remaining + ' left this month.';
    if (b.purchased_balance > 0) s += ' Plus ' + b.purchased_balance + ' you bought earlier, which still work.';
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
      var sect = el('section', 'extras'); sect.setAttribute('aria-label', 'Images');
      sect.appendChild(el('h2', null, 'Images'));
      sect.appendChild(el('p', 'extras-summary', extrasSummary(r.budget || {})));
      var acts = el('div', 'actions');
      var mk = el('button', 'btn secondary', 'Make an image'); mk.type = 'button';
      mk.addEventListener('click', function () { makeImage(conceptId, mk, sect); });
      acts.appendChild(mk);
      // Image packs are retired. The monthly allowance is per account and generous enough that
      // almost nobody reached the paywall, so selling packs earned close to nothing while making
      // the product feel like it was counting pennies. Any balance someone already bought is still
      // honoured and still spends — it is shown in the summary above.
      sect.appendChild(acts);
      var status = el('p', 'muted extras-status');
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      sect.appendChild(status);
      actionsEl.appendChild(sect);
    } catch (e) { /* skip silently */ }
  }

  function saleDate(s) { try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } }

  // Your sales — a truthful read of this project's storefront orders. Owner-only (the endpoint
  // 404s for anyone else, so we skip quietly). Paid orders count toward the total; started-but-
  // unfinished checkouts are noted separately and never counted as money.
  async function loadSales(conceptId) {
    try {
      var r = await Kiln.api('/concepts/' + conceptId + '/orders');
      if (!r || !r.ok) return;
      var sum = r.summary || {};
      var orders = r.orders || [];
      var paid = orders.filter(function (o) { return o.status === 'paid'; });
      // Only show the section once there's a store selling — no empty "sales" box on every project.
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

  // ---- Creator Path: where are you taking THIS project? (per-project intent) ----
  // The plan shapes how Clay coaches this project and is settable in plain conversation too; this is
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
    host.setAttribute('aria-label', 'Your plan for this project');
    host.appendChild(el('h2', null, 'Your plan for this project'));
    host.appendChild(el('p', 'muted', 'Tell Clay where you’re taking this one — it shapes how he helps, and you can change it anytime. There’s no wrong answer and no ceiling: a project can go as far as you want.'));
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
      // `data.concept`, not `data.project`. The endpoint has always returned { concept, assets,
      // entitled }, so this was `{}` on every project page anybody has ever opened, and every read
      // off it came back undefined — silently, because `|| {}` makes the wrong key look like an
      // empty object rather than a mistake.
      //
      // Found by opening the page in a browser on the live site. Six things were broken by it and
      // not one of them threw:
      //   the h1 and the document title never said the project's name, only "Your project" — so
      //     every project a person owns announces the same heading to a screen reader
      //   Clay's take on the project never appeared
      //   the value panel called /concepts/undefined/value and 404'd, so "what this is worth"
      //     rendered as nothing at all
      //   the delete box said "this project" instead of naming what it was about to delete
      //   the spoken vault summary said "your project" instead of the title
      //   and `if (!project.is_operating)` was ALWAYS true, so "List this in the Dream Market" was
      //     offered on businesses the API refuses to list. The guard was written correctly and had
      //     never once run.
      //
      // Same shape as PropertyDetail.tsx reading property.square_feet on the sister platform: a key
      // that never existed, undefined for the life of the page, and nobody noticed because nothing
      // failed loudly.
      var project = data.concept || data.project || {};
      var entitled = data.entitled !== false;
      var assets = (data.assets || []).filter(function (a) { return a && a.is_current !== false; });

      document.title = (project.title || 'Your project') + ' — Access YP Labs';
      titleEl.textContent = project.title || 'Your project';
      if (project.clays_take) { takeEl.textContent = project.clays_take; takeEl.hidden = false; }

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
          sec.appendChild(el('p', 'muted', 'Built and waiting — unlocks when you keep this project.'));
        }
        var edit = el('a', 'btn secondary', 'Request an edit');
        edit.href = '/app.html?project=' + encodeURIComponent(id) + '&edit=' + encodeURIComponent(a.type) + '&editTitle=' + encodeURIComponent(label);
        acts.appendChild(edit);
        sec.appendChild(acts);
        assetsEl.appendChild(sec);
      });

      // ---- project-level actions ----
      var cActs = el('div', 'actions');
      if (entitled) {
        var dlAll = el('button', 'btn', 'Download the whole package'); dlAll.type = 'button';
        dlAll.addEventListener('click', function () { downloadAll(id); });
        cActs.appendChild(dlAll);
      }
      var chat = el('a', 'btn' + (entitled ? ' secondary' : ''), 'Keep building with Clay');
      chat.href = '/app.html?project=' + encodeURIComponent(id);
      cActs.appendChild(chat);
      if (assets.some(function (a) { return a.type === 'html_demo' || a.type === 'built_site'; })) {
        var demo = el('a', 'btn secondary', 'Open the live demo');
        demo.href = '/sandbox.html?project=' + encodeURIComponent(id);
        cActs.appendChild(demo);
      }
      if (!project.is_operating) {
        var list = el('a', 'btn secondary', 'List this in the Dream Market');
        list.href = '/app.html?project=' + encodeURIComponent(id) + '&action=list';
        cActs.appendChild(list);
      }
      // 'Book a consultant' pointed at a retired offer — a live button to a room nobody is in.
      // Launch partners is what replaced it, so that is where this goes now.
      var partner = el('a', 'btn secondary', 'Find a launch partner');
      partner.href = '/partners.html?project=' + encodeURIComponent(id);
      cActs.appendChild(partner);
      var econ = el('button', 'btn secondary', 'Compute the real numbers'); econ.type = 'button';
      econ.addEventListener('click', function () { computeEconomics(id, econ); });
      cActs.appendChild(econ);
      actionsEl.appendChild(cActs);
      loadExtras(id);
      loadStore(id);
      loadSales(id);
      // Before the danger zone: what a creator most often came here to do is see and change what is
      // for sale, and deleting the project should never be the last thing on the page they read.
      listingBox(id, project);
      deleteBox(id, project.title || 'this project');

      // ---- keep / unlock, only when something is actually locked ----
      if (!entitled && lockedCount) {
        var keepBox = el('div', 'keep-note'); keepBox.setAttribute('role', 'note');
        keepBox.appendChild(el('p', null, 'Your business plan, marketing strategy, and live demo stay open for free. Keep this project to unlock and download every section.'));
        var kb = el('button', 'btn', 'Unlimited projects — $19/month'); kb.type = 'button';
        kb.addEventListener('click', function () { keep(id, kb); });
        keepBox.appendChild(kb);
        var unlim = el('button', 'btn secondary', 'See what the plan includes'); unlim.type = 'button';
        unlim.addEventListener('click', function () { goUnlimited(unlim); });
        keepBox.appendChild(unlim);
        actionsEl.appendChild(keepBox);
      }

      // Show what it is worth and what would raise it. Not awaited into the render path: a slow or
      // failed valuation must never delay somebody seeing their own work.
      renderValue(project.id).catch(function(){});

      announce('Your vault for ' + (project.title || 'your project') + '. ' + assets.length + ' section' + (assets.length === 1 ? '' : 's') + ' listed, each with View, Download, and Request an edit.', true);
      focusEl(titleEl);
    } catch (e) {
      if (e.sessionExpired) return goSignIn();
      titleEl.textContent = 'Couldn’t open this project';
      var msg = (e.status === 410 || e.status === 404)
        ? 'That project isn’t available anymore.'
        : ('Something went wrong: ' + (e.message || 'unknown error'));
      assetsEl.appendChild(el('p', 'msg err', msg));
      var back = el('a', 'btn', 'Back to your Laboratory'); back.href = '/app.html'; assetsEl.appendChild(back);
      announce(msg, true);
    }
  })();
})();
