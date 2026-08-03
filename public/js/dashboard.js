// The Dreamhold dashboard — management overview with state-aware actions.
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
  async function run(promise, okMsg, reloader) {
    await promise; announce(okMsg, true); if (reloader) reloader();
  }
  function empty(container, text) { container.innerHTML = ''; container.appendChild(el('p', 'muted', text)); }
  function fail(container, e) { container.innerHTML = ''; container.appendChild(el('p', 'msg err', e.message)); }

  // Download a concept's package, or surface the honest plan gate inline (with a
  // one-tap Keep for this specific concept) if it isn't kept yet.
  async function loadTodaysDreams() {
    const c = document.getElementById('today'); if (!c) return;
    const dg = document.getElementById('today-digest');
    c.innerHTML = ''; if (dg) dg.textContent = 'Finding fresh Dreams for you…';
    try {
      const { dreams, digest } = await Kiln.api('/listings/today');
      if (!dreams.length) {
        if (dg) dg.textContent = '';
        empty(c, 'No fresh Dreams matched to you just yet — new ones arrive regularly. You can explore the full Dreamhold anytime.');
        const go = el('a', 'btn secondary', 'Explore the Dreamhold'); go.href = '/marketplace.html'; go.setAttribute('role', 'button');
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
        if (maker) host.appendChild(actionBtn('Keep just this concept — $2.99/month', () => go({ plan: 'maker', concept_id: maker.concept_id })));
        if (sculptor) host.appendChild(actionBtn('Keep everything — unlimited concepts, $49.99/month', () => go({ plan: 'sculptor' })));
        announce('A plan is needed to download this concept. You can keep just this concept for $2.99 a month, or get unlimited concepts for $49.99 a month.', true);
      } else { announce(e.message || 'Could not download.', true); }
    }
  }

  // ---------- Payouts ----------
  async function loadPayouts() {
    const c = document.getElementById('payouts'); c.innerHTML = '';
    try {
      const s = await Kiln.api('/sellers/status');
      if (!s.stripe_configured) { empty(c, 'Payouts are not configured on the platform yet. You can still create and list concepts; buyers can transact once payouts are enabled.'); return; }
      if (s.onboarded && s.kyc_status === 'verified') { c.appendChild(el('p', 'msg ok', 'Payouts are ready. You can receive funds from concept sales and from consultant sessions.')); return; }
      if (s.onboarded) {
        c.appendChild(el('p', null, 'Payout setup is in progress.'));
        c.appendChild(actionBtn('Refresh payout status', () => run(Kiln.api('/sellers/refresh', { method: 'POST' }), 'Refreshed.', loadPayouts), true));
        c.appendChild(actionBtn('Continue payout setup', async () => {
          const r = await Kiln.api('/sellers/onboard', { method: 'POST' });
          if (r.url) location.href = r.url; else announce(r.message || 'Could not continue setup.', true);
        }));
        return;
      }
      c.appendChild(el('p', null, 'Set up payouts so you can receive funds — from selling concepts and from consultant sessions you deliver.'));
      c.appendChild(actionBtn('Set up payouts', async () => {
        const r = await Kiln.api('/sellers/onboard', { method: 'POST' });
        if (r.url) location.href = r.url; else announce(r.message || 'Payouts are not configured yet.', true);
      }));
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
      const goSculptor = async () => {
        const r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'sculptor' } });
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
        c.appendChild(el('p', 'msg ok', 'Sculptor plan active — unlimited concepts ($49.99/month).'));
        if (sculptor.cancel_at_period_end) {
          c.appendChild(el('p', 'muted', 'Ending at the close of your current period — you keep full access until then.'));
        } else {
          c.appendChild(cancelSubBtn(sculptor, 'Sculptor'));
        }
        return;
      }
      const makers = active.filter((s) => s.plan === 'maker');
      if (makers.length) {
        c.appendChild(el('p', null, makers.length + ' concept' + (makers.length > 1 ? 's' : '') + ' on the Maker plan ($2.99/month each).'));
        makers.forEach((m) => {
          const name = m.concept_title ? '“' + m.concept_title + '”' : 'this concept';
          const line = el('div', 'sub-row'); line.style.margin = '6px 0';
          line.appendChild(el('p', 'muted', 'Maker — ' + name + ' ($2.99/month)'));
          if (m.cancel_at_period_end) {
            line.appendChild(el('p', 'muted', 'Ending at the close of your current period — access continues until then.'));
          } else {
            line.appendChild(cancelSubBtn(m, 'Maker for ' + name));
          }
          c.appendChild(line);
        });
      } else {
        c.appendChild(el('p', 'muted', 'No plan yet. Build for free — a plan is asked for only when you download, share, or keep a concept past 30 days.'));
      }
      c.appendChild(actionBtn('Go Sculptor — $49.99/month, unlimited', goSculptor));
      c.appendChild(el('p', 'muted', 'The $2.99 Maker plan is per concept — you\u2019ll be offered it when you download a specific concept.'));
    } catch (e) { fail(c, e); }
  }

  // ---------- Concepts ----------
  async function loadConcepts() {
    const c = document.getElementById('concepts'); c.innerHTML = '';
    try {
      const { concepts } = await Kiln.api('/concepts');
      if (!concepts.length) { empty(c, 'No concepts yet. Open the laboratory to shape one with Clay.'); return; }
      concepts.forEach((x) => {
        const claimed = x.origin === 'purchased';
        const prefix = x.is_operating ? 'Your running business · ' : (claimed ? 'Claimed from the Dreamhold · ' : '');
        let meta = prefix + nice(x.category) + (x.is_housing ? ' · housing' : '');
        meta += x.entitled ? ' · kept — yours to download' : ' · free to build · $2.99 to keep';
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

  async function loadListings() {
    const c = document.getElementById('listings'); c.innerHTML = '';
    try {
      const { listings } = await Kiln.api('/listings/mine');
      const mk = el('a', 'btn secondary', 'Create a listing'); mk.href = '/sell.html'; c.appendChild(mk);
      if (!listings.length) { c.appendChild(el('p','muted','No listings yet. Use “Create a listing”, or from the laboratory choose “List this in the Dreamhold”.')); return; }
      listings.forEach((l) => {
        const price = l.format === 'auction' ? ('auction from ' + money(l.starting_bid_cents)) : money(l.price_cents);
        const r = row(l.title, nice(l.category) + ' · ' + price, l.status);
        if (l.status === 'draft') {
          r.actions.appendChild(actionBtn('Submit for review', () => run(Kiln.api('/listings/' + l.id + '/submit', { method: 'POST' }), 'Submitted for review.', loadListings)));
          const editWrap = el('div', 'stack'); editWrap.style.marginTop = '8px';
          r.actions.appendChild(actionBtn('Edit', () => { editWrap.innerHTML = ''; buildEditor(l, editWrap); }, true));
          r.appendChild(editWrap);
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
          r.actions.appendChild(actionBtn('Release and receive ownership', () => run(Kiln.api('/orders/' + o.id + '/release', { method: 'POST' }), 'Released. Ownership transferred to you.', loadOrders)));
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
    try {
      const { engagements } = await Kiln.api('/consultants/engagements');
      if (!engagements.length) { empty(c, 'No consultant sessions yet.'); return; }
      engagements.forEach((e) => {
        const iAmConsultant = e.consultant_id === me.id;
        const r = row(iAmConsultant ? 'Session you are delivering' : 'Session you requested',
          '$' + (e.fee_cents / 100).toFixed(2) + ' session', e.state);
        const A = r.actions;
        if (iAmConsultant) {
          if (e.state === 'requested') A.appendChild(actionBtn('Accept', () => run(Kiln.api('/consultants/engagements/' + e.id + '/accept', { method: 'POST' }), 'Accepted.', loadEngagements)));
          if (e.state === 'accepted') A.appendChild(actionBtn('Sign NDA (required before concept is shared)', () => run(Kiln.api('/consultants/engagements/' + e.id + '/nda', { method: 'POST' }), 'NDA signed.', loadEngagements)));
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
    } catch (e) { fail(c, e); }
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
        await run(Kiln.api('/preferences', { method: 'PUT', body }), 'Dreamhold tuning saved.', null);
      }));
    } catch (e) { fail(c, e); }
  }

  (async function init() {
    try { me = (await Kiln.api('/auth/me')).user; document.getElementById('greeting').textContent = 'Welcome, ' + (me.name || 'there'); }
    catch (_) { location.replace('/login.html'); return; }
    if (['staff', 'admin', 'master_staff'].includes(me.role)) {
      const g = document.getElementById('global');
      // Staff navigation now lives in the top menu (Staff → the staff hub), so the
      // dashboard stays uncluttered. Only the consultant-enroll action remains here.
      // Staff can post as a consultant directly — no application, no wait.
      try {
        const { consultant } = await Kiln.api('/consultants/me');
        if (consultant && consultant.approved) {
          const done = el('a', 'btn secondary', 'You post as a consultant — view directory');
          done.href = '/consultants.html'; done.style.marginLeft = '8px'; g.appendChild(done);
        } else {
          const enroll = el('button', 'btn secondary', 'Post as a consultant'); enroll.type = 'button';
          enroll.style.marginLeft = '8px';
          enroll.addEventListener('click', async () => {
            enroll.disabled = true;
            try { await Kiln.api('/consultants/enroll', { method: 'POST' }); enroll.textContent = 'You now post as a consultant'; announce('You can now post as a consultant.', true); }
            catch (e) { announce(e.message, true); enroll.disabled = false; }
          });
          g.appendChild(enroll);
        }
      } catch (_) {}

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
    loadTodaysDreams(); loadPayouts(); loadSubs(); loadConcepts(); loadListings(); loadOrders(); loadEngagements(); loadWatches(); loadTuning();
    document.getElementById('signout').addEventListener('click', (e) => { e.preventDefault(); Kiln.clearTokens(); location.href = '/'; });
  })();
})();
