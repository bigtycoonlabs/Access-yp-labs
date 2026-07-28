// The Kiln dashboard — management overview with state-aware actions.
(function () {
  if (!Kiln.isLoggedIn()) { location.replace('/login.html'); return; }
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

  // ---------- Payouts ----------
  async function loadPayouts() {
    const c = document.getElementById('payouts'); c.innerHTML = '';
    try {
      const s = await Kiln.api('/sellers/status');
      if (!s.stripe_configured) { empty(c, 'Payouts are not configured on the platform yet. You can still create and list concepts; buyers can transact once payouts are enabled.'); return; }
      if (s.onboarded && s.kyc_status === 'verified') { c.appendChild(el('p', 'msg ok', 'Payouts are ready. You can receive funds from sales.')); return; }
      if (s.onboarded) {
        c.appendChild(el('p', null, 'Payout setup is in progress.'));
        c.appendChild(actionBtn('Refresh payout status', () => run(Kiln.api('/sellers/refresh', { method: 'POST' }), 'Refreshed.', loadPayouts), true));
        c.appendChild(actionBtn('Continue payout setup', async () => {
          const r = await Kiln.api('/sellers/onboard', { method: 'POST' });
          if (r.url) location.href = r.url; else announce(r.message || 'Could not continue setup.', true);
        }));
        return;
      }
      c.appendChild(el('p', null, 'Set up payouts so you can sell concepts and receive funds.'));
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
      if (active.some((s) => s.plan === 'sculptor')) {
        c.appendChild(el('p', 'msg ok', 'Sculptor plan active — unlimited concepts ($49.99/month).'));
        return;
      }
      const makers = active.filter((s) => s.plan === 'maker');
      if (makers.length) {
        c.appendChild(el('p', null, makers.length + ' concept' + (makers.length > 1 ? 's' : '') + ' on the Maker plan ($2.99/month each).'));
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
      if (!concepts.length) { empty(c, 'No concepts yet. Open the workspace to shape one with Clay.'); return; }
      concepts.forEach((x) => {
        let meta = nice(x.category) + (x.is_housing ? ' · housing' : '');
        if (x.access_expires_at) {
          const days = Math.ceil((new Date(x.access_expires_at) - new Date()) / 86400000);
          meta += ' · ' + (days > 0 ? ('access ' + days + ' more day' + (days === 1 ? '' : 's') + ' unless subscribed') : 'access expired — subscribe to keep');
        }
        const r = row(x.title, meta, x.stage);
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
        c.appendChild(r);
      });
    } catch (e) { fail(c, e); }
  }

  // ---------- Listings ----------
  async function loadListings() {
    const c = document.getElementById('listings'); c.innerHTML = '';
    try {
      const { listings } = await Kiln.api('/listings/mine');
      if (!listings.length) { empty(c, 'No listings yet. From the workspace, choose “List this on The Kiln”.'); return; }
      listings.forEach((l) => {
        const price = l.format === 'auction' ? ('auction from ' + money(l.starting_bid_cents)) : money(l.price_cents);
        const r = row(l.title, nice(l.category) + ' · ' + price, l.status);
        if (l.status === 'draft') r.actions.appendChild(actionBtn('Submit for review', () => run(Kiln.api('/listings/' + l.id + '/submit', { method: 'POST' }), 'Submitted for review.', loadListings)));
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
          if (e.state === 'nda_signed') A.appendChild(actionBtn('Pay $150 to unlock the session', () => run(Kiln.api('/consultants/engagements/' + e.id + '/pay', { method: 'POST' }), 'Paid. Concept unlocked to your consultant.', loadEngagements)));
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

  (async function init() {
    try { me = (await Kiln.api('/auth/me')).user; document.getElementById('greeting').textContent = 'Welcome, ' + (me.name || 'there'); }
    catch (_) { location.replace('/login.html'); return; }
    if (['staff', 'admin', 'master_staff'].includes(me.role)) {
      const g = document.getElementById('global');
      const a = el('a', 'btn secondary', 'Open the review queue'); a.href = '/moderation.html';
      g.appendChild(a);
      if (['admin', 'master_staff'].includes(me.role)) {
        const a2 = el('a', 'btn secondary', 'Consultant applications'); a2.href = '/admin-consultants.html';
        a2.style.marginLeft = '8px'; g.appendChild(a2);
      }
    }
    const q = new URLSearchParams(location.search);
    if (q.get('onboard') === 'done') announce('Payout setup returned. Refreshing status.', true);
    if (q.get('sub') === 'done') announce('Thanks — your plan is being activated.', true);
    loadPayouts(); loadSubs(); loadConcepts(); loadListings(); loadOrders(); loadEngagements(); loadWatches();
    document.getElementById('signout').addEventListener('click', (e) => { e.preventDefault(); Kiln.clearTokens(); location.href = '/'; });
  })();
})();
