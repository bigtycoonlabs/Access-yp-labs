// The Dreamhold laboratory — chat-first, accessible. Talk to Clay, then act inline.
(function () {
  if (!Kiln.isLoggedIn()) { location.replace('/login.html'); return; }

  const log = document.getElementById('log');
  const promptEl = document.getElementById('prompt');
  const categoryEl = document.getElementById('category');
  const sendBtn = document.getElementById('send');
  let mode = 'create';
  // The concept we're actively working on. Once a concept exists, the next message
  // refines THAT concept (a new version) instead of spawning a fresh one. Cleared
  // by choosing "Create" or "Start a fresh concept".
  let currentConceptId = null;
  // Whether Clay's generation provider is connected. When it isn't, we say so
  // plainly instead of letting a build fail with a vague error.
  let clayAvailable = true;

  // ---- small DOM helpers (textContent only for untrusted strings) ----
  const CATEGORY_WORDS = {
    digital_product_saas: 'digital products and SaaS',
    online_service_agency: 'online services',
    content_creator: 'content and creator businesses',
    ecommerce_pod: 'e-commerce',
    ai_product_service: 'AI products',
    remote_hybrid_physical: 'remote and hybrid ventures',
    micro_solo: 'micro and solo businesses',
  };
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
    const params = new URLSearchParams(location.search);
    const openId = /^[0-9a-f-]{36}$/i.test(params.get('concept') || '') ? params.get('concept') : null;
    try {
      const me = await Kiln.api('/auth/me');
      document.getElementById('greeting').textContent = `Welcome, ${me.user.name || 'there'}`;
    } catch (_) {}
    try {
      const s = await Kiln.api('/clay/status');
      clayAvailable = !!s.available;
      const el2 = document.getElementById('clay-status');
      if (s.available) {
        el2.textContent = 'Clay is ready.';
      } else {
        el2.textContent = 'Clay’s builder isn’t switched on yet. You can still browse and manage your work — building will light up as soon as it’s connected.';
        el2.setAttribute('role', 'alert');
        announce('Heads up: Clay’s builder isn’t connected yet, so it can’t create concepts right now. You can still browse and manage your work.', true);
      }
    } catch (_) {}
    // Opening an existing concept to keep refining it — skip the generic opening.
    if (openId) { await loadConceptIntoWorkspace(openId); return; }
    let prefs = null;
    try { const r = await Kiln.api('/preferences'); prefs = r.preferences; } catch (_) {}
    const m = message('clay', 'Clay');
    let opening = "I'm Clay. Here's how this works: you bring me an idea — any idea, half-formed is fine — and we pressure-test it, sharpen it, and build the whole thing out together: the plan, the research, the marketing, a working demo. It stays your idea; I just help bring it to life. Pick “Create” to start something new, or “Enhance” to sharpen an idea you already have or a business you already run. So — what's the one that's been living in your head?";
    if (prefs && prefs.interests && prefs.interests.length) {
      const words = prefs.interests.map((i) => CATEGORY_WORDS[i] || i.replace(/_/g, ' '));
      const list = words.length === 1 ? words[0] : (words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1]);
      opening = 'Welcome back. You told me you’re drawn to ' + list + ' — so what’s it going to be: shape one of those, pick up where we left off, or chase something brand new? “Create” starts fresh; “Enhance” sharpens something you’ve already got.';
    }
    // If they handed Clay an idea from the homepage before signing up, it's
    // waiting for them here — greet them with it and pre-fill the box.
    try {
      const pend = await Kiln.api('/clay/pending-idea');
      if (pend && pend.idea) {
        opening = 'Welcome in — and I didn’t forget. Before you even signed up, you told me: “' + pend.idea + '.” It’s waiting right here in the box, just as you left it. Send it and let’s make it real — or tweak it first if it’s shifted. It stays your idea; I just bring it to life.';
        if (promptEl) promptEl.value = pend.idea;
      }
    } catch (_) {}
    m.appendChild(el('p', null, opening));

    // Gentle, mutable reminder about concepts built but not yet kept. Honest and
    // easy to silence — never shown to Sculptor/staff (their count is 0).
    try {
      const u = await Kiln.api('/concepts/unkept-summary');
      if (u && u.count > 0 && !u.muted) {
        const r = message('clay', 'Clay');
        const names = (u.sample || []).map((s) => s.title).filter(Boolean);
        const lead = u.count === 1
          ? 'One gentle nudge: you’ve built a concept you haven’t kept yet'
          : ('One gentle nudge: you’ve built ' + u.count + ' concepts you haven’t kept yet');
        r.appendChild(el('p', null, lead + (names.length ? (' — ' + names.join(', ')) : '') + '. They’re yours to download anytime with Maker, $2.99 each. No rush — and you can quiet these whenever you like.'));
        const acts = el('div', 'actions');
        const see = el('a', 'btn secondary', 'See my concepts'); see.href = '/dashboard.html'; acts.appendChild(see);
        const quiet = el('button', 'btn secondary', 'Quiet these reminders'); quiet.type = 'button';
        quiet.addEventListener('click', async () => {
          quiet.disabled = true;
          try {
            await Kiln.api('/preferences/reminders', { method: 'PUT', body: { muted: true } });
            r.innerHTML = ''; r.appendChild(el('p', 'muted', 'Reminders quieted. You can turn them back on in settings anytime.'));
            announce('Reminders quieted.', true);
          } catch (e) { announce(e.message, true); quiet.disabled = false; }
        });
        acts.appendChild(quiet);
        r.appendChild(acts);
      }
    } catch (_) {}
  })();

  // ---- mode toggle ----
  function setMode(next) {
    mode = next;
    if (next === 'create' && currentConceptId) { currentConceptId = null; }
    document.getElementById('mode-create').setAttribute('aria-pressed', String(next === 'create'));
    document.getElementById('mode-enhance').setAttribute('aria-pressed', String(next === 'enhance'));
    const opWrap = document.getElementById('operating-wrap');
    if (opWrap) {
      opWrap.hidden = next !== 'enhance';
      if (next !== 'enhance') { const ob = document.getElementById('operating'); if (ob) ob.checked = false; }
    }
    announce(next === 'create' ? 'Create a new concept selected.' : 'Enhance selected. You can mark this as a business you already run.');
  }
  document.getElementById('mode-create').addEventListener('click', () => setMode('create'));
  document.getElementById('mode-enhance').addEventListener('click', () => setMode('enhance'));

  // ---- open an existing concept to keep refining it ----
  async function loadConceptIntoWorkspace(id) {
    try {
      const { concept, assets } = await Kiln.api('/concepts/' + id);
      currentConceptId = concept.id;
      const m = message('clay', 'Clay');
      m.appendChild(el('p', null, 'Picking up where we left off on “' + (concept.title || 'your concept') + '.” Everything you built is still here — tell me what to change or add and I’ll refine this same concept. You can start a fresh one anytime.'));
      const current = (assets || []).filter((a) => a.is_current !== false);
      if (current.length) {
        const acts = el('div', 'actions');
        current.forEach((a) => {
          const b = el('button', 'btn secondary', 'View: ' + (a.title || a.type)); b.type = 'button';
          b.addEventListener('click', () => viewAsset(m, a.id, a.title || a.type));
          acts.appendChild(b);
        });
        const dl = el('button', 'btn', 'Download package'); dl.type = 'button';
        dl.addEventListener('click', () => exportConcept(m, concept.id));
        acts.appendChild(dl);
        const fresh = el('button', 'btn secondary', 'Start a fresh concept instead'); fresh.type = 'button';
        fresh.addEventListener('click', startFreshConcept);
        acts.appendChild(fresh);
        m.appendChild(acts);
      }
      announce('Continuing your concept: ' + (concept.title || 'your concept') + '. Add a message to refine it.', true);
      if (promptEl) promptEl.focus();
    } catch (e) {
      const m = message('clay', 'Clay');
      m.appendChild(el('p', 'msg err', 'I couldn’t open that concept — it may have been removed. You can start a new one below.'));
      announce('That concept could not be opened.', true);
    }
  }

  function startFreshConcept() {
    currentConceptId = null;
    const m = message('clay', 'Clay');
    m.appendChild(el('p', null, 'Fresh start — this next idea will be its own concept. What are we building?'));
    announce('Starting a new concept.', true);
    if (promptEl) { promptEl.value = ''; promptEl.focus(); }
  }

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
      const operatingEl = document.getElementById('operating');
      const operating = mode === 'enhance' && !!(operatingEl && operatingEl.checked);
      const data = await Kiln.api('/clay/generate', { method: 'POST', body: { mode, category, prompt, operating, concept_id: currentConceptId || undefined } });
      // From here on, keep refining the same concept until they start fresh.
      if (data && data.status === 'answered' && data.concept) currentConceptId = data.concept.id;
      thinking.removeChild(think);
      renderResult(thinking, data);
    } catch (e) {
      thinking.removeChild(think);
      if (e && (e.sessionExpired || e.status === 401)) {
        thinking.appendChild(el('p', null, 'Looks like your session timed out — I’m sending you to sign back in. Your work is saved.'));
        announce('Your session timed out. Taking you to sign in.', true);
        setTimeout(function () { location.href = '/login.html?session=expired'; }, 1600);
        return;
      }
      thinking.appendChild(el('p', 'msg err', 'I hit a snag and couldn’t finish that one — and I never make things up, so nothing was fabricated. Give me another go in a moment.'));
      announce('Clay hit a snag. Nothing was fabricated.', true);
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
      if (data.source_check) {
        const supported = /^all concrete claims are supported/i.test(String(data.source_check).trim());
        const sc = el('div', 'source-check');
        sc.setAttribute('role', 'note');
        sc.appendChild(el('p', null, supported
          ? 'Source check: I checked every concrete claim against the sources I found, and they hold up.'
          : 'Source check — please treat these with caution; the sources I found don’t fully back them:'));
        if (!supported) sc.appendChild(el('p', 'muted', data.source_check));
        container.appendChild(sc);
        announce(supported
          ? 'Source check passed. Every concrete claim is supported by the sources.'
          : 'Source check: some claims may not be fully supported. Details are shown below.', true);
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
      if (data.concept && data.concept.is_operating) {
        // A running business is never listed for sale. Offer a complementary dream instead.
        if (data.dreamhold_suggestion && data.dreamhold_suggestion.reason) {
          container.appendChild(el('p', 'muted', 'Clay suggests: ' + data.dreamhold_suggestion.reason));
        }
        const findBtn = el('a', 'btn', 'Find a complementary dream in the Dreamhold');
        const cat = data.dreamhold_suggestion && data.dreamhold_suggestion.category;
        findBtn.href = '/marketplace.html?entered=1' + (cat ? ('&category=' + encodeURIComponent(cat)) : '');
        actions.appendChild(findBtn);
      } else {
        const listBtn = el('button', 'btn', 'List this in the Dreamhold'); listBtn.type = 'button';
        listBtn.addEventListener('click', () => openListingForm(container, data.concept.id));
        actions.appendChild(listBtn);
      }
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

      // The "free until you download" moment — positive, shown once, never a nag.
      // Only when this concept isn't already kept (staff/Sculptor/Maker come back
      // entitled, so they never see an upsell).
      if (data.entitled === false && data.concept) {
        const keep = el('div', 'keep-note');
        keep.setAttribute('role', 'note');
        keep.appendChild(el('p', null, 'This concept is yours to explore and refine right now — free. Whenever you want to download it, share it, or keep it for good, that’s Maker: $2.99 for this one concept.'));
        const kb = el('button', 'btn', 'Keep this concept — $2.99'); kb.type = 'button';
        kb.addEventListener('click', async () => {
          kb.disabled = true;
          try {
            const r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'maker', concept_id: data.concept.id } });
            if (r.url) { location.href = r.url; return; }
            announce(r.message || 'Billing isn’t configured yet, so nothing was charged.', true); kb.disabled = false;
          } catch (e) { announce(e.message, true); kb.disabled = false; }
        });
        keep.appendChild(kb);
        container.appendChild(keep);
      }
      // Retrieval grounding, surfaced honestly: the user's own related prior work
      // Clay had in mind while building. Only their real earlier concepts.
      if (Array.isArray(data.related_prior) && data.related_prior.length) {
        const names = data.related_prior.map((p) => p.title).filter(Boolean);
        if (names.length) {
          const note = el('p', 'muted');
          note.appendChild(document.createTextNode('Clay built this with your earlier work in mind: ' + names.join(', ') + '.'));
          container.appendChild(note);
        }
      }
      announce('Clay assembled your concept, with ' + (data.assets || []).length + ' sections. Suggested next steps are available.');
      return;
    }
    // Non-answers — always honest, never fabricated.
    const map = {
      unavailable: 'Clay’s builder isn’t connected right now, so it couldn’t create anything — and it never invents, so nothing was made up. This is a setup step on our side, not something you did. ',
      empty: 'Clay ran but did not produce a usable package, so nothing was saved. ',
      refused: '',
    };
    if (data.status === 'unavailable') clayAvailable = false;
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
