// The Dreamhold laboratory — chat-first, accessible. Talk to Clay, then act inline.
(function () {
  if (!Kiln.isLoggedIn()) { location.replace('/login.html'); return; }

  const log = document.getElementById('log');
  const promptEl = document.getElementById('prompt');
  const categoryEl = document.getElementById('category');
  const sendBtn = document.getElementById('send');
  let mode = 'create';

  // ---- small DOM helpers (textContent only for untrusted strings) ----
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function message(who, label) {
    const m = el('div', 'message' + (who === 'you' ? ' you' : ''));
    m.appendChild(el('p', 'who', label));
    log.appendChild(m);
    return m;
  }
  function scrollToLatest(node) { node.scrollIntoView({ block: 'nearest' }); }

  // ---- init: greet + honest Clay status ----
  (async function init() {
    try {
      const me = await Kiln.api('/auth/me');
      document.getElementById('greeting').textContent = `Welcome, ${me.user.name || 'there'}`;
    } catch (_) {}
    try {
      const s = await Kiln.api('/clay/status');
      const el2 = document.getElementById('clay-status');
      el2.textContent = s.available ? 'Clay is ready.' : 'Clay generation is not configured yet — you can still browse and manage your work.';
    } catch (_) {}
    const m = message('clay', 'Clay');
    m.appendChild(el('p', null, "I'm Clay. Tell me about a business you want to shape, or an idea you already have — then I'll build a full concept package with you. Choose “Create” to start fresh or “Enhance” to sharpen an idea you already have."));
  })();

  // ---- mode toggle ----
  function setMode(next) {
    mode = next;
    document.getElementById('mode-create').setAttribute('aria-pressed', String(next === 'create'));
    document.getElementById('mode-enhance').setAttribute('aria-pressed', String(next === 'enhance'));
    announce(next === 'create' ? 'Create a new concept selected.' : 'Enhance my idea selected.');
  }
  document.getElementById('mode-create').addEventListener('click', () => setMode('create'));
  document.getElementById('mode-enhance').addEventListener('click', () => setMode('enhance'));

  // ---- send to Clay ----
  async function send() {
    const prompt = promptEl.value.trim();
    const category = categoryEl.value || undefined;
    if (prompt.length < 3) { announce('Please describe your idea first.', true); promptEl.focus(); return; }

    const you = message('you', 'You');
    you.appendChild(el('p', null, prompt));
    scrollToLatest(you);
    promptEl.value = '';
    sendBtn.disabled = true;
    announce('Clay is thinking…');
    const thinking = message('clay', 'Clay');
    const think = el('p', 'muted', 'Thinking…');
    thinking.appendChild(think);

    try {
      const data = await Kiln.api('/clay/generate', { method: 'POST', body: { mode, category, prompt } });
      thinking.removeChild(think);
      renderResult(thinking, data);
    } catch (e) {
      thinking.removeChild(think);
      thinking.appendChild(el('p', 'msg err', e.message));
      announce('Something went wrong: ' + e.message, true);
    } finally {
      sendBtn.disabled = false;
      scrollToLatest(thinking);
    }
  }
  sendBtn.addEventListener('click', send);

  // ---- render Clay's result honestly by status ----
  function renderResult(container, data) {
    if (data.status === 'answered') {
      container.appendChild(el('p', null, data.message || 'Here is your concept.'));
      if (data.coverage && !data.coverage.complete) {
        container.appendChild(el('p', 'coverage', data.coverage.gap_description));
      }
      const actions = el('div', 'actions');
      (data.assets || []).forEach((a) => {
        const b = el('button', 'btn secondary', 'View: ' + (a.title || a.type));
        b.type = 'button';
        b.addEventListener('click', () => viewAsset(container, a.id, a.title || a.type));
        actions.appendChild(b);
      });
      const dl = el('button', 'btn', 'Download package'); dl.type = 'button';
      dl.addEventListener('click', () => exportConcept(container, data.concept.id));
      actions.appendChild(dl);
      if ((data.assets || []).some((a) => a.type === 'html_demo' || a.type === 'built_site')) {
        const demoBtn = el('a', 'btn', 'Open live demo');
        demoBtn.href = '/sandbox.html?concept=' + encodeURIComponent(data.concept.id);
        actions.appendChild(demoBtn);
      }
      const listBtn = el('button', 'btn', 'List this in the Dreamhold'); listBtn.type = 'button';
      listBtn.addEventListener('click', () => openListingForm(container, data.concept.id));
      actions.appendChild(listBtn);
      const socialBtn = el('button', 'btn secondary', 'Generate social content'); socialBtn.type = 'button';
      socialBtn.addEventListener('click', () => openSocialForm(container, data.concept.id));
      actions.appendChild(socialBtn);
      if ((data.assets || []).some((a) => a.type === 'image_prompt' || a.type === 'example_image')) {
        const imgBtn = el('button', 'btn secondary', 'Render a photo'); imgBtn.type = 'button';
        imgBtn.addEventListener('click', () => openImageRender(container, data.concept.id));
        actions.appendChild(imgBtn);
      }
      if ((data.assets || []).some((a) => a.type === 'video_script')) {
        const vidBtn = el('button', 'btn secondary', 'Render a video'); vidBtn.type = 'button';
        vidBtn.addEventListener('click', () => openVideoRender(container, data.concept.id));
        actions.appendChild(vidBtn);
      }
      const consultBtn = el('a', 'btn secondary', 'Book a consultant about this');
      consultBtn.href = '/consultants.html?concept=' + encodeURIComponent(data.concept.id);
      actions.appendChild(consultBtn);
      container.appendChild(actions);
      announce('Clay assembled your concept, with ' + (data.assets || []).length + ' sections. Suggested next steps are available.');
      return;
    }
    // Non-answers — always honest, never fabricated.
    const map = {
      unavailable: 'Clay could not run just now, so nothing was generated and nothing was made up. ',
      empty: 'Clay ran but did not produce a usable package, so nothing was saved. ',
      refused: '',
    };
    let text = (map[data.status] || '') + (data.message || '');
    if (data.redirect === 'needs_category') text += ' Pick a category above, or add more detail, and send again.';
    container.appendChild(el('p', 'msg ' + (data.status === 'refused' ? 'ok' : 'err'), text.trim()));
    announce(text.trim(), true);
  }

  // ---- gated export: download the package, or show the plan gate ----
  async function exportConcept(container, conceptId) {
    announce('Preparing your download…');
    try {
      const { assets } = await Kiln.api('/concepts/' + conceptId + '/export');
      const text = (assets || []).map((a) => '# ' + (a.title || a.type) + '\n\n' + (a.body || '') + '\n').join('\n\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'concept-package.txt';
      document.body.appendChild(a); a.click(); a.remove();
      announce('Your package download has started.', true);
    } catch (e) {
      if (e.status === 402 && e.data && e.data.options) return renderPaywall(container, e.data);
      announce('Could not export: ' + e.message, true);
    }
  }

  function renderPaywall(container, data) {
    const wrap = el('div', 'panel');
    wrap.appendChild(el('h3', null, 'Choose a plan to download or share'));
    wrap.appendChild(el('p', null, data.message || 'Keep building for free — a plan is needed to pull the materials out.'));
    const acts = el('div', 'actions');
    (data.options || []).forEach((o) => {
      const b = el('button', 'btn' + (o.plan === 'maker' ? ' secondary' : ''), o.label); b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const body = o.plan === 'maker' ? { plan: 'maker', concept_id: o.concept_id } : { plan: 'sculptor' };
          const r = await Kiln.api('/subscriptions', { method: 'POST', body });
          if (r.url) { location.href = r.url; return; }
          announce(r.message || 'Billing is not configured yet.', true); b.disabled = false;
        } catch (e) { announce(e.message, true); b.disabled = false; }
      });
      acts.appendChild(b);
    });
    wrap.appendChild(acts);
    container.appendChild(wrap);
    focusEl(wrap.querySelector('h3'), 'A plan is required to download or share these materials.');
  }

  // ---- view an asset body accessibly ----
  async function viewAsset(container, id, label) {
    announce('Loading ' + label + '…');
    try {
      const { asset } = await Kiln.api('/assets/' + id);
      const wrap = el('div');
      wrap.appendChild(el('h3', null, label));
      const body = el('div', 'asset-body', asset.body || '(empty)');
      body.setAttribute('tabindex', '-1');
      body.setAttribute('role', 'region');
      body.setAttribute('aria-label', label);
      wrap.appendChild(body);
      container.appendChild(wrap);
      focusEl(body, label + ' loaded.');
    } catch (e) { announce('Could not load ' + label + ': ' + e.message, true); }
  }

  // ---- inline listing form (baseline gate + acknowledgments) ----
  // ---- render a short video from a script (dormant until a provider key is set) ----
  function openVideoRender(container, conceptId) {
    const f = el('div', 'panel');
    f.appendChild(el('h3', null, 'Render a video'));
    f.appendChild(el('p', 'muted', 'Paste your video script or a short prompt. If video rendering isn’t set up yet, Clay will tell you plainly. Note: a rendered video isn’t auto-described — use your video script for the spoken version.'));
    const ta = document.createElement('textarea'); ta.setAttribute('aria-label', 'Video script or prompt'); f.appendChild(ta);
    const go = el('button', 'btn', 'Render'); go.type = 'button';
    const out = el('div'); out.setAttribute('role', 'region'); out.setAttribute('aria-live', 'polite');
    go.addEventListener('click', async () => {
      const prompt = ta.value.trim();
      if (prompt.length < 3) { announce('Please enter a longer script or prompt.', true); return; }
      go.disabled = true; announce('Rendering…'); out.innerHTML = '';
      try {
        const data = await Kiln.api('/clay/render-video', { method: 'POST', body: { concept_id: conceptId, prompt } });
        if (data.status !== 'answered') { out.appendChild(el('p', 'msg err', data.message)); announce(data.message, true); go.disabled = false; return; }
        const a = el('a', 'btn secondary', 'Open rendered video'); a.href = data.url; a.target = '_blank'; out.appendChild(a);
        announce(data.message || 'Video rendered.', true); go.disabled = false;
      } catch (e) { out.appendChild(el('p', 'msg err', e.message)); announce(e.message, true); go.disabled = false; }
    });
    f.appendChild(go); f.appendChild(out); container.appendChild(f);
    focusEl(f.querySelector('h3'), 'Video render opened.');
  }

  // ---- render a photo from a prompt (dormant until a provider key is set) ----
  function openImageRender(container, conceptId) {
    const f = el('div', 'panel');
    f.appendChild(el('h3', null, 'Render a photo'));
    f.appendChild(el('p', 'muted', 'Describe the image, or paste one of Clay’s image prompts. Clay will describe the result in words so you can verify it. If rendering isn’t set up yet, Clay will tell you plainly.'));
    const ta = document.createElement('textarea'); ta.setAttribute('aria-label', 'Image prompt'); f.appendChild(ta);
    const go = el('button', 'btn', 'Render'); go.type = 'button';
    const out = el('div'); out.setAttribute('role', 'region'); out.setAttribute('aria-live', 'polite');
    go.addEventListener('click', async () => {
      const prompt = ta.value.trim();
      if (prompt.length < 3) { announce('Please enter a longer prompt.', true); return; }
      go.disabled = true; announce('Rendering…'); out.innerHTML = '';
      try {
        const data = await Kiln.api('/clay/render-image', { method: 'POST', body: { concept_id: conceptId, prompt } });
        if (data.status !== 'answered') { out.appendChild(el('p', 'msg err', data.message)); announce(data.message, true); go.disabled = false; return; }
        if (data.image_base64) {
          const img = document.createElement('img');
          img.src = 'data:' + (data.media_type || 'image/png') + ';base64,' + data.image_base64;
          img.alt = data.description || 'Rendered image'; img.style.maxWidth = '100%'; img.style.borderRadius = '10px';
          out.appendChild(img);
        } else if (data.url) {
          const a = el('a', 'btn secondary', 'Open rendered image'); a.href = data.url; a.target = '_blank'; out.appendChild(a);
        }
        if (data.description) out.appendChild(el('p', null, 'Description: ' + data.description));
        announce(data.message || 'Image rendered.', true); go.disabled = false;
      } catch (e) { out.appendChild(el('p', 'msg err', e.message)); announce(e.message, true); go.disabled = false; }
    });
    f.appendChild(go); f.appendChild(out); container.appendChild(f);
    focusEl(f.querySelector('h3'), 'Image render opened.');
  }

  // ---- social content generation (posts, photos-as-prompts, video scripts) ----
  var SOCIAL_PLATFORMS = ['instagram', 'facebook', 'x', 'linkedin', 'tiktok', 'youtube_shorts', 'pinterest'];
  var SOCIAL_GOALS = ['awareness', 'launch', 'engagement', 'promotion', 'education'];
  function openSocialForm(container, conceptId) {
    const f = el('div', 'panel');
    f.appendChild(el('h3', null, 'Generate social content'));
    f.appendChild(el('p', 'muted', 'Clay writes posts, photo/image prompts, short-form video scripts, reusable templates, and a posting calendar. Building is free; downloading or exporting follows the same plan rules as your other materials.'));
    const pfs = el('fieldset'); pfs.appendChild(el('legend', null, 'Platforms'));
    SOCIAL_PLATFORMS.forEach((p) => {
      const lab = el('label', 'check'); const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = p; cb.className = 'social-pf';
      lab.appendChild(cb); lab.appendChild(document.createTextNode(' ' + p.replace(/_/g, ' ')));
      pfs.appendChild(lab);
    });
    f.appendChild(pfs);
    const gl = el('label'); gl.textContent = 'Goal'; gl.setAttribute('for', 'social-goal'); f.appendChild(gl);
    const goal = document.createElement('select'); goal.id = 'social-goal';
    SOCIAL_GOALS.forEach((g) => { const o = document.createElement('option'); o.value = g; o.textContent = g; goal.appendChild(o); });
    f.appendChild(goal);
    const cl = el('label'); cl.textContent = 'About how many posts?'; cl.setAttribute('for', 'social-count'); f.appendChild(cl);
    const count = document.createElement('input'); count.id = 'social-count'; count.type = 'number'; count.min = '1'; count.max = '30'; count.value = '6'; f.appendChild(count);
    const go = el('button', 'btn', 'Generate'); go.type = 'button';
    const out = el('div'); out.setAttribute('role', 'region'); out.setAttribute('aria-live', 'polite');
    go.addEventListener('click', async () => {
      const platforms = Array.prototype.slice.call(f.querySelectorAll('.social-pf:checked')).map((c) => c.value);
      if (!platforms.length) { announce('Choose at least one platform.', true); return; }
      go.disabled = true; announce('Clay is generating social content…'); out.innerHTML = '';
      try {
        const data = await Kiln.api('/clay/social', { method: 'POST',
          body: { concept_id: conceptId, platforms, goal: goal.value, count: parseInt(count.value, 10) || 6 } });
        if (data.status !== 'answered') {
          out.appendChild(el('p', 'msg err', data.message || 'Clay could not generate social content.'));
          announce(data.message || 'Clay could not generate social content.', true); go.disabled = false; return;
        }
        out.appendChild(el('p', null, data.message));
        if (data.coverage && !data.coverage.complete) out.appendChild(el('p', 'coverage', data.coverage.gap_description));
        const acts = el('div', 'actions');
        (data.assets || []).forEach((a) => {
          const b = el('button', 'btn secondary', 'View: ' + (a.title || a.type)); b.type = 'button';
          b.addEventListener('click', () => viewAsset(out, a.id, a.title || a.type));
          acts.appendChild(b);
        });
        out.appendChild(acts);
        announce('Clay generated ' + (data.assets || []).length + ' social content sections.');
      } catch (e) { out.appendChild(el('p', 'msg err', e.message)); announce(e.message, true); go.disabled = false; }
    });
    f.appendChild(go); f.appendChild(out); container.appendChild(f);
    focusEl(f.querySelector('h3'), 'Social content options opened.');
  }

  function openListingForm(container, conceptId) {
    const form = el('div', 'panel');
    form.appendChild(el('h3', null, 'List this concept on The Dreamhold'));
    form.appendChild(el('p', 'muted', 'You set the price. $50 minimum. Selling transfers ownership to the buyer.'));

    const fmtLabel = el('label'); fmtLabel.textContent = 'Sale format'; fmtLabel.setAttribute('for', 'l-format');
    const fmt = el('select'); fmt.id = 'l-format';
    ['flat', 'auction'].forEach((f) => { const o = el('option', null, f === 'flat' ? 'Flat price' : 'Auction'); o.value = f; fmt.appendChild(o); });

    const priceLabel = el('label'); priceLabel.textContent = 'Price in US dollars'; priceLabel.setAttribute('for', 'l-price');
    const price = el('input'); price.id = 'l-price'; price.type = 'number'; price.min = '50'; price.step = '1'; price.value = '50';

    const riskWrap = el('label'); riskWrap.style.fontWeight = '400';
    const risk = el('input'); risk.type = 'checkbox'; risk.id = 'l-risk'; risk.style.width = 'auto'; risk.style.minHeight = 'auto'; risk.style.marginRight = '10px';
    riskWrap.appendChild(risk); riskWrap.appendChild(document.createTextNode(' I have disclosed the regulatory and licensing risk in this concept.'));

    const ownWrap = el('label'); ownWrap.style.fontWeight = '400';
    const own = el('input'); own.type = 'checkbox'; own.id = 'l-own'; own.style.width = 'auto'; own.style.minHeight = 'auto'; own.style.marginRight = '10px';
    ownWrap.appendChild(own); ownWrap.appendChild(document.createTextNode(' I understand that selling transfers ownership to the buyer.'));

    const submit = el('button', 'btn', 'Submit listing for review'); submit.type = 'button';
    const out = el('div'); out.setAttribute('role', 'alert'); out.setAttribute('aria-live', 'assertive');

    submit.addEventListener('click', async () => {
      out.textContent = '';
      const dollars = parseInt(price.value, 10);
      if (!dollars || dollars < 50) { out.appendChild(el('p', 'msg err', 'Price must be at least $50.')); announce('Price must be at least $50.', true); return; }
      if (!risk.checked || !own.checked) { out.appendChild(el('p', 'msg err', 'Please confirm both acknowledgments.')); announce('Please confirm both acknowledgments.', true); return; }
      submit.disabled = true; announce('Submitting your listing…');
      try {
        const body = { concept_id: conceptId, format: fmt.value, risk_disclosed: true, ownership_ack: true };
        if (fmt.value === 'flat') body.price_cents = dollars * 100; else body.starting_bid_cents = dollars * 100;
        const { listing } = await Kiln.api('/listings', { method: 'POST', body });
        await Kiln.api('/listings/' + listing.id + '/submit', { method: 'POST' });
        out.appendChild(el('p', 'msg ok', 'Listing submitted for review. It goes live once a moderator approves it.'));
        announce('Listing submitted for review.', true);
        submit.disabled = true;
      } catch (e) {
        let m = e.message;
        if (e.data && e.data.details && e.data.details.needs) {
          const n = e.data.details.needs;
          const missing = Object.entries(n).filter(([, v]) => !v).map(([k]) => k.replace(/_/g, ' '));
          m += ' Still needed: ' + missing.join(', ') + '.';
        }
        out.appendChild(el('p', 'msg err', m)); announce(m, true); submit.disabled = false;
      }
    });

    [fmtLabel, fmt, priceLabel, price, riskWrap, ownWrap, submit, out].forEach((n) => form.appendChild(n));
    container.appendChild(form);
    focusEl(fmt, 'Listing form opened.');
  }

  document.getElementById('signout').addEventListener('click', (e) => {
    e.preventDefault(); Kiln.clearTokens(); location.href = '/';
  });
})();
