// The Dream Market dashboard — management overview with state-aware actions.
(function () {
  if (!Kiln.isLoggedIn()) {
    // localStorage may be wiped though the HttpOnly refresh cookie is still alive — recover
    // silently before bouncing to sign-in, so a returning user isn't logged out for no reason.
    Kiln.refresh().then(function (ok) {
      if (ok) location.reload();
      else location.replace('/login.html');
    });
    return;
  }
  let me = null;

  function el(t, c, x) { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function money(c) { return '$' + ((c || 0) / 100).toFixed(2); }
  function nice(s) { return String(s || '').replace(/_/g, ' '); }
  function row(title, meta, pillText) {
    const r = el('div', 'row');
    const h = el('h3', null, title);
    if (pillText) { const p = el('span', 'pill', nice(pillText)); p.style.marginLeft = '8px'; h.appendChild(p); }
    r.appendChild(h);
    if (meta) r.appendChild(el('p', 'muted', meta));
    const acts = el('div', 'actions'); r.appendChild(acts);
    r.actions = acts; return r;
  }
  function actionBtn(label, fn, secondary) {
    const b = el('button', 'btn' + (secondary ? ' secondary' : ''), label); b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true; try { await fn(); } catch (e) { announce(e.message, true); b.disabled = false; }
    });
    return b;
  }
  // A two-step confirmation for anything that cannot be undone. The first press only REVEALS the
  // choice, so a mis-tap can never trigger it, and focus lands on the SAFE option — which matters
  // most for someone navigating by keyboard or screen reader, where the destructive button might
  // otherwise be the thing under their finger. Same pattern as deleting a project.
  function confirmAction(container, question, confirmLabel, fn) {
    if (container.querySelector('.confirm-row')) return;
    const row = el('div', 'confirm-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', question);
    row.appendChild(el('p', null, question));
    const yes = el('button', 'btn', confirmLabel); yes.type = 'button';
    const no = el('button', 'btn secondary', 'No, not yet'); no.type = 'button';
    no.addEventListener('click', () => { row.remove(); announce('Okay — nothing was done.', true); });
    yes.addEventListener('click', async () => {
      yes.disabled = true; no.disabled = true;
      try { await fn(); row.remove(); }
      catch (e) { announce(e.message || 'That did not go through.', true); yes.disabled = false; no.disabled = false; }
    });
    row.appendChild(yes); row.appendChild(no);
    container.appendChild(row);
    announce('Confirm required. ' + question, true);
    if (no.focus) no.focus();
  }

  async function run(promise, okMsg, reloader) {
    await promise; announce(okMsg, true); if (reloader) reloader();
  }
  function empty(container, text) { container.innerHTML = ''; container.appendChild(el('p', 'muted', text)); }
  function fail(container, e) { container.innerHTML = ''; container.appendChild(el('p', 'msg err', e.message)); }

  // Download a project's package, or surface the honest plan gate inline (with a
  // one-tap Keep for this specific project) if it isn't kept yet.

  // ---- Your path: the visible route from arriving to earning -----------------------------------
  // Every step here is EARNED FROM THE RECORD — a step reads as done only because the thing really
  // happened. No points, no streaks, nothing that rewards merely showing up. It is ordered and
  // spoken, so it works read aloud: what you've done, what's next, and the true earnings number.
  async function loadPath() {
    const sec = document.getElementById('path-sec');
    const wrap = document.getElementById('path');
    const summary = document.getElementById('path-summary');
    if (!sec || !wrap) return;
    try {
      const p = await Kiln.api('/progress');
      wrap.innerHTML = '';
      const steps = p.steps || [];

      // The headline: how far along, what's next, and what you've actually earned.
      const bits = [`${p.completed} of ${p.total} steps done.`];
      if (p.next) bits.push(`Next: ${p.next.title}.`);
      bits.push(p.earned_spoken || '');
      summary.textContent = bits.filter(Boolean).join(' ');

      const ol = document.createElement('ol');
      steps.forEach((s) => {
        const li = document.createElement('li');
        // Say done/not-done in WORDS, not with a symbol or a colour — this has to work when heard.
        const head = el('p', null, (s.done ? 'Done — ' : 'Not yet — ') + s.title);
        li.appendChild(head);
        li.appendChild(el('p', 'muted', s.spoken || ''));
        if (!s.done && s.action && s.action.href) {
          const a = el('a', 'btn secondary', s.action.label);
          a.href = s.action.href;
          a.style.display = 'inline-block';
          a.style.textDecoration = 'none';
          a.style.lineHeight = '44px';       // a real tap target
          li.appendChild(a);
        }
        ol.appendChild(li);
      });
      wrap.appendChild(ol);
      sec.hidden = false;
    } catch (e) {
      if (e && e.sessionExpired) return;
      // A path that can't load is not worth guessing at — stay quiet rather than show a fake one.
      sec.hidden = true;
    }
  }

  async function loadTodaysDreams() {
    const c = document.getElementById('today'); if (!c) return;
    const dg = document.getElementById('today-digest');
    c.innerHTML = ''; if (dg) dg.textContent = 'Finding fresh Dreams for you…';
    try {
      const { dreams, digest } = await Kiln.api('/listings/today');
      if (!dreams.length) {
        if (dg) dg.textContent = '';
        empty(c, 'No fresh Dreams matched to you just yet — new ones arrive regularly. You can explore the full Dream Market anytime.');
        const go = el('a', 'btn secondary', 'Explore the Dream Market'); go.href = '/marketplace.html'; go.setAttribute('role', 'button');
        c.appendChild(go);
        return;
      }
      // One spoken line a returning creator hears immediately.
      let line = digest.count + (digest.count === 1 ? ' fresh Dream' : ' fresh Dreams') + ' for you';
      if (digest.new_today) line += ', ' + digest.new_today + ' new today';
      if (digest.categories && digest.categories.length) line += ' — in ' + digest.categories.join(', ');
      if (digest.broadened) line += ' (a wider mix, to keep things fresh)';
      line += '.';
      if (dg) dg.textContent = line;
      announce('Today’s Dreams: ' + line, false);

      dreams.forEach((d) => {
        const priced = d.format === 'auction' ? ('bids from ' + money(d.starting_bid_cents || 0)) : money(d.price_cents);
        const bits = [nice(d.category), priced];
        if (d.waiting) bits.push(d.waiting + (d.waiting === 1 ? ' person waiting' : ' people waiting'));
        if (d.is_new_today) bits.push('new today');
        if (d.research_grounded) bits.push('research-grounded');
        const r = row(d.title, bits.join(' · '));
        const view = el('a', 'btn', 'View this Dream'); view.href = '/listing.html?id=' + d.id; view.setAttribute('role', 'button');
        r.actions.appendChild(view);
        c.appendChild(r);
      });
    } catch (e) { if (dg) dg.textContent = ''; fail(c, e); }
  }

  async function downloadConcept(id, host) {
    if (host) host.innerHTML = '';
    try {
      const { assets } = await Kiln.api('/concepts/' + id + '/export');
      const text = (assets || []).map((a) => '# ' + (a.title || a.type) + '\n\n' + (a.body || '') + '\n').join('\n\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'concept-package.txt';
      document.body.appendChild(a); a.click(); a.remove();
      announce('Your package download has started.', true);
    } catch (e) {
      if (e.status === 402 && e.data && e.data.options && host) {
        host.appendChild(el('p', null, e.data.message || 'A plan is needed to download or share these materials. You can keep building for free.'));
        const go = async (body) => {
          const r = await Kiln.api('/subscriptions', { method: 'POST', body });
          if (r.url) { location.href = r.url; return; }
          announce(r.message || 'Billing isn’t configured yet, so nothing was charged.', true);
        };
        const maker = (e.data.options || []).find((o) => o.plan === 'maker');
        const sculptor = (e.data.options || []).find((o) => o.plan === 'sculptor');
                host.appendChild(actionBtn('Unlimited projects — $19/month', () => go({ plan: 'builder' })));
        announce('Your first project is free to download. For any project after that, the plan is $19 a month and covers everything, including sites and landing pages.', true);
      } else { announce(e.message || 'Could not download.', true); }
    }
  }

  // ---------- Payouts ----------
  async function loadProofStep() {
    const sec = document.getElementById('proofstep-sec');
    const c = document.getElementById('proofstep'); if (!c) return;
    try {
      const { prompt } = await Kiln.api('/clay/weekly-prompt');
      if (!prompt) { if (sec) sec.hidden = true; return; }
      c.innerHTML = '';
      if (sec) sec.hidden = false;

      const lead = el('p'); lead.appendChild(el('strong', null, 'Take: ' + prompt.concept_title)); c.appendChild(lead);
      function labeled(label, text) {
        const p = el('p'); p.appendChild(el('strong', null, label + ' ')); p.appendChild(document.createTextNode(text)); return p;
      }
      c.appendChild(labeled('One customer:', prompt.focus));
      c.appendChild(labeled('One proof action:', prompt.action));
      c.appendChild(labeled('Go or kill:', prompt.go_kill));

      if (prompt.status === 'done') {
        c.appendChild(el('p', 'muted', 'You marked this done. Nice — come tell Clay how it went.'));
      } else {
        const btn = el('button', 'btn', 'Mark this done'); btn.type = 'button';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await Kiln.api('/clay/weekly-prompt/done', { method: 'POST', body: { id: prompt.id } });
            announce('Marked your proof step done. Nice work.', true);
            loadProofStep();
          } catch (e) { btn.disabled = false; announce('That did not go through. Please try again.', true); }
        });
        c.appendChild(btn);
        announce('Your proof step this week: take ' + prompt.concept_title + '. ' + prompt.action, false);
      }
    } catch (e) { if (sec) sec.hidden = true; }   // an enhancement, not core — stay quiet on error
  }

  // The per-concept movement board. Lane copy mirrors src/services/clay/movement.js.
  const BOARD_LANES = [
    { key: 'needs_customer_clarity', label: 'Needs customer clarity',
      moves: 'Name one specific person or group who has this problem badly enough to pay for a fix.' },
    { key: 'needs_proof', label: 'Needs proof',
      moves: 'Get one real proof action — a booked paid call, a preorder, a deposit, a landing page that converts. A stranger acting, not a compliment.' },
    { key: 'ready_to_package', label: 'Ready to package',
      moves: 'You have a clear customer and real evidence they’ll pay — it’s ready to package and list in the Dream Market.' },
  ];
  async function loadBoard() {
    const c = document.getElementById('board'); if (!c) return; c.innerHTML = '';
    try {
      const { concepts } = await Kiln.api('/concepts');
      const items = (concepts || []).filter((x) => !x.is_operating);
      if (!items.length) { empty(c, 'No projects on the path yet. Open the laboratory to shape one with Clay.'); return; }
      BOARD_LANES.forEach((lane) => {
        const inLane = items.filter((x) => (x.movement_state || 'needs_customer_clarity') === lane.key);
        const sec = el('div', 'panel');
        sec.appendChild(el('h3', null, lane.label + ' (' + inLane.length + ')'));
        if (!inLane.length) { sec.appendChild(el('p', 'muted', 'None here yet.')); c.appendChild(sec); return; }
        inLane.forEach((x) => {
          const item = el('div'); item.style.marginBottom = '14px';
          item.appendChild(el('p', null, x.title));
          if (x.movement_note) item.appendChild(el('p', 'muted', 'Clay’s read: ' + x.movement_note));
          item.appendChild(el('p', 'muted', 'Next: ' + lane.moves));
          const lbl = el('label', null, 'Move this project to another lane'); lbl.setAttribute('for', 'mv-' + x.id);
          const sel = el('select'); sel.id = 'mv-' + x.id;
          BOARD_LANES.forEach((l) => { const o = el('option', null, l.label); o.value = l.key; if (l.key === lane.key) o.selected = true; sel.appendChild(o); });
          const save = el('button', 'btn secondary', 'Update lane'); save.type = 'button';
          save.addEventListener('click', async () => {
            if (sel.value === lane.key) { announce('That project is already in ' + lane.label + '.', true); return; }
            save.disabled = true;
            try {
              await Kiln.api('/concepts/' + x.id + '/movement', { method: 'PUT', body: { movement_state: sel.value } });
              const to = (BOARD_LANES.find((l) => l.key === sel.value) || {}).label || sel.value;
              announce(x.title + ' moved to ' + to + '.', true);
              loadBoard();
            } catch (e) { announce(e.message, true); save.disabled = false; }
          });
          item.appendChild(lbl); item.appendChild(sel); item.appendChild(save);
          sec.appendChild(item);
        });
        c.appendChild(sec);
      });
    } catch (e) { fail(c, e); }
  }

  // The public dreamer tag — see it and edit it. Uses the existing seller status + alias endpoints.
  async function loadPenName() {
    const c = document.getElementById('penname'); if (!c) return; c.innerHTML = '';
    try {
      const s = await Kiln.api('/sellers/status');
      const current = (s && s.display_name) || '';
      const shown = el('p'); shown.appendChild(document.createTextNode('Buyers currently see you as: '));
      shown.appendChild(el('strong', null, current || 'A Dream Market creator')); c.appendChild(shown);

      const label = el('label', null, 'Edit your dreamer tag (2 to 40 characters)'); label.setAttribute('for', 'pen-input');
      const input = el('input'); input.id = 'pen-input'; input.type = 'text'; input.maxLength = 40; input.value = current; input.setAttribute('autocomplete', 'off');
      const out = el('p', 'muted'); out.setAttribute('role', 'status'); out.setAttribute('aria-live', 'polite');
      const save = el('button', 'btn', 'Save your dreamer tag'); save.type = 'button';
      save.addEventListener('click', async () => {
        const name = input.value.trim();
        if (name.length < 2 || name.length > 40) { out.className = 'msg err'; out.textContent = 'Your dreamer tag needs to be between 2 and 40 characters.'; announce(out.textContent, true); return; }
        save.disabled = true;
        try {
          const r = await Kiln.api('/sellers/alias', { method: 'PUT', body: { display_name: name } });
          announce('Saved. Buyers will now see you as ' + ((r && r.display_name) || name) + '.', true);
          loadPenName();
        } catch (e) { out.className = 'msg err'; out.textContent = e.message || 'Could not save your dreamer tag.'; announce(out.textContent, true); save.disabled = false; }
      });
      c.appendChild(label); c.appendChild(input); c.appendChild(save); c.appendChild(out);
    } catch (e) { fail(c, e); }
  }

  // Kick off (or resume) Stripe payout onboarding. On failure, both announce AND leave the reason
  // on the page, since a blind creator can miss a transient announcement.
  async function startOnboard(container) {
    announce('Opening Stripe to set up your payouts…');
    const r = await Kiln.api('/sellers/onboard', { method: 'POST' });
    if (r && r.url) { location.href = r.url; return; }
    const msg = (r && r.message) || 'Payouts are not configured on the platform yet.';
    announce(msg, true);
    container.appendChild(el('p', 'msg err', msg));
  }

  async function loadPayouts() {
    const c = document.getElementById('payouts'); c.innerHTML = '';
    try {
      const s = await Kiln.api('/sellers/status');
      if (!s.stripe_configured) { empty(c, 'Payouts are not configured on the platform yet. You can still create and list projects; buyers can transact once payouts are enabled.'); return; }

      if (s.onboarded && s.kyc_status === 'verified') {
        c.appendChild(el('p', 'msg ok', 'Payouts are ready. You can receive the money from project sales and from anything you sell in your store.'));
        return;
      }

      // Not fully set up yet — say plainly: you can still sell, but the money waits until setup is done.
      const warn = el('p', 'msg');
      warn.textContent = 'Your payout setup isn’t finished yet. You can still list and sell in the Dream Market, but money from a sale is held and won’t be paid out to you until you finish setting up payments here.';
      c.appendChild(warn);

      const onError = (container) => (e) => { const m = e.message || 'Could not start payout setup. Please try again.'; announce(m, true); container.appendChild(el('p', 'msg err', m)); };

      if (s.onboarded) {
        c.appendChild(el('p', null, 'Payout setup is in progress — a few details still need to be finished with Stripe.'));
        c.appendChild(actionBtn('Refresh payout status', () => run(Kiln.api('/sellers/refresh', { method: 'POST' }), 'Refreshed.', loadPayouts), true));
        c.appendChild(actionBtn('Continue payout setup', () => startOnboard(c).catch(onError(c))));
      } else {
        c.appendChild(el('p', null, 'Set up payouts so you can receive the money from project sales and your store. It takes a few minutes with Stripe, our payments provider.'));
        c.appendChild(actionBtn('Set up payouts', () => startOnboard(c).catch(onError(c))));
      }
    } catch (e) { fail(c, e); }
  }

  // ---------- Subscription ----------
  async function loadSubs() {
    const c = document.getElementById('subs'); c.innerHTML = '';
    try {
      const { subscriptions, staff_exempt } = await Kiln.api('/subscriptions');
      if (staff_exempt) {
        c.appendChild(el('p', 'msg ok', 'Staff account — full access to Clay, the marketplace, and every feature. You are never charged.'));
        return;
      }
      const active = subscriptions.filter((s) => s.status === 'active');
      const goPlan = async () => {
        const r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'builder' } });
        if (r.url) { location.href = r.url; return; }
        announce(r.message || 'Billing is not configured yet.', true);
      };
      // Self-serve cancel with a safe two-tap confirm (no modal — screen-reader friendly).
      const cancelSubBtn = (sub, label) => {
        const b = el('button', 'btn secondary', 'Cancel ' + label); b.type = 'button';
        let armed = false;
        b.addEventListener('click', async () => {
          if (!armed) {
            armed = true;
            b.textContent = 'Tap again to confirm — stops the renewal';
            announce('Tap again to confirm canceling ' + label + '. This stops the renewal — you keep full access until your current period ends.', true);
            return;
          }
          b.disabled = true;
          try {
            const r = await Kiln.api('/subscriptions/' + sub.id + '/cancel', { method: 'POST' });
            if (r && r.ends_at_period_end) {
              announce(label + ' will end at the close of your current period. You keep full access until then, and anything you\u2019ve downloaded is yours to keep.', true);
            } else {
              announce(label + ' canceled. Anything you already downloaded is still yours.', true);
            }
            loadSubs();
          } catch (e) {
            b.disabled = false; armed = false; b.textContent = 'Cancel ' + label;
            announce(e.message || 'Could not cancel just now — nothing changed. Please try again.', true);
          }
        });
        return b;
      };
      const sculptor = active.find((s) => s.plan === 'sculptor');
      if (sculptor) {
        c.appendChild(el('p', 'msg ok', 'Your plan is active — unlimited projects, sites and landing pages included.'));
        if (sculptor.cancel_at_period_end) {
          c.appendChild(el('p', 'muted', 'Ending at the close of your current period — you keep full access until then.'));
        } else {
          c.appendChild(cancelSubBtn(sculptor, 'your plan'));
        }
        return;
      }
      const makers = active.filter((s) => s.plan === 'maker');
      if (makers.length) {
        c.appendChild(el('p', null, makers.length + ' project' + (makers.length > 1 ? 's' : '') + ' on an older per-project plan. These keep working exactly as they are.'));
        makers.forEach((m) => {
          const name = m.concept_title ? '“' + m.concept_title + '”' : 'this project';
          const line = el('div', 'sub-row'); line.style.margin = '6px 0';
          line.appendChild(el('p', 'muted', 'Older per-project plan — ' + name));
          if (m.cancel_at_period_end) {
            line.appendChild(el('p', 'muted', 'Ending at the close of your current period — access continues until then.'));
          } else {
            line.appendChild(cancelSubBtn(m, 'the older plan for ' + name));
          }
          c.appendChild(line);
        });
      } else {
        c.appendChild(el('p', 'muted', 'No plan yet. Build for free — a plan is asked for only when you download, share, or keep a project past 30 days.'));
      }
      c.appendChild(actionBtn('Unlimited projects — $19/month', goPlan));
      c.appendChild(el('p', 'muted', 'Your first project is free to keep and download. The plan covers every project after it, plus the website builder and landing pages.'));
    } catch (e) { fail(c, e); }
  }

  // ---------- Concepts ----------
  async function loadConcepts() {
    const c = document.getElementById('projects'); c.innerHTML = '';
    try {
      const { concepts } = await Kiln.api('/concepts');
      if (!concepts.length) { empty(c, 'No projects yet. Open the laboratory to shape one with Clay.'); return; }
      concepts.forEach((x) => {
        const claimed = x.origin === 'purchased';
        const prefix = x.is_operating ? 'Your running business · ' : (claimed ? 'Claimed from the Dream Market · ' : '');
        let meta = prefix + nice(x.category) + (x.is_housing ? ' · housing' : '');
        meta += x.entitled ? ' \u00B7 yours to download' : ' \u00B7 free to build \u00B7 on the plan to keep';
        if (x.access_expires_at) {
          const days = Math.ceil((new Date(x.access_expires_at) - new Date()) / 86400000);
          meta += ' · ' + (days > 0 ? ('access ' + days + ' more day' + (days === 1 ? '' : 's') + ' unless subscribed') : 'access expired — subscribe to keep');
        }
        const r = row(x.title, meta, x.stage);
        const cont = el('a', 'btn', 'Continue in the laboratory');
        cont.href = '/app.html?concept=' + x.id; cont.style.marginRight = '8px';
        r.actions.appendChild(cont);
        const demo = el('a', 'btn secondary', 'Live demo'); demo.href = '/sandbox.html?concept=' + x.id;
        demo.style.marginRight = '8px'; r.actions.appendChild(demo);
        const dlHost = el('div', 'stack'); dlHost.style.marginTop = '8px';
        r.actions.appendChild(actionBtn('Download package', () => downloadConcept(x.id, dlHost), true));
        const hist = el('div', 'stack'); hist.style.marginTop = '8px';
        r.actions.appendChild(actionBtn('Version history', async () => {
          hist.innerHTML = '';
          try {
            const { history } = await Kiln.api('/assets/concept/' + x.id + '/history');
            if (!history.length) { hist.appendChild(el('p', 'muted', 'No versions yet.')); return; }
            history.forEach((h) => {
              const line = (h.title || nice(h.type)) + ' — v' + h.version +
                (h.is_current ? ' (current)' : ' (history)') + ' · ' + new Date(h.created_at).toLocaleDateString();
              hist.appendChild(el('p', h.is_current ? null : 'muted', line));
            });
            announce(history.length + ' version records loaded.', true);
          } catch (e) { hist.appendChild(el('p', 'msg err', e.message)); }
        }, true));
        r.appendChild(hist);
        r.appendChild(dlHost);
        c.appendChild(r);
      });
    } catch (e) { fail(c, e); }
  }

  // ---------- Listings ----------
  function buildEditor(l, host) {
    function labeled(labelText, node, id) {
      const w = el('div'); const lab = el('label', null, labelText); lab.setAttribute('for', id);
      node.id = id; w.appendChild(lab); w.appendChild(node); return w;
    }
    const fSel = document.createElement('select');
    [['flat', 'Flat price'], ['auction', 'Auction']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === l.format) o.selected = true; fSel.appendChild(o); });
    const cur = l.format === 'auction' ? l.starting_bid_cents : l.price_cents;
    const pIn = document.createElement('input'); pIn.type = 'number'; pIn.min = '50'; pIn.step = '1'; pIn.value = cur ? (cur / 100) : '';
    const sSel = document.createElement('select');
    [['concept', 'Concept'], ['in_build', 'In build'], ['prepared_to_start', 'Prepared to start']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === l.stage_label) o.selected = true; sSel.appendChild(o); });
    const tIn = document.createElement('input'); tIn.type = 'text'; tIn.value = l.completion_target || '';
    host.appendChild(labeled('Format', fSel, 'ef-' + l.id));
    host.appendChild(labeled('Price or starting bid (US dollars, at least $10)', pIn, 'ep-' + l.id));
    host.appendChild(labeled('Stage', sSel, 'es-' + l.id));
    host.appendChild(labeled('Completion target (optional)', tIn, 'et-' + l.id));
    host.appendChild(actionBtn('Save changes', async () => {
      const dollars = parseFloat(pIn.value);
      if (!(dollars >= 10)) { announce('Price or starting bid must be at least $10.', true); return; }
      const body = { format: fSel.value, stage_label: sSel.value, completion_target: tIn.value };
      const cents = Math.round(dollars * 100);
      if (fSel.value === 'flat') body.price_cents = cents; else body.starting_bid_cents = cents;
      await run(Kiln.api('/listings/' + l.id, { method: 'PATCH', body }), 'Listing updated.', loadListings);
    }));
    fSel.focus();
  }

  // Inline editor for a listing. Deliberately in place rather than on another page: changing a
  // price should feel like changing a price, not like relisting. The PATCH endpoint always existed
  // — there was simply no way to reach it, so the only apparent route to a new price was
  // withdraw-and-relist, which looks like starting over and risks a live listing for a small edit.
  // Two-step confirm with focus on the SAFE choice, same as everywhere else that changes something
  // a person cares about.
  function confirmIn(row, question, yesLabel, fn) {
    if (row.querySelector('.confirm-row')) return;
    // Put focus BACK when this closes, or dismissing it drops the user at the top of the document
    // and they lose their place entirely.
    //
    // Remembering the button NODE is not enough here: the list re-renders, so that node is detached
    // by the time we try to focus it and the attempt silently does nothing. Remember its LABEL and
    // find whatever button now carries it; fall back to making the row itself focusable, so the
    // person lands on the right listing either way.
    const openerLabel = (document.activeElement && document.activeElement.textContent || '').trim();
    const restore = () => {
      try {
        const again = openerLabel
          ? [...row.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === openerLabel)
          : null;
        if (again) { again.focus(); return; }
        if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
        row.focus();
      } catch (e) {}
    };
    const box = el('div', 'confirm-row');
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', question);
    box.appendChild(el('p', null, question));
    const yes = el('button', 'btn', yesLabel); yes.type = 'button';
    const no = el('button', 'btn secondary', 'No, leave it as it is'); no.type = 'button';
    yes.addEventListener('click', async () => {
      yes.disabled = true; no.disabled = true;
      try { await fn(); box.remove(); restore(); }
      catch (e) { announce(e.message || 'That did not go through.', true); yes.disabled = false; no.disabled = false; }
    });
    no.addEventListener('click', () => { box.remove(); restore(); announce('Left as it is.', true); });
    box.appendChild(yes); box.appendChild(no); row.appendChild(box);
    announce('Confirm required. ' + question, true);
    if (no.focus) no.focus();
  }

  async function loadListings() {
    const c = document.getElementById('listings'); c.innerHTML = '';
    try {
      const { listings } = await Kiln.api('/listings/mine');
      const mk = el('a', 'btn secondary', 'Create a listing'); mk.href = '/sell.html'; c.appendChild(mk);
      if (!listings.length) { c.appendChild(el('p','muted','No listings yet. Use “Create a listing”, or from the laboratory choose “List this in the Dream Market”.')); return; }
      listings.forEach((l) => {
        const price = l.format === 'auction' ? ('auction from ' + money(l.starting_bid_cents)) : money(l.price_cents);
        const r = row(l.title, nice(l.category) + ' · ' + price, l.status);
        // A WITHDRAWN listing needs the way back, or editing it strands it: you take it down to
        // change a price and then there is no button that puts it back, so it looks like the
        // listing is gone and the only option is building a new one. Same action as a draft.
        if (l.status === 'draft' || l.status === 'withdrawn') {
          r.actions.appendChild(actionBtn(
            l.status === 'withdrawn' ? 'Put it back on the market' : 'Submit for review',
            () => run(Kiln.api('/listings/' + l.id + '/submit', { method: 'POST' }),
              l.status === 'withdrawn' ? 'Back on the market, pending review.' : 'Submitted for review.',
              loadListings)));
          const editWrap = el('div', 'stack'); editWrap.style.marginTop = '8px';
          r.actions.appendChild(actionBtn('Edit', () => { editWrap.innerHTML = ''; buildEditor(l, editWrap); }, true));
          r.appendChild(editWrap);
        }
        // A LIVE listing cannot be edited while it is live — the server refuses, and it is right
        // to: people may be looking at it, or bidding on it, and terms must not shift under them.
        // So rather than a button that fails, this offers the real sequence as ONE action, using
        // the SAME editor a draft uses. (I had added a second, thinner editor here without noticing
        // buildEditor already existed — two editors for one job is how they drift apart.)
        if (['in_review', 'live'].includes(l.status)) {
          const editWrap2 = el('div', 'stack'); editWrap2.style.marginTop = '8px';
          r.actions.appendChild(actionBtn('Change the price or terms', () => {
            confirmIn(r, 'To change this, it comes off the market first — nobody can act on terms while '
              + 'they are changing. You will edit it, then put it back. Your listing and everything in it is kept.',
              'Take it off and edit', async () => {
                await Kiln.api('/listings/' + l.id + '/withdraw', { method: 'POST' });
                announce('Taken off the market. Edit it below, then use “Put it back on the market”.', true);
                editWrap2.innerHTML = '';
                buildEditor(Object.assign({}, l, { status: 'withdrawn' }), editWrap2);
              });
          }));
          r.appendChild(editWrap2);
        }
        if (['draft', 'in_review', 'live'].includes(l.status)) r.actions.appendChild(actionBtn('Withdraw', () => run(Kiln.api('/listings/' + l.id + '/withdraw', { method: 'POST' }), 'Listing withdrawn.', loadListings), true));
        c.appendChild(r);
      });
    } catch (e) { fail(c, e); }
  }

  // ---------- Orders ----------
  async function loadOrders() {
    const c = document.getElementById('orders'); c.innerHTML = '';
    try {
      const { orders } = await Kiln.api('/orders');
      if (!orders.length) { empty(c, 'No orders yet.'); return; }
      orders.forEach((o) => {
        const iAmSeller = o.seller_id === me.id;
        const r = row(o.title, (iAmSeller ? 'Selling · ' : 'Buying · ') + money(o.amount_cents), o.status);
        if (iAmSeller && ['created', 'in_escrow', 'proof_submitted'].includes(o.status)) {
          r.actions.appendChild(actionBtn('Mark delivered', () => run(Kiln.api('/orders/' + o.id + '/deliver', { method: 'POST' }), 'Marked delivered.', loadOrders)));
          r.actions.appendChild(actionBtn('Submit shipment proof', async () => {
            const proof = window.prompt('Enter tracking or proof-of-shipment details:');
            if (!proof) return;
            await run(Kiln.api('/orders/' + o.id + '/proof', { method: 'POST', body: { proof_of_shipment: proof } }), 'Proof submitted.', loadOrders);
          }, true));
        }
        if (!iAmSeller && ['in_escrow', 'proof_submitted', 'delivered'].includes(o.status)) {
          // Releasing pays the seller out of escrow and cannot be undone, so it asks first.
          r.actions.appendChild(actionBtn('Release and receive ownership', () => {
            confirmAction(r.actions,
              'Release the money to the seller and take ownership? This pays them out of escrow and cannot be undone.',
              'Yes, release and take ownership',
              () => run(Kiln.api('/orders/' + o.id + '/release', { method: 'POST' }), 'Released. Ownership transferred to you.', loadOrders));
          }));
        }
        // The launch partner arrangement, and the BUYER's unconditional control over it. Ending it
        // never affects ownership, which is said in the button's own outcome rather than assumed.
        if (o.partner_offered) {
          const ended = o.partner_active === false;
          r.actions.appendChild(el('span', 'muted',
            ended ? 'Launch partner: ended by you.' : 'Launch partner: active.'));
          if (!iAmSeller) {
            if (!ended) {
              r.actions.appendChild(actionBtn('End the launch partner arrangement', () => run(
                Kiln.api('/orders/' + o.id + '/partner/remove', { method: 'POST' }),
                'Launch partner removed. The project is still entirely yours.', loadOrders), true));
            } else {
              r.actions.appendChild(actionBtn('Bring the launch partner back', () => run(
                Kiln.api('/orders/' + o.id + '/partner/restore', { method: 'POST' }),
                'Launch partner is active again.', loadOrders)));
            }
          }
        }
        c.appendChild(r);
      });
    } catch (e) { fail(c, e); }
  }

  // ---------- Consultant engagements ----------
  // Booking a consultant is a real Stripe charge: /pay returns a hosted checkout URL, and we
  // send the client there. If the consultant hasn't set up payouts (or Stripe isn't configured),
  // the server says so honestly and we surface that instead of charging anything.
  async function payForSession(id) {
    const res = await Kiln.api('/consultants/engagements/' + id + '/pay', { method: 'POST' });
    if (res && res.ok && res.checkout_url) {
      announce('Taking you to secure checkout.', true);
      window.location.href = res.checkout_url;
      return;
    }
    throw new Error((res && res.message) || 'Payment could not be started right now.');
  }

  async function loadEngagements() {
    const c = document.getElementById('engagements'); c.innerHTML = '';
    // Paid consultant sessions have been retired in favour of launch partners. Anyone who already
    // has a session still sees and can finish it — but a creator who never had one should not be
    // shown an empty section for an offer that no longer exists, wondering what they missed.
    const section = document.getElementById('eng-sec') || (c.closest && c.closest('section'));
    try {
      const { engagements } = await Kiln.api('/consultants/engagements');
      if (!engagements.length) { if (section) section.hidden = true; return; }
      if (section) section.hidden = false;
      engagements.forEach((e) => {
        const iAmConsultant = e.consultant_id === me.id;
        const r = row(iAmConsultant ? 'Session you are delivering' : 'Session you requested',
          '$' + (e.fee_cents / 100).toFixed(2) + ' session', e.state);
        const A = r.actions;
        if (iAmConsultant) {
          if (e.state === 'requested') A.appendChild(actionBtn('Accept', () => run(Kiln.api('/consultants/engagements/' + e.id + '/accept', { method: 'POST' }), 'Accepted.', loadEngagements)));
          if (e.state === 'accepted') A.appendChild(actionBtn('Sign NDA (required before project is shared)', () => run(Kiln.api('/consultants/engagements/' + e.id + '/nda', { method: 'POST' }), 'NDA signed.', loadEngagements)));
          if (e.state === 'paid') A.appendChild(actionBtn('Mark session delivered', () => run(Kiln.api('/consultants/engagements/' + e.id + '/deliver', { method: 'POST' }), 'Session delivered.', loadEngagements)));
        } else {
          if (e.state === 'nda_signed') A.appendChild(actionBtn('Pay $150 for this session', () => payForSession(e.id)));
          if (e.state === 'session_delivered') {
            A.appendChild(actionBtn('Continue (free, within 12 hours)', () => run(Kiln.api('/consultants/engagements/' + e.id + '/continue', { method: 'POST' }), 'Continuing with your consultant.', loadEngagements), true));
            A.appendChild(actionBtn('Confirm a launch resulted', () => run(Kiln.api('/consultants/engagements/' + e.id + '/confirm-launch', { method: 'POST' }), 'Launch confirmed.', loadEngagements), true));
          }
        }
        c.appendChild(r);
      });
    } catch (e) {
      // A retired feature failing is not something a creator needs to read about; stay quiet.
      if (section) section.hidden = true;
    }
  }

  // ---------- Watchlist ----------
  async function loadWatches() {
    const c = document.getElementById('watches'); c.innerHTML = '';
    try {
      const { watches } = await Kiln.api('/watches');
      if (!watches.length) { empty(c, 'Nothing on your watchlist.'); return; }
      watches.forEach((w) => {
        const r = row(w.title, nice(w.category), w.status);
        const a = el('a', 'btn secondary', 'View listing'); a.href = '/listing.html?id=' + w.id; r.actions.appendChild(a);
        c.appendChild(r);
      });
    } catch (e) { fail(c, e); }
  }

  async function loadTuning() {
    const c = document.getElementById('tuning'); c.innerHTML = '';
    try {
      const [opts, cur] = await Promise.all([Kiln.api('/preferences/options'), Kiln.api('/preferences')]);
      const prefs = cur.preferences || { interests: [], runs_business: false, business_kind: '', launch_budget: '' };
      const selected = new Set(prefs.interests || []);
      c.appendChild(el('p', null, 'Ideas you’re most excited to launch:'));
      const chips = el('div'); chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
      opts.categories.forEach((cat) => {
        const b = el('button', 'btn' + (selected.has(cat.id) ? '' : ' secondary'), cat.label); b.type = 'button';
        b.setAttribute('aria-pressed', String(selected.has(cat.id)));
        b.addEventListener('click', () => {
          const on = selected.has(cat.id);
          if (on) { selected.delete(cat.id); b.className = 'btn secondary'; } else { selected.add(cat.id); b.className = 'btn'; }
          b.setAttribute('aria-pressed', String(!on));
          announce((on ? 'Removed ' : 'Added ') + cat.label, true);
        });
        chips.appendChild(b);
      });
      c.appendChild(chips);
      function labeled(text, node, id) { const w = el('div'); w.style.marginTop = '10px'; const l = el('label', null, text); l.setAttribute('for', id); node.id = id; w.appendChild(l); w.appendChild(node); return w; }
      const bSel = document.createElement('select');
      const none = document.createElement('option'); none.value = ''; none.textContent = 'No preference'; bSel.appendChild(none);
      opts.budgets.forEach((bt) => { const o = document.createElement('option'); o.value = bt.id; o.textContent = bt.label; if (bt.id === prefs.launch_budget) o.selected = true; bSel.appendChild(o); });
      c.appendChild(labeled('Launch budget', bSel, 'tune-budget'));
      const rbSel = document.createElement('select');
      [['no', 'Not yet'], ['yes', 'Yes']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if ((v === 'yes') === !!prefs.runs_business) o.selected = true; rbSel.appendChild(o); });
      c.appendChild(labeled('Do you already run a business?', rbSel, 'tune-runs'));
      const kIn = document.createElement('input'); kIn.type = 'text'; kIn.value = prefs.business_kind || '';
      c.appendChild(labeled('What kind? (optional)', kIn, 'tune-kind'));
      c.appendChild(actionBtn('Save tuning', async () => {
        const body = { interests: Array.from(selected), launch_budget: bSel.value, runs_business: rbSel.value === 'yes', business_kind: kIn.value, onboarded: true };
        await run(Kiln.api('/preferences', { method: 'PUT', body }), 'Dream Market tuning saved.', null);
      }));
    } catch (e) { fail(c, e); }
  }

  (async function init() {
    try { me = (await Kiln.api('/auth/me')).user; document.getElementById('greeting').textContent = 'Welcome, ' + (me.name || 'there'); }
    catch (_) { location.replace('/login.html'); return; }
    if (['staff', 'admin', 'master_staff'].includes(me.role)) {
      const g = document.getElementById('global');
      // STAFF WORK LIVES IN THE STAFF PANEL, not here. The dashboard is a creator's own workspace —
      // their projects, their listings, their money. Review queues and the newsroom are a different
      // job, and mixing the two made this page read as everyone's inbox at once. One door instead:
      // the Staff panel, which already collects all of it.
      try {
        const { drafts } = await Kiln.api('/desk/drafts');
        const n = (drafts || []).length;
        const panel = el('a', 'btn' + (n ? '' : ' secondary'),
          n ? ('Staff panel \u2014 ' + n + ' draft' + (n === 1 ? '' : 's') + ' waiting for review')
            : 'Staff panel');
        panel.href = '/admin-overview.html'; panel.setAttribute('role', 'button'); g.appendChild(panel);
      } catch (_) {
        const panel = el('a', 'btn secondary', 'Staff panel');
        panel.href = '/admin-overview.html'; panel.setAttribute('role', 'button'); g.appendChild(panel);
      }

      // Testing-mode toggle: flip your own account between full staff access (no paywalls, for
      // testing building and publishing) and the real pay flow (paywalls on, to test money),
      // without a database edit. Takes effect on your next action.
      try {
        const tm = await Kiln.api('/admin/testing-mode');
        let on = !!tm.billing_test;
        const btn = el('button', 'btn secondary'); btn.type = 'button'; btn.style.marginLeft = '8px';
        const paint = () => {
          btn.textContent = on
            ? 'Testing payments: ON — switch to full access'
            : 'Full access (no paywalls) — switch to test payments';
          btn.setAttribute('aria-label', on
            ? 'Billing test mode is on: you go through the real payment flow. Activate to switch to full staff access with no paywalls.'
            : 'Full staff access, no paywalls. Activate to switch to testing the real payment flow.');
        };
        paint();
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const r = await Kiln.api('/admin/testing-mode', { method: 'POST', body: { enabled: !on } });
            on = !!r.billing_test; paint();
            announce(on
              ? 'Testing payments mode on. You will go through the real pay flow.'
              : 'Full staff access on. Paywalls are off for you.', true);
          } catch (e) { announce(e.message, true); }
          btn.disabled = false;
        });
        g.appendChild(btn);
      } catch (_) {}
    }
    const q = new URLSearchParams(location.search);
    if (q.get('onboard') === 'done') announce('Payout setup returned. Refreshing status.', true);
    if (q.get('sub') === 'done') {
      announce('Payment received — thank you. Your plan is being activated and will show here in a moment.', true);
      // Activation happens via Stripe's webhook, which can land a second or two after the
      // redirect — refresh the plan status shortly so what's shown matches reality.
      setTimeout(() => loadSubs(), 3000);
      setTimeout(() => loadSubs(), 8000);
    }
    if (q.get('sub') === 'canceled') announce('Checkout canceled — you were not charged.', true);
    loadPath(); loadTodaysDreams(); loadProofStep(); loadPayouts(); loadPenName(); loadSubs(); loadConcepts(); loadBoard(); loadListings(); loadOrders(); loadEngagements(); loadWatches(); loadTuning();
    document.getElementById('signout').addEventListener('click', (e) => { e.preventDefault(); Kiln.clearTokens(); location.href = '/'; });
  })();
})();
