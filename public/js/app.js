// The Exchange laboratory — chat-first, accessible. Talk to Clay, then act inline.
(function () {
  if (!Kiln.isLoggedIn()) {
    // No access token in this browser — but the HttpOnly refresh cookie may still hold a live
    // session (localStorage gets wiped by the browser far sooner than the session should end).
    // Try to recover silently; only send them to sign in if that truly fails.
    Kiln.refresh().then(function (ok) {
      if (ok) location.reload();
      else location.replace('/login.html');
    });
    return;
  }

  const log = document.getElementById('log');
  const promptEl = document.getElementById('prompt');
  const categoryEl = document.getElementById('category');
  const sendBtn = document.getElementById('send');
  const attachEl = document.getElementById('attach');
  const attachedEl = document.getElementById('attached');
  let pendingUploadIds = [];
  // mode is no longer a stored choice — currentMode() derives it when a build is sent.
  // The project we're actively working on. Once a project exists, the next message
  // refines THAT project (a new version) instead of spawning a fresh one. Cleared
  // by choosing "Create" or "Start a fresh project".
  let currentConceptId = null;
  // Running back-and-forth with Clay while refining the CURRENT project. Sent to
  // /clay/chat each turn (the server returns the canonical transcript to replay).
  // Reset whenever we switch projects or start fresh, so contexts never bleed.
  let chatHistory = [];
  // The three pieces anyone can see and keep refining for free. Must match the server's
  // PREVIEW_TYPES in lib/entitlement.js. Everything else is built and updated but stays
  // locked until the project is kept.
  const PREVIEW_TYPES = ['business_plan', 'marketing_strategy', 'html_demo', 'built_site'];

  // When you're refining an existing project there's no decision to make — hide the
  // the "already running" checkbox, which is meaningless once a project is open — you are refining
  // that project, and whether some other business exists does not apply. It returns when you start
  // fresh. The create/enhance toggles this also used to hide no longer exist; mode is inferred.
  function setEditingConcept(editing) {
    const op = document.getElementById('operating');
    const wrap = op && op.closest ? op.closest('div') : null;
    if (wrap) wrap.hidden = !!editing;
    if (editing && op) op.checked = false;
  }

  function goSignIn() {
    announce('Your session ended — taking you to sign in. Your work is saved.', true);
    setTimeout(function () { location.href = '/login.html?session=expired'; }, 1400);
  }

  // Start the plan checkout from a locked project. Shared by the locked-files notice and the
  // per-file lock, so there's one honest path to unlock everything.
  async function keepConcept(conceptId, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'builder' } });
      if (r && r.url) { location.href = r.url; return; }
      announce((r && r.message) || 'Billing isn’t set up yet, so nothing was charged.', true);
    } catch (e) {
      if (e.sessionExpired) { goSignIn(); return; }
      announce(e.message, true);
    }
    if (btn) btn.disabled = false;
  }

  // Start the plan checkout. One plan now: the first project is free, everything after is covered
  // moment someone decides to pay they can choose to unlock everything, not just this one.
  async function goUnlimited(btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await Kiln.api('/subscriptions', { method: 'POST', body: { plan: 'builder' } });
      if (r && r.url) { location.href = r.url; return; }
      announce((r && r.message) || 'Billing isn’t set up yet, so nothing was charged.', true);
    } catch (e) {
      if (e.sessionExpired) { goSignIn(); return; }
      announce(e.message, true);
    }
    if (btn) btn.disabled = false;
  }
  // The unlimited option as a ready-to-append button, so every keep surface offers the same choice.
  function sculptorButton() {
    const b = el('button', 'btn secondary', 'Unlimited projects — $19/month'); b.type = 'button';
    b.addEventListener('click', () => goUnlimited(b));
    return b;
  }

  // Names the pieces that are built and waiting, with one clear way to unlock them all.
  function lockedNotice(container, conceptId, names) {
    if (!names || !names.length) return;
    const box = el('div', 'locked-note');
    box.setAttribute('role', 'note');
    box.appendChild(el('p', 'take-label', 'Built and waiting — unlocks when you keep this'));
    box.appendChild(el('p', null, 'Also ready inside this project: ' + names.join(', ') + '. Your business plan, marketing strategy, and live demo stay open for free — the rest opens the moment you keep it.'));
    const kb = el('button', 'btn', 'Unlock everything — $19/month'); kb.type = 'button';
    kb.addEventListener('click', () => keepConcept(conceptId, kb));
    box.appendChild(kb);
    box.appendChild(sculptorButton());
    container.appendChild(box);
  }
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
  // Render a line of Clay's text with any http(s) links clickable — so a landing-page link he
  // hands you is a real link you can open, not dead text. Safe: only text nodes and anchors.
  // EVERY LINE CLAY SAYS GOES THROUGH HERE. Which is why the markdown strip belongs here and
  // nowhere else.
  //
  // I fixed this twice in the wrong layer first. The stripper went into clay-stream.js, which
  // renders the PROGRESS commentary, and then into the streaming delta accumulator — and both times
  // I went to the live page and counted twenty literal asterisks still on screen, because the final
  // answer is rendered by renderChatReply -> sayLine and always was. Tracing the text to where it
  // lands, instead of fixing the first plausible place, would have found this in one step.
  //
  // ClaySpeakable is defined in clay-stream.js and shared; the fallback keeps this working if that
  // file has not loaded, because a missing helper must not mean a blank reply.
  function sayLine(text, cls) {
    const p = el('p', cls || null);
    const clean = (window.ClaySpeakable ? window.ClaySpeakable(text) : String(text == null ? '' : text));
    clean.split(/(https?:\/\/[^\s]+)/g).forEach(function (seg) {
      if (/^https?:\/\//.test(seg)) {
        const a = el('a', null, seg); a.href = seg; a.target = '_blank'; a.rel = 'noopener';
        p.appendChild(a);
      } else if (seg) { p.appendChild(document.createTextNode(seg)); }
    });
    return p;
  }
  // Clay's living mark — a bowl cradling the light. Each instance gets a unique gradient id
  // so several marks on one page don't collide. It's purely decorative (the speaker row and
  // build events carry the real text/announcements), so it's aria-hidden.
  let _cmN = 0;
  function clayMark() {
    const id = 'cmg' + (++_cmN);
    const wrap = el('span', 'clay-mark');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">' +
      '<defs><radialGradient id="' + id + '" cx="0.5" cy="0.5" r="0.5">' +
      '<stop offset="0" stop-color="#fff4e0"/><stop offset="0.34" stop-color="#ffd9a8"/>' +
      '<stop offset="1" stop-color="#ffb877" stop-opacity="0"/></radialGradient></defs>' +
      '<g fill="none" stroke-width="4" stroke-linecap="round">' +
      '<path class="cm-l" stroke="#b8a6ff" d="M31 50 C 20 49, 15 36, 16 18"/>' +
      '<path class="cm-r" stroke="#8ce0ff" d="M33 50 C 44 49, 49 36, 48 18"/></g>' +
      '<g class="cm-light"><circle class="cm-glow" cx="32" cy="35" r="7.5" fill="url(#' + id + ')"/>' +
      '<circle class="cm-core" cx="32" cy="35" r="3" fill="#ffd9a8"/></g></svg>';
    return wrap;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Friendly names for the materials Clay pulls from the flame, when an asset has no title.
  function labelForType(t) {
    const map = {
      business_plan: 'Business plan', marketing_strategy: 'Marketing strategy',
      build_path: 'Build path', roadmap: 'Build path', html_demo: 'Interactive demo',
      built_site: 'Working demo', money_flow: 'Money flow', unit_economics: 'Money flow',
      customer_research: 'Customer research', competitor_research: 'Competitor research',
      regulatory_risk: 'Risk & regulation', image_prompt: 'Visual project',
      example_image: 'Visual project', video_script: 'Video script', social: 'Social content'
    };
    if (map[t]) return map[t];
    return String(t || 'Section').replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }
  function message(who, label) {
    const m = el('div', 'message' + (who === 'you' ? ' you' : ''));
    // Identify every message by speaker, so VoiceOver announces who it's from ("Clay" / "You")
    // when you land on it — not just a floating line of text.
    m.setAttribute('role', 'group');
    m.setAttribute('aria-label', who === 'you' ? 'You' : 'Clay');
    if (who === 'you') {
      m.appendChild(el('p', 'who', label));
    } else {
      // Clay speaks with his living mark beside his name — animated, so whenever he's present
      // he feels alive rather than a flat label.
      const line = el('div', 'clay-line');
      line.appendChild(clayMark());
      line.appendChild(el('p', 'who', label));
      m.appendChild(line);
    }
    log.appendChild(m);
    return m;
  }
  function scrollToLatest(node) { node.scrollIntoView({ block: 'nearest' }); }

  // ---- init: greet + honest Clay status ----
  (async function init() {
    const params = new URLSearchParams(location.search);
    const openId = /^[0-9a-f-]{36}$/i.test(params.get('concept') || '') ? params.get('concept') : null;
    let firstName = '';
    try {
      const me = await Kiln.api('/auth/me');
      const nm = (me.user && me.user.name) || '';
      firstName = (nm.split(' ')[0]) || '';
      document.getElementById('greeting').textContent = `Welcome, ${nm || 'there'}`;
    } catch (e) {
      // A genuinely expired session (refresh already failed) must go cleanly to sign-in —
      // never fall through and greet a logged-out person as a brand-new visitor.
      if (e && e.sessionExpired) { goSignIn(); return; }
    }
    try {
      const s = await Kiln.api('/clay/status');
      clayAvailable = !!s.available;
      const el2 = document.getElementById('clay-status');
      if (s.available) {
        el2.textContent = 'Clay is ready.';
      } else {
        el2.textContent = 'Clay’s builder isn’t switched on yet. You can still browse and manage your work — building will light up as soon as it’s connected.';
        el2.setAttribute('role', 'alert');
        announce('Heads up: Clay’s builder isn’t connected yet, so it can’t create projects right now. You can still browse and manage your work.', true);
      }
    } catch (_) {}
    // Opening an existing project to keep refining it — skip the generic opening.
    if (openId) {
      await loadConceptIntoWorkspace(openId);
      // Deep-links from the project vault: open the listing form, or pre-load an edit
      // request for one section. Editing the loaded project is already the refine path, so we
      // just prime the message box — no mode toggle needed.
      const action = params.get('action');
      const editType = (params.get('edit') || '').toLowerCase();
      if (action === 'list') {
        openListingForm(log, openId);
      } else if (/^[a-z_]{2,40}$/.test(editType)) {
        const editTitle = params.get('editTitle') || editType.replace(/_/g, ' ');
        if (promptEl) {
          promptEl.value = 'Please revise the “' + editTitle + '” — here’s what I’d like changed: ';
          promptEl.focus();
        }
        announce('Editing the ' + editTitle + '. Tell Clay what to change, then send.', true);
      }
      return;
    }
    // YOUR CONVERSATION BACK, BEFORE ANY GREETING.
    //
    // Every message has been stored in clay_messages since that table shipped and nothing ever read
    // it. There was a route to DELETE your history and none to see it, so somebody who spent twenty
    // minutes with Clay, reloaded, and came back to the greeting had lost the lot — while the whole
    // conversation sat in the database.
    //
    // Restored first, so a returning person sees where they were rather than being welcomed as if
    // nothing had happened. Greeting a person who was mid-conversation is its own small dishonesty.
    let restored = 0;
    try {
      const h = await Kiln.api('/clay/history?limit=40&surface=laboratory');
      (h.messages || []).forEach(function (msg) {
        const who = msg.role === 'user' ? 'you' : 'clay';
        const node = message(who, who === 'you' ? 'You' : 'Clay');
        node.appendChild(sayLine(msg.content));
        log.appendChild(node);
        // AND GIVE IT BACK TO CLAY, not only to the person reading.
        //
        // My first version restored the DOM and left chatHistory empty, which is the array actually
        // sent with the next message. Found on production: the page showed six messages and Clay
        // answered "I don't have the earlier thread in front of me here, so I don't know what 'keep
        // going' is attached to."
        //
        // He was being honest, which is the only reason it was survivable — but the restore was
        // cosmetic. The person could read their conversation and the only participant who needed it
        // could not. A worse-behaved assistant would have guessed.
        chatHistory.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
        restored += 1;
      });
    } catch (_) {
      // A failed read is not an empty history, so nothing is claimed either way — the greeting
      // simply happens as it would for anybody.
    }
    if (restored) {
      // Say it, once, so a screen-reader user knows the page is not starting fresh.
      announce('Picking up where you left off. ' + restored + ' earlier messages restored.', false);
      return;
    }

    // Figure out whether this is a returning builder BEFORE greeting them. Their own projects
    // are the truth — someone with work in progress must never be greeted like a first-timer,
    // even if they never filled in interests.
    let myConcepts = [];
    try { const r = await Kiln.api('/concepts'); myConcepts = (r && r.concepts) || []; } catch (_) {}
    let prefs = null;
    try { const r = await Kiln.api('/preferences'); prefs = r.preferences; } catch (_) {}
    const m = message('clay', 'Clay');
    let opening;
    if (myConcepts.length) {
      opening = (firstName ? ('Welcome back, ' + firstName + '. ') : 'Welcome back. ')
        + 'Your Laboratory is right where you left it — ' + myConcepts.length + ' project'
        + (myConcepts.length === 1 ? '' : 's') + ' waiting for you below. Open any one to pick up building, or start something new with “Create.”';
    } else if (prefs && prefs.interests && prefs.interests.length) {
      const words = prefs.interests.map((i) => CATEGORY_WORDS[i] || i.replace(/_/g, ' '));
      const list = words.length === 1 ? words[0] : (words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1]);
      // The Create / Enhance buttons were removed days ago — Clay reads which one you mean from what
      // you write. Telling somebody to press buttons that no longer exist is worse than saying
      // nothing: they hunt for them, do not find them, and conclude the page is broken.
      opening = 'Welcome back. You told me you’re drawn to ' + list + ' — so what’s it going to be: shape one of those, or chase something brand new? Just tell me which; I’ll work out the rest.';
    } else {
      opening = "I'm Clay. Here's how this works: you bring me an idea — any idea, half-formed is fine — and we pressure-test it, sharpen it, and build the whole thing out together: the plan, the research, the marketing, a working demo. It stays your idea; I just help bring it to life — and it stays private: everything you build lives in your Laboratory, and nothing goes on the Exchange unless you choose to list it. Whether it's brand new or something you already run, just describe it in your own words — I'll work out which it is. So — what's the one that's been living in your head?";
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
    // Hannah's feedback: finished projects read better BELOW the chat window, not stacked
    // inside Clay's opening message. Render them into the dedicated area beneath the composer;
    // fall back to the message only if that container somehow isn't present.
    await renderMyConcepts(document.getElementById('my-projects-area') || m, myConcepts);
    // TUNING IS NO LONGER AN INTERRUPTION ON ARRIVAL. It used to open a second Clay message with a
    // paragraph and two buttons — a decision standing between somebody and the message box, before
    // they had said a word. Opt-in was never the problem; being asked first was. It is now one quiet
    // line inside the welcome that costs nothing to ignore, and the full thing opens on request.
    if (prefs && !prefs.onboarded && !(promptEl && promptEl.value)) {
      const offer = el('p', 'muted');
      offer.appendChild(document.createTextNode('Whenever you like, I can tune the Exchange to what you lean toward. '));
      const a = el('button', 'linkish', 'Tune it to me');
      a.type = 'button';
      a.addEventListener('click', function () { offer.remove(); maybeOfferTuning(); });
      offer.appendChild(a);
      m.appendChild(offer);
    }

    // Gentle, mutable reminder about projects built but not yet kept. Honest and
    // easy to silence — never shown to subscribers or staff (their count is 0).
    try {
      const u = await Kiln.api('/concepts/unkept-summary');
      if (u && u.count > 0 && !u.muted) {
        const r = message('clay', 'Clay');
        const names = (u.sample || []).map((s) => s.title).filter(Boolean);
        const lead = u.count === 1
          ? 'One gentle nudge: you’ve built a project you haven’t kept yet'
          : ('One gentle nudge: you’ve built ' + u.count + ' projects you haven’t kept yet');
        r.appendChild(el('p', null, lead + (names.length ? (' — ' + names.join(', ')) : '') + '. Your first project is free to download and keep; the plan covers the rest at $19 a month. No rush — and you can quiet these whenever you like.'));
        const acts = el('div', 'actions');
        const see = el('a', 'btn secondary', 'See my projects'); see.href = '/dashboard.html'; acts.appendChild(see);
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

  // ---- mode, inferred rather than asked ----
  //
  // There used to be a Create / Enhance pair of buttons here. Clay already works out which one you
  // mean from what you write, and he confirms before building anything either way — so picking one
  // first was a step that decided nothing and made the person do his reading for him.
  //
  // What actually determines it: refining a project already open in the workspace is an enhance;
  // saying you run the business already is an enhance; anything else is a create. All three are
  // things we can see without asking.
  function currentMode() {
    if (currentConceptId) return 'enhance';
    const op = document.getElementById('operating');
    if (op && op.checked) return 'enhance';
    return 'create';
  }

  // Let the person see and change the project's NAME — there was no way to rename a built
  // concept before. Uses the existing PATCH /concepts/:id endpoint.
  function renderConceptName(container, project) {
    const wrap = el('div', 'project-name'); wrap.style.cssText = 'margin:8px 0;';
    const row = el('p'); row.appendChild(el('strong', null, 'Project name: '));
    const nameSpan = el('span', null, project.title || 'Untitled project'); row.appendChild(nameSpan);
    wrap.appendChild(row);
    const editBtn = el('button', 'btn secondary', 'Rename this project'); editBtn.type = 'button';
    wrap.appendChild(editBtn);
    const form = el('div'); form.hidden = true; form.style.marginTop = '8px';
    const inp = el('input'); inp.type = 'text'; inp.maxLength = 120; inp.value = project.title || '';
    inp.setAttribute('aria-label', 'New project name'); inp.style.cssText = 'width:100%;min-height:44px;margin-bottom:8px;';
    const save = el('button', 'btn', 'Save name'); save.type = 'button';
    const out = el('p', 'muted'); out.setAttribute('role', 'status');
    save.addEventListener('click', async function () {
      const v = (inp.value || '').trim();
      if (!v) { out.textContent = 'A name is required.'; announce('A name is required.', true); inp.focus(); return; }
      save.disabled = true; out.textContent = 'Saving…';
      try {
        const r = await Kiln.api('/concepts/' + concept.id, { method: 'PATCH', body: { title: v } });
        project.title = (r.project && r.project.title) || v;
        nameSpan.textContent = project.title;
        out.textContent = 'Name saved.'; announce('Project renamed to ' + project.title + '.', true);
        form.hidden = true; editBtn.focus();
      } catch (e) { out.textContent = (e && e.message) ? e.message : 'Could not rename. Please try again.'; announce('Could not rename the project.', true); }
      save.disabled = false;
    });
    form.appendChild(inp); form.appendChild(save); form.appendChild(out);
    editBtn.addEventListener('click', function () { form.hidden = !form.hidden; if (!form.hidden) inp.focus(); });
    wrap.appendChild(form);
    container.appendChild(wrap);
  }

  // Show (and let the person edit/publish) this project's landing page — a real clickable link
  // when it's live, and a simple form when they want to create or change it. This is the "where's
  // my landing page and how do I edit it" surface.
  function renderLaunchPage(container, project) {
    const lp = project.launch_page || {};
    const liveUrl = lp.slug ? (location.origin + '/p/' + lp.slug) : '';
    const wrap = el('div', 'launch-panel');
    wrap.style.cssText = 'border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0;background:#fff;';
    wrap.appendChild(el('h3', null, 'Your landing page'));
    if (lp.enabled && liveUrl) {
      wrap.appendChild(el('p', 'muted', 'Live and collecting sign-ups. Share this link:'));
      wrap.appendChild(sayLine(liveUrl));
    } else if (liveUrl) {
      wrap.appendChild(el('p', 'muted', 'Saved as a draft — not public yet. It will publish at ' + liveUrl));
    } else {
      wrap.appendChild(el('p', 'muted', 'No landing page yet. A coming-soon page lets you collect interested people before you build — real proof of demand. Set one up here, or just ask Clay to make you one.'));
    }
    const editBtn = el('button', 'btn secondary', liveUrl ? 'Edit landing page' : 'Set up a landing page'); editBtn.type = 'button';
    wrap.appendChild(editBtn);
    const form = el('div', 'launch-form'); form.hidden = true; form.style.marginTop = '12px';
    function field(labelText, id, val, isArea) {
      const l = el('label', null, labelText); l.setAttribute('for', id);
      const inp = isArea ? el('textarea') : el('input'); inp.id = id; if (!isArea) inp.type = 'text';
      if (val) inp.value = val;
      inp.style.cssText = 'width:100%;min-height:' + (isArea ? '80px' : '44px') + ';margin:4px 0 10px;';
      form.appendChild(l); form.appendChild(inp); return inp;
    }
    const hIn = field('Headline (required)', 'lp-headline', lp.headline || project.title || '');
    const sIn = field('Subheadline', 'lp-subhead', lp.subhead || '');
    const bIn = field('Short blurb', 'lp-blurb', lp.blurb || '', true);
    const cIn = field('Button label', 'lp-cta', lp.cta_label || 'Get early access');
    const themeL = el('label', null, 'Theme (the look and colors)'); themeL.setAttribute('for', 'lp-theme');
    const themeSel = el('select'); themeSel.id = 'lp-theme'; themeSel.style.cssText = 'width:100%;min-height:44px;margin:4px 0 10px;';
    ['warm', 'ink', 'clean', 'bold', 'forest', 'dusk'].forEach(function (t) {
      const o = el('option', null, t.charAt(0).toUpperCase() + t.slice(1)); o.value = t;
      if ((lp.theme || 'warm') === t) o.selected = true; themeSel.appendChild(o);
    });
    form.appendChild(themeL); form.appendChild(themeSel);
    const heroIn = field('Hero image URL (optional — a large image across the top)', 'lp-hero', lp.hero_image || '');
    const pubL = el('label'); pubL.style.cssText = 'display:flex;gap:10px;align-items:center;margin:6px 0 12px;';
    const pub = el('input'); pub.type = 'checkbox'; pub.id = 'lp-publish'; pub.checked = !!lp.enabled; pub.style.cssText = 'min-width:22px;min-height:22px;';
    pubL.appendChild(pub); pubL.appendChild(document.createTextNode('Make it live (publish so people can visit and sign up)'));
    form.appendChild(pubL);
    const save = el('button', 'btn', 'Save landing page'); save.type = 'button';
    const out = el('p', 'muted'); out.setAttribute('role', 'status');
    save.addEventListener('click', async function () {
      if (!hIn.value.trim()) { out.textContent = 'A headline is required.'; announce('A headline is required.', true); hIn.focus(); return; }
      save.disabled = true; out.textContent = 'Saving…';
      try {
        const r = await Kiln.api('/concepts/' + concept.id + '/launch-page', { method: 'PUT', body: { headline: hIn.value, subhead: sIn.value, blurb: bIn.value, cta_label: cIn.value, theme: themeSel.value, hero_image: heroIn.value, publish: pub.checked } });
        project.launch_page = r.launch_page || project.launch_page;
        out.textContent = '';
        out.appendChild(document.createTextNode(pub.checked ? 'Your landing page is live: ' : 'Saved as a draft. '));
        if (r.url) { const a = el('a', null, r.url); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; out.appendChild(a); }
        announce(pub.checked ? 'Your landing page is live.' : 'Landing page saved as a draft.', true);
      } catch (e) { out.textContent = (e && e.message) ? e.message : 'Could not save the landing page. Please try again.'; announce('Could not save the landing page.', true); }
      save.disabled = false;
    });
    form.appendChild(save); form.appendChild(out);
    editBtn.addEventListener('click', function () { form.hidden = !form.hidden; if (!form.hidden) hIn.focus(); });
    wrap.appendChild(form);
    // See who has signed up — the real proof this page is collecting (owner-scoped waitlist).
    const seeBtn = el('button', 'btn secondary', 'See who’s signed up'); seeBtn.type = 'button'; seeBtn.style.marginLeft = '8px';
    const signupsOut = el('div', 'signups-out'); signupsOut.setAttribute('role', 'status'); signupsOut.style.marginTop = '10px';
    seeBtn.addEventListener('click', async function () {
      seeBtn.disabled = true; signupsOut.textContent = 'Loading…';
      try {
        const r = await Kiln.api('/waitlist/' + project.id);
        const list = (r && r.signups) || [];
        const n = (r && typeof r.count === 'number') ? r.count : list.length;
        signupsOut.textContent = '';
        signupsOut.appendChild(el('p', 'muted', n === 0 ? 'No sign-ups yet. Share your link and they’ll show up here.' : n + ' sign-up' + (n === 1 ? '' : 's') + ' so far:'));
        list.forEach(function (s) {
          const when = s.created_at ? new Date(s.created_at).toLocaleDateString() : '';
          signupsOut.appendChild(el('p', null, s.email + (s.name ? ' (' + s.name + ')' : '') + (when ? ' — ' + when : '')));
        });
        announce(n + ' sign-up' + (n === 1 ? '' : 's') + ' on your landing page.', true);
      } catch (e) { signupsOut.textContent = (e && e.message) ? e.message : 'Could not load sign-ups.'; announce('Could not load sign-ups.', true); }
      seeBtn.disabled = false;
    });
    wrap.appendChild(seeBtn);
    wrap.appendChild(signupsOut);
    renderDomains(wrap, project);
    renderSitePages(wrap, project);
    container.appendChild(wrap);
  }

  // The site manager: see, add, and edit the pages that make this project a real site — not
  // just a landing page. Mirrors what Clay can do, so the person has direct control too.
  function renderSitePages(container, project) {
    const siteSlug = (project.launch_page && project.launch_page.slug) || null;
    const homeLive = !!(project.launch_page && project.launch_page.enabled);
    const sec = el('div', 'site-pages'); sec.style.cssText = 'margin-top:16px;border-top:1px solid var(--line);padding-top:12px;';
    sec.appendChild(el('h4', null, 'Site pages'));
    sec.appendChild(el('p', 'muted', 'Turn this into a real resource site or blog: add pages with genuine content. Each goes live under your landing page once it and the home page are published. Ask Clay to write and add pages, or add one yourself.'));
    const list = el('div', 'pages-list'); list.setAttribute('role', 'status'); sec.appendChild(list);
    const addBtn = el('button', 'btn secondary', 'Add a page'); addBtn.type = 'button'; sec.appendChild(addBtn);
    const dlBtn = el('button', 'btn secondary', 'Download your site'); dlBtn.type = 'button'; dlBtn.style.marginLeft = '8px'; sec.appendChild(dlBtn);
    dlBtn.addEventListener('click', async function () {
      dlBtn.disabled = true;
      try {
        const r = await Kiln.api('/concepts/' + concept.id + '/site/export');
        const blob = new Blob([r.html], { type: 'text/html' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = r.filename || 'my-site.html';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
        announce('Your site downloaded as one HTML file you can host anywhere. It’s yours.', true);
      } catch (e) { announce('Could not export the site right now.', true); }
      dlBtn.disabled = false;
    });

    // Shared editor
    const ed = el('div'); ed.hidden = true; ed.style.marginTop = '12px';
    const tL = el('label', null, 'Page title'); tL.setAttribute('for', 'sp-title');
    const tIn = el('input'); tIn.id = 'sp-title'; tIn.type = 'text'; tIn.maxLength = 120; tIn.style.cssText = 'width:100%;min-height:44px;margin:4px 0 10px;';
    const bL = el('label', null, 'Page content — plain text; # heading, ## subheading, - bullet, [text](https://link) all work'); bL.setAttribute('for', 'sp-body');
    const bIn = el('textarea'); bIn.id = 'sp-body'; bIn.style.cssText = 'width:100%;min-height:200px;margin:4px 0 10px;';
    const pL = el('label'); pL.style.cssText = 'display:flex;gap:10px;align-items:center;margin:6px 0 12px;';
    const pIn = el('input'); pIn.type = 'checkbox'; pIn.style.cssText = 'min-width:22px;min-height:22px;';
    pL.appendChild(pIn); pL.appendChild(document.createTextNode('Published (visible on your site)'));
    const saveB = el('button', 'btn', 'Save page'); saveB.type = 'button';
    const cancelB = el('button', 'btn secondary', 'Cancel'); cancelB.type = 'button'; cancelB.style.marginLeft = '8px';
    const eOut = el('p', 'muted'); eOut.setAttribute('role', 'status');
    ed.appendChild(tL); ed.appendChild(tIn); ed.appendChild(bL); ed.appendChild(bIn); ed.appendChild(pL);
    ed.appendChild(saveB); ed.appendChild(cancelB); ed.appendChild(eOut);
    sec.appendChild(ed);
    let editingId = null;

    function openEditor(page) {
      editingId = page ? page.id : null;
      tIn.value = page ? (page.title || '') : '';
      pIn.checked = page ? !!page.published : false;
      bIn.value = ''; eOut.textContent = '';
      ed.hidden = false; tIn.focus();
      if (page) {
        bIn.placeholder = 'Loading…';
        Kiln.api('/concepts/' + concept.id + '/pages/' + page.id).then(function (r) {
          if (r && r.page) bIn.value = r.page.body || '';
        }).catch(function () { eOut.textContent = 'Could not load the page content.'; });
      }
    }
    cancelB.addEventListener('click', function () { ed.hidden = true; addBtn.focus(); });
    saveB.addEventListener('click', async function () {
      const title = (tIn.value || '').trim();
      if (!title) { eOut.textContent = 'A page title is required.'; announce('A page title is required.', true); tIn.focus(); return; }
      saveB.disabled = true; eOut.textContent = 'Saving…';
      const bodyPayload = { title: title, body: bIn.value, publish: pIn.checked };
      try {
        let r;
        if (editingId) r = await Kiln.api('/concepts/' + concept.id + '/pages/' + editingId, { method: 'PUT', body: bodyPayload });
        else r = await Kiln.api('/concepts/' + concept.id + '/pages', { method: 'POST', body: bodyPayload });
        eOut.textContent = 'Page saved.'; announce('Page saved.', true);
        ed.hidden = true; await refresh(); addBtn.focus();
      } catch (e) { eOut.textContent = (e && e.message) ? e.message : 'Could not save the page. Please try again.'; announce('Could not save the page.', true); }
      saveB.disabled = false;
    });
    addBtn.addEventListener('click', function () { openEditor(null); });

    async function refresh() {
      list.textContent = 'Loading pages…';
      try {
        const r = await Kiln.api('/concepts/' + concept.id + '/pages');
        const pages = (r && r.pages) || [];
        list.textContent = '';
        if (!pages.length) { list.appendChild(el('p', 'muted', 'No pages yet.')); return; }
        pages.forEach(function (pg) {
          const row = el('div', 'page-row'); row.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--line);';
          const t = el('p'); t.appendChild(el('strong', null, pg.title));
          t.appendChild(document.createTextNode(' — ' + (pg.published ? 'published' : 'draft')));
          row.appendChild(t);
          if (pg.published && siteSlug && homeLive) {
            const a = el('a', null, 'View'); a.href = location.origin + '/p/' + siteSlug + '/' + pg.slug; a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a);
          }
          const edB = el('button', 'btn secondary', 'Edit'); edB.type = 'button'; edB.style.marginLeft = '8px';
          edB.addEventListener('click', function () { openEditor(pg); });
          row.appendChild(edB);
          list.appendChild(row);
        });
      } catch (e) { list.textContent = (e && e.message) ? e.message : 'Could not load pages.'; }
    }
    refresh();
    container.appendChild(sec);
  }

  // Web address manager: an instant free address on our platform, or connect your own domain.
  function renderDomains(container, project) {
    let rootSuffix = 'accessyplabs.com', cnameTarget = '';
    let addressesLive = false, published = false, shareUrl = '';
    const sec = el('div', 'site-domains'); sec.style.cssText = 'margin-top:16px;border-top:1px solid var(--line);padding-top:12px;';
    sec.appendChild(el('h4', null, 'Web address'));
    sec.appendChild(el('p', 'muted', 'Give your site a real address. Reserve a short free address on our platform, or connect your own domain. A reserved address goes live once web addresses are switched on; your site is always shareable at its /p/ link once the home page is published.'));
    const list = el('div'); list.setAttribute('role', 'status'); sec.appendChild(list);

    const subL = el('label', null, 'Free address on our platform'); subL.setAttribute('for', 'dom-sub');
    const subRow = el('div'); subRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0;';
    const subIn = el('input'); subIn.id = 'dom-sub'; subIn.type = 'text'; subIn.placeholder = 'your-name'; subIn.style.cssText = 'flex:1;min-width:160px;min-height:44px;';
    const subSuffix = el('span', 'muted', '.' + rootSuffix);
    const subBtn = el('button', 'btn', 'Claim it'); subBtn.type = 'button';
    subRow.appendChild(subIn); subRow.appendChild(subSuffix); subRow.appendChild(subBtn);
    const subOut = el('p', 'muted'); subOut.setAttribute('role', 'status');
    sec.appendChild(subL); sec.appendChild(subRow); sec.appendChild(subOut);

    const cusL = el('label', null, 'Connect your own domain'); cusL.setAttribute('for', 'dom-cus'); cusL.style.marginTop = '10px';
    const cusRow = el('div'); cusRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0;';
    const cusIn = el('input'); cusIn.id = 'dom-cus'; cusIn.type = 'text'; cusIn.placeholder = 'yourbusiness.com'; cusIn.style.cssText = 'flex:1;min-width:200px;min-height:44px;';
    const cusBtn = el('button', 'btn secondary', 'Connect'); cusBtn.type = 'button';
    cusRow.appendChild(cusIn); cusRow.appendChild(cusBtn);
    const cusOut = el('div'); cusOut.setAttribute('role', 'status');
    sec.appendChild(cusL); sec.appendChild(cusRow); sec.appendChild(cusOut);

    async function refresh() {
      list.textContent = 'Loading…';
      try {
        const r = await Kiln.api('/concepts/' + concept.id + '/domains');
        rootSuffix = r.sites_root || rootSuffix; cnameTarget = r.cname_target || '';
        addressesLive = !!r.addresses_live; published = !!r.published; shareUrl = r.share_url || '';
        subSuffix.textContent = '.' + rootSuffix;
        list.textContent = '';
        const ds = r.domains || [];
        if (!ds.length) list.appendChild(el('p', 'muted', 'No web address yet.'));
        ds.forEach(function (d) {
          const row = el('div'); row.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--line);';
          const isCustom = d.kind === 'custom';
          const subLive = !isCustom && addressesLive && published;
          const state = isCustom ? (d.status === 'active' ? 'live' : 'pending') : (subLive ? 'live' : 'reserved — goes live once web addresses are switched on');
          const t = el('p'); t.appendChild(el('strong', null, d.hostname));
          t.appendChild(document.createTextNode(' — ' + state));
          row.appendChild(t);
          const showOpen = isCustom ? d.status === 'active' : subLive;
          if (showOpen) { const a = el('a', null, 'Open'); a.href = 'https://' + d.hostname; a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a); }
          if (!isCustom && !subLive && shareUrl) { const sa = el('a', null, 'Share now'); sa.href = shareUrl; sa.target = '_blank'; sa.rel = 'noopener'; sa.style.marginLeft = '8px'; row.appendChild(sa); }
          if (d.kind === 'custom' && d.status !== 'active') {
            const ck = el('button', 'btn secondary', 'Check status'); ck.type = 'button'; ck.style.marginLeft = '8px';
            ck.addEventListener('click', async function () { ck.disabled = true; try { const s = await Kiln.api('/concepts/' + concept.id + '/domains/' + d.id + '/recheck'); announce('Domain status: ' + s.status, true); await refresh(); } catch (e) { announce('Could not check the domain.', true); } ck.disabled = false; });
            row.appendChild(ck);
            if (d.verification && d.verification.cname) row.appendChild(el('p', 'muted', 'DNS record — CNAME  ' + d.verification.cname.name + '  →  ' + d.verification.cname.target));
          }
          const rm = el('button', 'btn secondary', 'Remove'); rm.type = 'button'; rm.style.marginLeft = '8px';
          rm.addEventListener('click', async function () { rm.disabled = true; try { await Kiln.api('/concepts/' + concept.id + '/domains/' + d.id, { method: 'DELETE' }); announce('Address removed.', true); await refresh(); } catch (e) { announce('Could not remove it.', true); } rm.disabled = false; });
          row.appendChild(rm);
          list.appendChild(row);
        });
      } catch (e) { list.textContent = 'Could not load web addresses.'; }
    }
    subBtn.addEventListener('click', async function () {
      const label = (subIn.value || '').trim();
      if (!label) { subOut.textContent = 'Type an address first.'; return; }
      subBtn.disabled = true; subOut.textContent = 'Claiming…';
      try { const r = await Kiln.api('/concepts/' + concept.id + '/domains/subdomain', { method: 'POST', body: { label: label } }); subOut.textContent = r.message || ('Reserved ' + (r.url || '')); announce(subOut.textContent, true); subIn.value = ''; await refresh(); }
      catch (e) { subOut.textContent = (e && e.message) || 'Could not claim that address.'; announce(subOut.textContent, true); }
      subBtn.disabled = false;
    });
    cusBtn.addEventListener('click', async function () {
      const h = (cusIn.value || '').trim();
      if (!h) { cusOut.textContent = 'Type your domain first.'; return; }
      cusBtn.disabled = true; cusOut.textContent = 'Connecting…';
      try {
        const r = await Kiln.api('/concepts/' + concept.id + '/domains/custom', { method: 'POST', body: { hostname: h } });
        cusOut.textContent = '';
        cusOut.appendChild(el('p', 'muted', r.message || 'Add the DNS record below.'));
        if (r.verification && r.verification.cname) cusOut.appendChild(el('p', null, 'CNAME  ' + r.verification.cname.name + '  →  ' + r.verification.cname.target));
        announce('Domain connection started. Add the DNS record shown.', true);
        cusIn.value = ''; await refresh();
      } catch (e) { cusOut.textContent = (e && e.message) || 'Could not connect that domain right now.'; announce(cusOut.textContent, true); }
      cusBtn.disabled = false;
    });
    refresh();
    container.appendChild(sec);
  }

  // ---- open an existing project to keep refining it ----
  async function loadConceptIntoWorkspace(id) {
    try {
      // THE SAME RENAME BUG AS renderMyConcepts, one function away. The API returns { concept },
      // this destructured it as `concept`, and then every line below reads `project` — so the very
      // next statement threw on an undefined variable and the project never opened. Clicking
      // "Continue" on your own work did nothing at all, silently: no navigation, no error on
      // screen, no materials. The projects panel I just restored led straight into this.
      const res = await Kiln.api('/concepts/' + id);
      const project = res.concept || res.project;
      const assets = res.assets;
      const entitled = res.entitled;
      if (!project) throw new Error('That project could not be loaded.');
      currentConceptId = project.id;
      chatHistory = [];
      setEditingConcept(true); // refining an existing project — hide the create/enhance toggles
      const m = message('clay', 'Clay');
      m.appendChild(el('p', null, 'Picking up where we left off on “' + (project.title || 'your project') + '.” Everything you built is still here — tell me what to change or add and I’ll refine this same project. You can start a fresh one anytime.'));
      renderConceptName(m, project);
      renderClaysTake(m, project);
      const current = (assets || []).filter((a) => a.is_current !== false);
      if (current.length) {
        vaultHandoff(m, project.id, current, { demo: current.some((a) => a.type === 'html_demo' || a.type === 'built_site') });
        const acts = el('div', 'actions');
        const fresh = el('button', 'btn secondary', 'Start a fresh project instead'); fresh.type = 'button';
        fresh.addEventListener('click', startFreshConcept);
        acts.appendChild(fresh);
        m.appendChild(acts);
        const isEntitled = entitled !== false;
        const lockedNames = current.filter((a) => !(isEntitled || PREVIEW_TYPES.includes(a.type))).map((a) => a.title || a.label || a.type);
        lockedNotice(m, project.id, lockedNames);
      }
      renderLaunchPage(m, project);
      announce('Continuing your project: ' + (project.title || 'your project') + '. Add a message to refine it.', true);
      if (promptEl) promptEl.focus();
    } catch (e) {
      if (e.sessionExpired) { goSignIn(); return; }
      const m = message('clay', 'Clay');
      const msg = (e.status === 410 || e.status === 404)
        ? (e.message || 'That project isn’t available anymore. You can start a fresh one below.')
        : 'I couldn’t open that project — it may have been removed. You can start a new one below.';
      m.appendChild(el('p', 'msg err', msg));
      announce(msg, true);
    }
  }

  function startFreshConcept() {
    currentConceptId = null;
    chatHistory = [];
    setEditingConcept(false);
    const m = message('clay', 'Clay');
    m.appendChild(el('p', null, 'Fresh start — this next idea will be its own project. What are we building?'));
    announce('Starting a new project.', true);
    if (promptEl) { promptEl.value = ''; promptEl.focus(); }
  }

  // ---- Exchange tuning, in the lab now (opt-in, never a gate) ----
  // The old Exchange "door" made everyone answer these before they could go in. It lives here
  // instead: Clay offers to tune the Exchange, the person takes it or leaves it, and it saves to
  // the same preferences the Exchange reads for "projects worth a look for you."
  function maybeOfferTuning() {
    const m = message('clay', 'Clay');
    m.appendChild(el('p', null, 'Whenever you want it, I can tune the Exchange to you — the kinds of ideas you lean toward, whether you already run something, and a rough launch budget — so the right projects lean back when you drop in. Want to set that now?'));
    const row = el('p'); row.style.display = 'flex'; row.style.gap = '10px'; row.style.flexWrap = 'wrap';
    const yes = el('button', 'btn', 'Tune my Exchange'); yes.type = 'button';
    const no = el('button', 'btn secondary', 'Maybe later'); no.type = 'button';
    yes.addEventListener('click', function () { row.remove(); renderTuning(m); });
    no.addEventListener('click', function () { row.remove(); m.appendChild(el('p', 'muted', 'No rush — I’ll keep the whole Exchange open to you, and you can ask me to tune it anytime.')); announce('Okay, maybe later.'); });
    row.appendChild(yes); row.appendChild(no); m.appendChild(row);
    scrollToLatest(m);
  }

  async function renderTuning(m) {
    let opts = { categories: [], budgets: [] };
    try { opts = await Kiln.api('/preferences/options'); } catch (_) {}
    const state = { interests: [], runs_business: false, business_kind: '', launch_budget: '' };
    const form = el('div'); form.style.marginTop = '6px';

    const fs = el('fieldset'); fs.appendChild(el('legend', null, 'Ideas you’re most excited to launch — pick any'));
    const chips = el('div'); chips.style.display = 'flex'; chips.style.gap = '8px'; chips.style.flexWrap = 'wrap';
    (opts.categories || []).forEach(function (cat) {
      const b = el('button', 'btn secondary', cat.label); b.type = 'button'; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        const on = b.getAttribute('aria-pressed') === 'true'; b.setAttribute('aria-pressed', String(!on));
        if (on) { state.interests = state.interests.filter(function (x) { return x !== cat.id; }); }
        else { state.interests.push(cat.id); }
        announce((on ? 'Removed ' : 'Added ') + cat.label);
      });
      chips.appendChild(b);
    });
    fs.appendChild(chips); form.appendChild(fs);

    const opFs = el('fieldset'); opFs.appendChild(el('legend', null, 'Do you already run a business?'));
    const opWrap = el('div'); opWrap.style.display = 'flex'; opWrap.style.gap = '10px'; opWrap.style.flexWrap = 'wrap';
    const kindWrap = el('div'); kindWrap.style.marginTop = '8px'; kindWrap.hidden = true;
    const kindLabel = el('label', null, 'What kind? A few words is plenty.'); kindLabel.setAttribute('for', 'tune-kind');
    const kindIn = document.createElement('input'); kindIn.id = 'tune-kind'; kindIn.type = 'text';
    kindWrap.appendChild(kindLabel); kindWrap.appendChild(kindIn);
    const yesB = el('button', 'btn secondary', 'Yes, I run one'); yesB.type = 'button'; yesB.setAttribute('aria-pressed', 'false');
    const noB = el('button', 'btn secondary', 'Not yet'); noB.type = 'button'; noB.setAttribute('aria-pressed', 'true');
    function setRuns(v) { state.runs_business = v; yesB.setAttribute('aria-pressed', String(v)); noB.setAttribute('aria-pressed', String(!v)); kindWrap.hidden = !v; if (!v) { state.business_kind = ''; kindIn.value = ''; } }
    yesB.addEventListener('click', function () { setRuns(true); kindIn.focus(); });
    noB.addEventListener('click', function () { setRuns(false); });
    opWrap.appendChild(yesB); opWrap.appendChild(noB); opFs.appendChild(opWrap); opFs.appendChild(kindWrap); form.appendChild(opFs);

    const bFs = el('fieldset'); bFs.appendChild(el('legend', null, 'A rough launch budget'));
    const bLabel = el('label', null, 'When a dream’s ready to launch, what could you put behind it?'); bLabel.setAttribute('for', 'tune-budget');
    const bSel = document.createElement('select'); bSel.id = 'tune-budget';
    bSel.appendChild(new Option('No preference', ''));
    (opts.budgets || []).forEach(function (b) { bSel.appendChild(new Option(b.label, b.id)); });
    bFs.appendChild(bLabel); bFs.appendChild(bSel); form.appendChild(bFs);

    const save = el('button', 'btn', 'Save my tuning'); save.type = 'button'; save.style.marginTop = '10px';
    save.addEventListener('click', async function () {
      state.business_kind = kindIn.value.trim(); state.launch_budget = bSel.value;
      save.disabled = true; announce('Saving your tuning…');
      try {
        await Kiln.api('/preferences', { method: 'PUT', body: { interests: state.interests, runs_business: state.runs_business, business_kind: state.business_kind, launch_budget: state.launch_budget, onboarded: true } });
        form.remove();
        m.appendChild(el('p', 'msg ok', 'Your Exchange’s tuned — the right projects will lean toward you when you drop in. You can retune anytime.'));
        announce('Your Exchange is tuned.', true);
      } catch (e) { save.disabled = false; announce((e && e.message) || 'Could not save your tuning just now.', true); }
    });
    form.appendChild(save);
    m.appendChild(form); scrollToLatest(m);
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
      // TALK FIRST. Every plain text message goes to Clay as a CONVERSATION — whether or not a
      // project is open. Clay decides what the message actually needs: answering a question,
      // running a diagnostic, asking a clarifying question, or building. When he does decide to
      // build, he calls the build tool himself and the reply carries a build id we watch below,
      // so nothing is lost. Previously a message with no project open was sent straight to the
      // builder, which meant ANY first message — even "check systems" — started a full project
      // build with no chance to ask what the person actually wanted.
      // (File attachments still go through the builder, which knows how to fold them in.)
      if (!pendingUploadIds.length) {
        chatHistory.push({ role: 'user', content: prompt });
        const chatBody = { messages: chatHistory, concept_id: currentConceptId || undefined };

        // Watch Clay work rather than staring at a spinner. The streaming endpoint returns the
        // SAME result object as the plain one, so everything downstream is unchanged — which is
        // also why falling back is safe: if streaming is unavailable for any reason, the plain
        // request runs and the person gets the identical answer, just without the running commentary.
        const finish = (data) => {
          if (Array.isArray(data.messages)) chatHistory = data.messages;
          if (think.parentNode === thinking) thinking.removeChild(think);
          renderChatReply(thinking, data);
        };
        if (window.ClayStream) {
          await new Promise((resolve) => {
            ClayStream.streamChat(chatBody, document.getElementById('progress-host'), (data) => { finish(data); resolve(); },
              async () => {
                // Streaming failed. Do the plain request instead rather than making them retype:
                // a transport problem is ours, not theirs.
                try { finish(await Kiln.api('/clay/chat', { method: 'POST', body: chatBody })); }
                catch (e) {
                  // WHEN CLAY CANNOT ANSWER, SAY SO ON THE SCREEN.
                  //
                  // Walked live: the session expired mid-conversation, the stream 401'd, the plain
                  // request 401'd, the token refresh 401'd — and what the person got was an empty
                  // bubble with Clay's name on it and nothing in it. The failure was announced to a
                  // live region and drawn nowhere, so a sighted user saw Clay reply with silence and
                  // a screen-reader user heard one sentence float past with no way to act on it.
                  //
                  // An empty reply from an assistant is the worst possible failure here: it reads as
                  // "he has nothing to say to you" rather than "something broke on our side".
                  if (think.parentNode === thinking) thinking.removeChild(think);
                  const expired = /sign in again/i.test(e && e.message || '') || (e && e.status === 401);
                  const box = document.createElement('div');
                  box.className = 'msg err';
                  box.setAttribute('role', 'alert');
                  box.textContent = expired
                    ? 'Your session timed out, so that did not reach Clay. Nothing was lost — sign in again and the conversation is still here.'
                    : 'That did not reach Clay, so nothing was saved. It is a fault on our side, not something you did. Try sending it again.';
                  if (expired) {
                    const a = document.createElement('a');
                    a.href = '/login.html'; a.className = 'btn'; a.textContent = 'Sign in again';
                    a.style.marginLeft = '8px';
                    box.appendChild(document.createTextNode(' '));
                    box.appendChild(a);
                  }
                  thinking.appendChild(box);
                  try { box.setAttribute('tabindex', '-1'); box.scrollIntoView({ block: 'center' }); box.focus(); } catch (_) { }
                  announce(box.textContent, true);
                }
                resolve();
              });
          });
          return;
        }
        finish(await Kiln.api('/clay/chat', { method: 'POST', body: chatBody }));
        return;
      }

      const operatingEl = document.getElementById('operating');
      const operating = !!(operatingEl && operatingEl.checked);
      // confirmed: attaching files and pressing send IS the person's explicit go-ahead to build
      // from them. The server refuses any build that doesn't carry this, so nothing starts by surprise.
      const body = { mode: currentMode(), category, prompt, operating, confirmed: true, concept_id: currentConceptId || undefined };
      if (pendingUploadIds.length) body.upload_ids = pendingUploadIds.slice();
      const data = await Kiln.api('/clay/generate', { method: 'POST', body });
      // Files were handed to this build; clear them so they aren't attached again. (They're
      // linked to the project server-side, so future enhancements still see them.)
      pendingUploadIds = [];
      if (attachedEl) attachedEl.textContent = '';
      // From here on, keep refining the same project until they start fresh.
      if (data && data.status === 'answered' && data.project) { currentConceptId = data.project.id; setEditingConcept(true); }
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

  // ---- render a conversational reply from Clay (project-editing chat) ----
  function renderChatReply(container, data) {
    if (!data || data.status === 'unavailable') {
      container.appendChild(el('p', 'msg err', (data && data.reply) || 'Clay couldn’t run just now — and he never makes things up, so nothing was changed.'));
      announce('Clay could not run right now. Nothing was changed.', true);
      return;
    }
    // Pace the reply: render each server-provided bubble as its own paragraph so the
    // conversation log (an aria-live region) announces them one at a time, with a natural
    // pause between ideas, instead of dumping one wall of speech. Falls back to a single
    // reply for older responses.
    var bubbles = (Array.isArray(data.bubbles) && data.bubbles.length) ? data.bubbles : [data.reply || '(no reply)'];
    bubbles.forEach(function (b) { container.appendChild(sayLine(b)); });
    if (data.status === 'confirmation_required' && data.confirmation) {
      renderChatConfirm(container, data.confirmation);
      announce(bubbles[0] || 'Clay needs your confirmation to do that.', true);
      return;
    }
    // Clay kicked off a rebuild in the background — watch it live. The chat request itself
    // stayed fast; the 1–3 minute build runs on its own and streams progress here.
    if (data.build_id) {
      watchBuild(container, data.build_id);
      announce(bubbles[0] || 'Clay is rebuilding your materials — you can watch the progress below.', true);
      return;
    }
    // Clay actually revised the materials this turn — offer to review the new versions.
    if (data.concept_updated && data.concept_id) {
      currentConceptId = data.concept_id;
      const acts = el('div', 'actions');
      const rev = el('button', 'btn secondary', 'Review updated materials'); rev.type = 'button';
      rev.addEventListener('click', () => showConceptMaterials(container, data.concept_id));
      acts.appendChild(rev);
      container.appendChild(acts);
    }
    announce(bubbles[0] || 'Clay replied.');
  }

  function renderChatConfirm(container, c) {
    const acts = el('div', 'actions');
    const label = c.tool === 'purchase_concept' ? 'Yes, open the purchase'
      : c.tool === 'list_on_marketplace' ? 'Yes, open the listing flow'
      : c.tool === 'remove_concept' ? 'Yes, delete it'
      : c.tool === 'generate_concept' ? 'Yes, build it'
      : c.tool === 'enhance_concept' ? 'Yes, make that change' : 'Yes, do it';
    const yes = el('button', 'btn', label); yes.type = 'button';
    yes.addEventListener('click', () => confirmChatAction(container, c, yes));
    const no = el('button', 'btn secondary', 'No, not yet'); no.type = 'button';
    no.addEventListener('click', () => {
      const msg = c.tool === 'generate_concept'
        ? 'Okay — I won\u2019t build it. Nothing was made. Tell me what to change and we\u2019ll shape it first.'
        : 'Okay — holding off. Nothing was changed.';
      container.appendChild(el('p', null, msg));
      announce(msg, true);
      acts.remove();
    });
    acts.appendChild(yes); acts.appendChild(no);
    container.appendChild(acts);
    if (yes.focus) yes.focus();
  }

  async function confirmChatAction(container, c, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await Kiln.api('/clay/chat/confirm', { method: 'POST', body: { tool: c.tool, params: c.params } });
      if (r.status === 'handoff' && r.url) {
        container.appendChild(el('p', null, r.message || 'Opening the next step.'));
        announce(r.message || 'Opening the next step.', true);
        setTimeout(() => { location.href = r.url; }, 1200);
        return;
      }
      // A confirmed action may START a background build (generate_concept / enhance_concept):
      // surface it and watch it, exactly like a build begun any other way.
      const res = r.result || {};
      const buildId = r.build_id || res.build_id;
      const msg = r.message || res.message || 'Done.';
      container.appendChild(el('p', null, msg));
      announce(msg, true);
      if (buildId) watchBuild(container, buildId);
      if (c.tool === 'remove_concept') { currentConceptId = null; chatHistory = []; setEditingConcept(false); }
    } catch (e) {
      container.appendChild(el('p', 'msg err', 'That didn’t go through — nothing was changed.'));
      announce('That action did not go through. Nothing was changed.', true);
      if (btn) btn.disabled = false;
    }
  }

  // Re-fetch and show the project's CURRENT materials (new versions after an edit).
  async function showConceptMaterials(container, conceptId) {
    try {
      const { assets, entitled } = await Kiln.api('/concepts/' + conceptId);
      const current = (assets || []).filter((a) => a.is_current !== false);
      if (!current.length) { announce('No materials yet.', true); return; }
      vaultHandoff(container, conceptId, current, { demo: current.some((a) => a.type === 'html_demo' || a.type === 'built_site') });
      const isEntitled = entitled !== false;
      const locked = current.filter((a) => !(isEntitled || PREVIEW_TYPES.includes(a.type))).map((a) => a.title || a.type);
      if (locked.length) lockedNotice(container, conceptId, locked);
      announce('Your updated materials are ready in your vault.', true);
    } catch (e) {
      announce('Couldn’t load the materials just now.', true);
    }
  }

  // ---- attach files for Clay to use (code, images, graphics, documents) ----
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => { const s = String(r.result || ''); const i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : s); };
      r.onerror = () => reject(new Error('read failed'));
      r.readAsDataURL(file);
    });
  }
  function renderAttached(data) {
    if (!attachedEl) return;
    attachedEl.textContent = '';
    attachedEl.appendChild(el('p', null, (data && data.message) || 'Files attached.'));
    const lines = (data && data.summary) || [];
    if (lines.length) {
      const ul = el('ul');
      ul.style.margin = '4px 0 0'; ul.style.paddingLeft = '20px';
      lines.forEach((t) => ul.appendChild(el('li', 'muted', t)));
      attachedEl.appendChild(ul);
    }
  }
  if (attachEl) {
    attachEl.addEventListener('change', async () => {
      const files = Array.from(attachEl.files || []).slice(0, 10);
      if (!files.length) return;
      attachEl.disabled = true;
      if (attachedEl) attachedEl.textContent = 'Reading your files…';
      announce('Reading your files…');
      try {
        const payload = [];
        for (const f of files) {
          // Files over the limit are sent empty so the server reports them as "too large"
          // by name — the user hears exactly which file didn't make it and why.
          if (f.size > 6 * 1024 * 1024) { payload.push({ filename: f.name, mime_type: f.type || null, data: '' }); continue; }
          payload.push({ filename: f.name, mime_type: f.type || null, data: await readFileAsBase64(f) });
        }
        const body = { files: payload };
        if (currentConceptId) body.concept_id = currentConceptId;
        const data = await Kiln.api('/clay/uploads', { method: 'POST', body });
        (data.ids || []).forEach((id) => { if (id && pendingUploadIds.indexOf(id) < 0) pendingUploadIds.push(id); });
        renderAttached(data);
        announce((data && data.message) || 'Files attached.', true);
      } catch (e) {
        if (attachedEl) attachedEl.textContent = 'I couldn’t attach those files. Please try again.';
        announce('I couldn’t attach those files. Please try again.', true);
      } finally {
        attachEl.disabled = false;
        attachEl.value = ''; // allow re-selecting the same file
      }
    });
  }

  // Watch Clay build in real time: poll the build's progress notes and surface each new
  // one as Clay posts it, announced for VoiceOver. If the user steps away, the email
  // still covers them. When it finishes, the project opens right here.
  function watchBuild(container, buildId) {
    const log = el('div', 'build-log');
    log.setAttribute('aria-label', 'Clay’s build progress');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-relevant', 'additions');
    log.style.borderLeft = '3px solid #d6c3b6';
    log.style.paddingLeft = '10px';
    log.style.margin = '8px 0';
    // The flame: Clay's mark, working. The caption beside it is the live status, and the
    // finished materials will emerge below it — pulled out of the flame one at a time.
    const flameWrap = el('div', 'build-flame');
    const flame = clayMark(); flame.classList.add('thinking');
    const cap = el('span', 'bf-cap', 'Clay is shaping your project…');
    flameWrap.appendChild(flame); flameWrap.appendChild(cap);
    log.appendChild(flameWrap);
    container.appendChild(log);
    const setCap = function (t) { if (t) cap.textContent = t; };
    const settle = function () { flame.classList.remove('thinking'); };
    let shown = 0, tries = 0, lastBeat = 0, lastNoteAt = Date.now();
    const startedAt = Date.now();
    const maxTries = 140; // ~6 min at 2.5s, then hand off to the email
    const timer = setInterval(async () => {
      tries++;
      let data;
      try { data = await Kiln.api('/clay/build/' + buildId); }
      catch (e) { if (tries > 5) clearInterval(timer); return; }
      const notes = (data && data.notes) || [];
      if (notes.length > shown) {
        for (; shown < notes.length; shown++) {
          setCap(notes[shown].text);
          // Append each step as its OWN node in this live region so VoiceOver reads every
          // step in order. Overwriting one caption (the old way) gets coalesced by screen
          // readers, so only the last line — or none — was ever heard.
          log.appendChild(el('p', 'bf-step', notes[shown].text));
        }
        lastNoteAt = Date.now();
      }
      if (data.status === 'done') {
        clearInterval(timer); settle();
        setCap('Your project is taking shape — here’s what I pulled out:');
        if (data.concept_id) {
          currentConceptId = data.concept_id; setEditingConcept(true);
          await revealMaterials(log, data.concept_id); // real assets, emerging one at a time
          const open = el('a', 'btn', 'Open your project');
          open.href = '/app.html?concept=' + encodeURIComponent(data.concept_id);
          log.appendChild(open);
        }
        const msg = data.message || 'Your project is ready — open it above or in your Laboratory.';
        log.appendChild(el('p', 'msg ok', msg));
        announce(msg, true); // honest: says whether it emailed or not
      } else if (data.status === 'failed') {
        clearInterval(timer); settle();
        setCap('Clay stopped — nothing was fabricated.');
        log.appendChild(el('p', 'msg err', data.message || 'Clay couldn’t finish this build. Nothing was fabricated — please try again.'));
        announce(data.message || 'Clay could not finish this build. Nothing was fabricated. Please try again.', true);
      } else if (tries >= maxTries) {
        clearInterval(timer); settle();
        setCap('Still working — I’ll email it the moment it’s ready.');
        log.appendChild(el('p', 'muted', 'Still working — I’ll email it to you the moment it’s ready, and it’ll be in your Laboratory.'));
        announce('Clay is still working. It will email you the moment it’s ready.', true);
      } else {
        // Still building. Keep the last real note on screen between updates; only fall back to
        // a gentle, generic status if Clay's narration genuinely goes quiet for a while — so the
        // caption reads as real work in progress, not a clock repeating the same line.
        const secs = Math.round((Date.now() - startedAt) / 1000);
        if (notes.length === shown && Date.now() - lastNoteAt > 20000) {
          setCap('Still working… ' + secs + 's in.');
        }
        // No periodic "still working" announcement — the real steps above are what the person
        // wants read to them, not a clock ticking.
      }
      scrollToLatest(log);
    }, 2500);
  }

  // Reveal a finished project's REAL materials, drawn out of the flame one at a time. The
  // sections were written together in the build's big step, so this is honest presentation —
  // showing true, finished assets appear in sequence — not invented progress. Each lands with
  // a warm edge that cools to cyan, is announced as it arrives, and shows a lock when the user
  // hasn't kept the project (present and visible, not yet openable).
  async function revealMaterials(log, conceptId) {
    let assets = [];
    try {
      const r = await Kiln.api('/concepts/' + conceptId);
      assets = (r && r.assets ? r.assets : []).filter(function (a) { return a.is_current !== false; });
    } catch (_) { return; }
    if (!assets.length) return;
    const tray = el('div', 'material-tray');
    tray.setAttribute('role', 'list');
    tray.setAttribute('aria-label', 'Your project materials');
    log.appendChild(tray);
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      const name = a.title || labelForType(a.type);
      await sleep(REDUCE_MOTION ? 300 : 620);
      const card = el('div', 'material-card');
      card.setAttribute('role', 'listitem');
      card.appendChild(el('span', 'mc-edge'));
      card.appendChild(el('span', 'mc-name', name));
      if (a.locked) {
        const lk = el('span', 'mc-lock'); lk.setAttribute('aria-hidden', 'true'); card.appendChild(lk);
        card.setAttribute('aria-label', name + ', ready — locked until you keep this project');
      } else {
        card.setAttribute('aria-label', name + ', ready');
      }
      tray.appendChild(card);
      requestAnimationFrame(function () { card.classList.add('in'); });
      setTimeout(function () { card.classList.add('cool'); }, 700); // warm → settles cool
      announce(name + (a.locked ? ' — ready, locked until you keep the project.' : ' — ready.'));
      scrollToLatest(tray);
    }
    // The cards named each section; add one clear next step into the calm vault.
    vaultHandoff(log, conceptId, assets, { quiet: true, demo: assets.some((a) => a.type === 'html_demo' || a.type === 'built_site') });
    announce('Your project is ready. Open your vault to view, download, or edit each section.', true);
  }

  // ---- render Clay's result honestly by status ----
  // Clay's own voice on a project — its honest take and the next moves it would make —
  // shown before the files so the person hears a partner's thinking, not just documents.
  // Announced politely so a VoiceOver user actually hears the take, not just reaches it.
  // Your projects, front and center in the Laboratory — so picking up a project is the
  // easiest thing to do, and continuing is always free (paying is only to keep/download).
  async function renderMyConcepts(container, prefetched) {
    let projects = prefetched;
    if (!projects) {
      // The rename left this fetching into a variable called 'concepts' while everything below
      // reads 'projects' — so whenever this ran WITHOUT a prefetched list it assigned to a stray
      // global and then threw on projects.length. It only ever worked because the caller happened
      // to pass the list in.
      try { const r = await Kiln.api('/concepts'); projects = (r && (r.projects || r.concepts)) || []; }
      catch (_) { return; }
    }
    // tuneIntro() was called here and DEFINED NOWHERE. Because an undefined call throws, every line
    // below it stopped executing — so the whole "Your projects — pick up where you left off" panel
    // never rendered, and a returning creator opened the Laboratory to no sign of the work they had
    // already done. Their projects were safe in the database and simply invisible on the one screen
    // built to bring them back to it.
    //
    // Removed rather than reconstructed: nothing in the repo or its history defines it, so there is
    // no behaviour to restore, and inventing one to satisfy a dead call would be guessing.
    if (!projects.length) return;
    const panel = el('div', 'my-projects');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Your projects');
    panel.appendChild(el('p', 'take-label', 'Your projects — pick up where you left off'));
    panel.appendChild(el('p', 'muted', 'Open any one to keep building for free. Your first project is yours to download and keep at no cost; the $19 plan covers every project after it.'));
    const acts = el('div', 'actions');
    projects.slice(0, 8).forEach((c) => {
      const b = el('button', 'btn secondary', 'Continue: ' + (c.title || 'Untitled project')); b.type = 'button';
      b.addEventListener('click', () => loadConceptIntoWorkspace(c.id));
      acts.appendChild(b);
    });
    panel.appendChild(acts);
    if (projects.length > 8) panel.appendChild(el('p', 'muted', 'And ' + (projects.length - 8) + ' more in your dashboard.'));
    container.appendChild(panel);
    announce('You have ' + projects.length + ' project' + (projects.length === 1 ? '' : 's') + ' waiting. Open any to keep building.');
  }

  function renderClaysTake(container, project) {
    const c = project || {};
    const steps = Array.isArray(c.next_steps) ? c.next_steps.filter(Boolean) : [];
    if (!c.clays_take && !steps.length) return;
    const take = el('div', 'clays-take');
    take.setAttribute('role', 'note');
    take.setAttribute('aria-label', 'Clay’s take on your idea');
    if (c.clays_take) {
      take.appendChild(el('p', 'take-label', 'Clay’s take'));
      take.appendChild(el('p', null, c.clays_take));
    }
    if (steps.length) {
      take.appendChild(el('p', 'take-label', 'Where I’d take it next'));
      const ol = document.createElement('ol');
      steps.forEach((s) => { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); });
      take.appendChild(ol);
    }
    container.appendChild(take);
    if (c.clays_take) announce('Clay’s take: ' + c.clays_take);
  }

  // One calm handoff instead of stacking a "View" button per asset in the chat log: name what
  // Clay built, then send the person to a dedicated, screen-reader-first vault page where
  // each section can be viewed, downloaded, and sent back for an edit. Pass { quiet:true } when
  // the caller already listed the section names, so we show only the button. { demo:true } adds
  // a live-demo link.
  function vaultHandoff(container, conceptId, assets, opts) {
    opts = opts || {};
    const current = (assets || []).filter((a) => a && a.is_current !== false);
    const titles = current.map((a) => a.title || a.label || (a.type || '').replace(/_/g, ' ')).filter(Boolean);
    if (titles.length && !opts.quiet) {
      const summary = el('p', 'muted');
      summary.textContent = 'Clay built ' + titles.length + ' section' + (titles.length === 1 ? '' : 's') + ' and gathered them into your vault: ' + titles.join(', ') + '.';
      container.appendChild(summary);
    }
    const acts = el('div', 'actions');
    const open = el('a', 'btn', 'Open your vault');
    open.href = '/concept.html?id=' + encodeURIComponent(conceptId);
    acts.appendChild(open);
    if (opts.demo) {
      const d = el('a', 'btn secondary', 'Open the live demo');
      d.href = '/sandbox.html?concept=' + encodeURIComponent(conceptId);
      acts.appendChild(d);
    }
    container.appendChild(acts);
    return open;
  }

  function renderResult(container, data) {
    if (data.status === 'answered') {
      container.appendChild(el('p', null, data.message || 'Here is your project.'));
      renderClaysTake(container, data.project || {});
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
      const entitled = data.entitled !== false;
      const lockedNames = (data.assets || [])
        .filter((a) => !(entitled || PREVIEW_TYPES.includes(a.type)))
        .map((a) => a.title || a.label || a.type);
      // Calm handoff: one button to the project vault (view / download / edit each piece
      // there), plus the live demo if there is one — instead of a wall of per-asset buttons.
      const hasDemo = (data.assets || []).some((a) => a.type === 'html_demo' || a.type === 'built_site');
      vaultHandoff(container, data.project.id, data.assets, { demo: hasDemo });
      // A running business is never listed for sale — still offer a complementary dream if Clay named one.
      if (data.project && data.project.is_operating && data.dreamhold_suggestion && data.dreamhold_suggestion.reason) {
        container.appendChild(el('p', 'muted', 'Clay suggests: ' + data.dreamhold_suggestion.reason));
        const findBtn = el('a', 'btn secondary', 'Find a complementary dream in the Exchange');
        const cat = data.dreamhold_suggestion.category;
        findBtn.href = '/marketplace.html?entered=1' + (cat ? ('&category=' + encodeURIComponent(cat)) : '');
        container.appendChild(findBtn);
      }

      // A brand-new user asked whether finishing a build auto-posts to the Exchange. It does
      // not — say so right here, at the moment they'd wonder. Only for listable (not operating)
      // projects, since operating ones are never listed for sale at all.
      if (data.project && !data.project.is_operating) {
        const priv = el('p', 'muted');
        priv.textContent = 'Private to your Laboratory — this isn’t posted anywhere automatically. It only reaches the Exchange if you choose “List this in the Exchange,” and even then it goes to review first, never straight to sale.';
        container.appendChild(priv);
      }
      // Not kept yet: name the pieces that are built and waiting, with one way to unlock
      // them all. The business plan, marketing strategy, and demo stay free above.
      if (data.entitled === false && data.project) {
        if (lockedNames.length) {
          lockedNotice(container, data.project.id, lockedNames);
        } else {
          const keep = el('div', 'keep-note');
          keep.setAttribute('role', 'note');
          keep.appendChild(el('p', null, 'This project is yours to explore and refine right now — free. Your first project stays free to download and keep for good; from the second onward it is $19 a month for everything, sites and landing pages included.'));
          const kb = el('button', 'btn', 'Unlimited projects — $19/month'); kb.type = 'button';
          kb.addEventListener('click', () => keepConcept(data.project.id, kb));
          keep.appendChild(kb);
          keep.appendChild(sculptorButton());
          container.appendChild(keep);
        }
      }
      // Retrieval grounding, surfaced honestly: the user's own related prior work
      // Clay had in mind while building. Only their real earlier projects.
      if (Array.isArray(data.related_prior) && data.related_prior.length) {
        const names = data.related_prior.map((p) => p.title).filter(Boolean);
        if (names.length) {
          const note = el('p', 'muted');
          note.appendChild(document.createTextNode('Clay built this with your earlier work in mind: ' + names.join(', ') + '.'));
          container.appendChild(note);
        }
      }
      announce('Clay assembled your project, with ' + (data.assets || []).length + ' sections. Suggested next steps are available.');
      return;
    }
    // Async build: Clay confirmed it's working and will email the finished project.
    // The user is free to leave — no spinner, no waiting.
    if (data.status === 'building') {
      container.appendChild(el('p', 'msg ok', data.message || 'I’m building your project now and will email it to you when it’s ready.'));
      announce(data.message || 'Clay is building your project now. This usually takes 1 to 3 minutes. You’ll get an email when it’s ready, and it will be in your Laboratory. You don’t need to wait here.', true);
      if (data.build_id) watchBuild(container, data.build_id);
      return;
    }
    // The page is running old code and asked for something the current server won't do silently.
    if (data.status === 'stale_client') {
      container.appendChild(el('p', 'msg err', data.message));
      announce(data.message, true);
      const rl = el('button', 'btn', 'Refresh this page'); rl.type = 'button';
      rl.addEventListener('click', function () { location.reload(true); });
      container.appendChild(rl);
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
      a.href = URL.createObjectURL(blob); a.download = 'project-package.txt';
      document.body.appendChild(a); a.click(); a.remove();
      announce('Your package download has started.', true);
    } catch (e) {
      if (e.sessionExpired) { goSignIn(); return; }
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
          const body = { plan: 'builder' };   // one plan now; older subscriptions keep working untouched
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
    } catch (e) {
      if (e.sessionExpired) { goSignIn(); return; }
      if (e.status === 402) {
        const cid = currentConceptId || (e.data && e.data.options && e.data.options[0] && e.data.options[0].concept_id);
        const box = el('div', 'locked-note'); box.setAttribute('role', 'note');
        box.appendChild(el('p', null, '“' + label + '” is part of this project and unlocks when you keep it. Your business plan, marketing strategy, and live demo stay open for free.'));
        const kb = el('button', 'btn', 'Unlock everything — $19/month'); kb.type = 'button';
        kb.addEventListener('click', () => keepConcept(cid, kb));
        box.appendChild(kb);
        box.appendChild(sculptorButton());
        container.appendChild(box);
        focusEl(box, label + ' is locked until you keep this project.');
        return;
      }
      announce('Could not load ' + label + ': ' + e.message, true);
    }
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
    form.appendChild(el('h3', null, 'List this project on The Exchange'));
    form.appendChild(el('p', 'muted', 'You set the price. $10 minimum. Selling transfers ownership to the buyer.'));

    const fmtLabel = el('label'); fmtLabel.textContent = 'Sale format'; fmtLabel.setAttribute('for', 'l-format');
    const fmt = el('select'); fmt.id = 'l-format';
    ['flat', 'auction'].forEach((f) => { const o = el('option', null, f === 'flat' ? 'Flat price' : 'Auction'); o.value = f; fmt.appendChild(o); });

    const priceLabel = el('label'); priceLabel.textContent = 'Price in US dollars'; priceLabel.setAttribute('for', 'l-price');
    const price = el('input'); price.id = 'l-price'; price.type = 'number'; price.min = '10'; price.step = '1'; price.value = '10';

    const riskWrap = el('label'); riskWrap.style.fontWeight = '400';
    const risk = el('input'); risk.type = 'checkbox'; risk.id = 'l-risk'; risk.style.width = 'auto'; risk.style.minHeight = 'auto'; risk.style.marginRight = '10px';
    riskWrap.appendChild(risk); riskWrap.appendChild(document.createTextNode(' I have disclosed the regulatory and licensing risk in this project.'));

    const ownWrap = el('label'); ownWrap.style.fontWeight = '400';
    const own = el('input'); own.type = 'checkbox'; own.id = 'l-own'; own.style.width = 'auto'; own.style.minHeight = 'auto'; own.style.marginRight = '10px';
    ownWrap.appendChild(own); ownWrap.appendChild(document.createTextNode(' I understand that selling transfers ownership to the buyer.'));

    const submit = el('button', 'btn', 'Submit listing for review'); submit.type = 'button';
    const out = el('div'); out.setAttribute('role', 'alert'); out.setAttribute('aria-live', 'assertive');

    function showErr(m) { out.textContent = ''; out.appendChild(el('p', 'msg err', m)); announce(m, true); }

    submit.addEventListener('click', async () => {
      out.textContent = '';
      const dollars = parseInt(price.value, 10);
      if (!dollars || dollars < 10) { showErr('Set a price of at least $10, then submit again.'); price.focus(); return; }
      const missing = [];
      if (!risk.checked) missing.push('the risk disclosure');
      if (!own.checked) missing.push('the ownership transfer');
      if (missing.length) {
        showErr('Before submitting, check ' + missing.join(' and ') + ' above — both boxes are required.');
        (!risk.checked ? risk : own).focus();
        return;
      }
      submit.disabled = true; announce('Submitting your listing for review…');
      // Step 1 — create the draft listing.
      let listing;
      try {
        const body = { concept_id: conceptId, format: fmt.value, risk_disclosed: true, ownership_ack: true };
        if (fmt.value === 'flat') body.price_cents = dollars * 100; else body.starting_bid_cents = dollars * 100;
        const res = await Kiln.api('/listings', { method: 'POST', body });
        listing = res && res.listing;
      } catch (e) {
        if (e.sessionExpired) { announce('Your session expired. Taking you to sign in.', true); return goSignIn(); }
        let m = e.message || 'Couldn’t create the listing.';
        if (e.data && e.data.details && e.data.details.needs) {
          const n = e.data.details.needs;
          const miss = Object.entries(n).filter((kv) => !kv[1]).map((kv) => kv[0].replace(/_/g, ' '));
          if (miss.length) m += ' Still needed: ' + miss.join(', ') + '.';
        }
        showErr(m); submit.disabled = false; return;
      }
      if (!listing || !listing.id) { showErr('The listing didn’t come back correctly, so nothing was submitted. Please try again.'); submit.disabled = false; return; }
      // Step 2 — send it for review.
      try {
        await Kiln.api('/listings/' + listing.id + '/submit', { method: 'POST' });
      } catch (e) {
        if (e.sessionExpired) { announce('Your session expired. Taking you to sign in.', true); return goSignIn(); }
        showErr('The listing was created but couldn’t be sent for review: ' + (e.message || 'unknown error') + '. You can submit it from your dashboard.');
        submit.disabled = false; return;
      }
      out.appendChild(el('p', 'msg ok', 'Listing submitted for review. It goes live once a moderator approves it.'));
      announce('Listing submitted for review. It goes live once a moderator approves it.', true);
      submit.disabled = true;
    });

    const ackIntro = el('p', 'muted', 'Two confirmations are required before you can submit — please check both boxes below.');
    [fmtLabel, fmt, priceLabel, price, ackIntro, riskWrap, ownWrap, submit, out].forEach((n) => form.appendChild(n));
    container.appendChild(form);
    focusEl(fmt, 'Listing form opened.');
  }

  document.getElementById('signout').addEventListener('click', (e) => {
    e.preventDefault(); Kiln.clearTokens(); location.href = '/';
  });
})();
