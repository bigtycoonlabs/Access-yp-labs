// THE TEAM SPACE — who is on this project, what it still needs, and what everyone agreed.
//
// Everything built this week has been API-only: seats, contributions and agreements all work and
// none of them are visible to a person. This is the screen that makes them real.
//
// It sits on the project page rather than in a separate room, because a team space that is somewhere
// else is a place people forget to open. The project IS the team space.
//
// Three things, in the order somebody needs them:
//   who is on it and what it still needs        — the state of the team
//   work offered, waiting on the owner          — the thing that needs a decision today
//   the split, and who has not signed yet       — the agreement, named not counted
//
// Written to be heard. Every state is a sentence, every action announces its outcome, and nothing
// says only "3" where it could say "waiting on Rel".
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const pct = (bp) => (Number(bp || 0) / 100) + '%';

  const KIND_LABEL = {
    build: 'Build', sell: 'Sell', materials: 'Materials', operate: 'Operate', craft: 'Craft',
  };

  // A live region per section rather than one for the page. Two things happening at once in one
  // region means the second overwrites the first, and the person hears only half of what occurred.
  function saidLine(host) {
    const p = el('p', 'muted');
    p.setAttribute('role', 'status');
    p.setAttribute('aria-live', 'polite');
    host.appendChild(p);
    return p;
  }

  function say(line, text) {
    line.textContent = text;
    if (window.announce) window.announce(text, true);
  }

  // The API falls back to "no name yet" when somebody has not picked a display name. Rendered
  // directly it reads as "marketing from no name yet" — as though the WORK were anonymous rather
  // than the person simply not having chosen a name, and it is the first thing an owner sees when
  // deciding whether to accept somebody's evening of work.
  function named(n, fallback) {
    return (!n || /no name yet/i.test(n)) ? fallback : n;
  }

  async function render(host, conceptId, isOwner) {
    host.innerHTML = '';
    const sect = el('section', 'panel');
    sect.setAttribute('aria-labelledby', 'team-h');
    const h = el('h2', null, 'The team'); h.id = 'team-h';
    sect.appendChild(h);
    host.appendChild(sect);

    let seats, contribs, agreement;
    try {
      seats = await Kiln.api('/seats/project/' + conceptId);
      contribs = await Kiln.api('/contributions/project/' + conceptId);
      agreement = await Kiln.api('/agreements/project/' + conceptId);
    } catch (e) {
      if (e && e.sessionExpired) return;
      // A failed read is not an empty team. Saying "nobody is on this project" when we simply could
      // not look would be the platform inventing a fact out of a network error.
      sect.appendChild(el('p', 'msg err', 'Could not load the team for this project. That is a '
        + 'failed read, not an empty one — nothing has changed.'));
      return;
    }

    // ---------------------------------------------------------------- who is on it
    const team = (agreement.team || []);
    if (team.length <= 1) {
      sect.appendChild(el('p', null, isOwner
        ? 'You are building this on your own. Open a seat below and say what you need, and somebody '
          + 'here can take it.'
        : 'One person is building this so far.'));
    } else {
      const ul = el('ul');
      team.forEach(function (m) {
        const role = m.role === 'owner' ? 'started it'
          : m.role === 'seat' ? 'holds a seat' : 'contributed work';
        ul.appendChild(el('li', null, m.name + ' — ' + role));
      });
      sect.appendChild(ul);
    }

    const roomText = seats.full
      ? 'This project is full. Five people is the limit, and nobody else can join until somebody '
        + 'releases their seat.'
      : seats.remaining + ' place' + (seats.remaining === 1 ? '' : 's') + ' left out of five.';
    sect.appendChild(el('p', 'muted', roomText));

    // ---------------------------------------------------------------- what it needs
    const open = (seats.seats || []).filter(function (s) { return s.status === 'open'; });
    if (open.length) {
      sect.appendChild(el('h3', null, 'What this project is looking for'));
      open.forEach(function (s) {
        const d = el('div', 'panel');
        d.appendChild(el('h4', null, KIND_LABEL[s.kind] || s.kind));
        d.appendChild(el('p', null, s.brief));
        sect.appendChild(d);
      });
    } else if (isOwner && !seats.full) {
      // Only when NOTHING has ever been asked for. Caught by reading the rendered page: with a seat
      // already filled, this told the owner they had not said what they needed — while somebody was
      // sitting in the seat they had asked for and filled.
      const everAsked = (seats.seats || []).length > 0;
      sect.appendChild(el('p', 'muted', everAsked
        ? 'Nothing open at the moment. Open another seat below if the project needs more.'
        : 'You have not said what you need yet. A seat that says "open to partners" is one nobody '
          + 'can act on — say what the work actually is.'));
    }

    if (isOwner && !seats.full) sect.appendChild(seatForm(conceptId, host));

    // ---------------------------------------------------------------- work offered
    const offered = (contribs.contributions || []).filter(function (c) { return c.state === 'offered'; });
    const accepted = (contribs.contributions || []).filter(function (c) {
      return c.state === 'accepted' || c.state === 'superseded';
    });

    if (isOwner && offered.length) {
      sect.appendChild(el('h3', null, offered.length + ' waiting on you'));
      sect.appendChild(el('p', 'muted', 'Somebody built something for this project. You decide '
        + 'whether it fits — nobody else can, and they see your answer either way.'));
      offered.forEach(function (c) { sect.appendChild(decideCard(c, host, conceptId)); });
    } else if (offered.length) {
      sect.appendChild(el('p', 'muted', offered.length + ' thing' + (offered.length === 1 ? '' : 's')
        + ' offered and waiting on the owner.'));
    }

    if (accepted.length) {
      sect.appendChild(el('h3', null, 'Built into this project'));
      const ul = el('ul');
      accepted.forEach(function (c) {
        ul.appendChild(el('li', null, c.kind + ' by ' + named(c.contributor_name, 'somebody with no display name yet')
          + (c.share_bp ? ' — ' + pct(c.share_bp) + ' of the seller side' : '')
          + (c.state === 'superseded' ? ' (since replaced, share kept)' : '')));
      });
      sect.appendChild(ul);
    }

    // ---------------------------------------------------------------- the agreement
    sect.appendChild(agreementBlock(agreement, conceptId, host));
  }

  // ---------------------------------------------------------------- opening a seat
  function seatForm(conceptId, host) {
    const wrap = el('div', 'panel');
    wrap.appendChild(el('h3', null, 'Ask for what you need'));

    const kl = el('label', null, 'What kind of help'); kl.setAttribute('for', 'seat-kind');
    const sel = document.createElement('select'); sel.id = 'seat-kind'; sel.style.minHeight = '44px';
    Object.keys(KIND_LABEL).forEach(function (k) {
      const o = el('option', null, KIND_LABEL[k] + ' — ' + hint(k)); o.value = k; sel.appendChild(o);
    });

    const bl = el('label', null, 'What you need from them'); bl.setAttribute('for', 'seat-brief');
    const ta = document.createElement('textarea'); ta.id = 'seat-brief'; ta.rows = 3;
    ta.placeholder = 'A working demo site so a buyer can see it running. React or plain HTML, either is fine.';

    const btn = el('button', 'btn', 'Open this seat'); btn.type = 'button';
    const line = el('div');
    wrap.appendChild(kl); wrap.appendChild(sel);
    wrap.appendChild(bl); wrap.appendChild(ta);
    wrap.appendChild(btn); wrap.appendChild(line);
    const said = saidLine(line);

    btn.addEventListener('click', async function () {
      // The rule the server enforces, said here first so nobody types into a refusal.
      if (ta.value.trim().length < 20) {
        say(said, 'Say what you need in a bit more detail — at least twenty characters. '
          + '"Open to partners" is what nobody could act on. Nothing was posted.');
        return;
      }
      btn.disabled = true;
      try {
        await Kiln.api('/seats/project/' + conceptId, {
          method: 'POST', body: { kind: sel.value, brief: ta.value.trim() },
        });
        say(said, 'Seat opened. It is on the board now, and anybody here can ask for it.');
        setTimeout(function () { render(host, conceptId, true); }, 900);
      } catch (e) {
        say(said, e && e.status ? e.message
          : 'That did not post, so nothing was opened. Please try again.');
        btn.disabled = false;
      }
    });
    return wrap;
  }

  function hint(k) {
    return { build: 'the demo, the site, the thing that works',
      sell: 'customers, outreach, the first ten buyers',
      materials: 'funding the upfront costs',
      operate: 'running it once it launches',
      craft: 'brand, copy, photography, design' }[k] || '';
  }

  // ---------------------------------------------------------------- deciding on work
  function decideCard(c, host, conceptId) {
    const d = el('div', 'panel');
    d.appendChild(el('h4', null, c.kind + ' from ' + named(c.contributor_name, 'somebody who has not set a display name yet')));
    d.appendChild(el('p', null, c.note));

    const shl = el('label', null, 'What share of the seller side is this worth');
    shl.setAttribute('for', 'sh-' + c.id);
    const sh = el('input'); sh.id = 'sh-' + c.id; sh.type = 'number';
    sh.min = '0'; sh.max = '100'; sh.step = '1'; sh.value = '10'; sh.style.minHeight = '44px';
    const shHelp = el('p', 'muted', 'A percentage. Once you accept, this is fixed — it will not '
      + 'shrink if more people join later.');

    const yes = el('button', 'btn', 'Accept it'); yes.type = 'button';
    const no = el('button', 'btn secondary', 'Turn it down'); no.type = 'button';
    const rl = el('label', null, 'If you are turning it down, why');
    rl.setAttribute('for', 'rr-' + c.id);
    const rr = document.createElement('textarea'); rr.id = 'rr-' + c.id; rr.rows = 2;
    rr.placeholder = 'Good work, but I am going a different direction with the visuals on this one.';

    const line = el('div'); const said = saidLine(line);
    d.appendChild(shl); d.appendChild(sh); d.appendChild(shHelp);
    d.appendChild(rl); d.appendChild(rr);
    d.appendChild(yes); d.appendChild(no); d.appendChild(line);

    yes.addEventListener('click', async function () {
      yes.disabled = true; no.disabled = true;
      try {
        const r = await Kiln.api('/contributions/' + c.id + '/accept', {
          method: 'POST', body: { share_bp: Math.round(Number(sh.value || 0) * 100) },
        });
        say(said, r.message);
        setTimeout(function () { render(host, conceptId, true); }, 1200);
      } catch (e) {
        // The over-commitment refusal tells the owner exactly how much is left. Pass it through.
        say(said, e && e.status ? e.message : 'That did not go through, so nothing was accepted.');
        yes.disabled = false; no.disabled = false;
      }
    });

    no.addEventListener('click', async function () {
      if (rr.value.trim().length < 15) {
        say(said, 'Say why, in a sentence. They read it, and a reason they can learn from is the '
          + 'difference between a no and a door closing. Nothing was sent.');
        return;
      }
      yes.disabled = true; no.disabled = true;
      try {
        const r = await Kiln.api('/contributions/' + c.id + '/reject', {
          method: 'POST', body: { reason: rr.value.trim() },
        });
        say(said, r.message);
        setTimeout(function () { render(host, conceptId, true); }, 1200);
      } catch (e) {
        say(said, e && e.status ? e.message : 'That did not send, so nothing was decided.');
        yes.disabled = false; no.disabled = false;
      }
    });
    return d;
  }

  // ---------------------------------------------------------------- the agreement
  function agreementBlock(data, conceptId, host) {
    const wrap = el('div', 'panel');
    wrap.appendChild(el('h3', null, 'What the team agreed'));

    if (data.locked) {
      wrap.appendChild(el('p', 'muted', 'This project is live on the Exchange, so the split is '
        + 'locked. What a buyer sees is what pays out.'));
    }

    const a = data.agreement;
    if (!a) {
      wrap.appendChild(el('p', null, (data.team || []).length > 1
        ? 'Nothing agreed yet. Until the team writes a split and everybody signs it, there is no '
          + 'record of who gets what.'
        : 'Nothing to agree yet — you are the only person on this project.'));
    } else {
      const terms = Array.isArray(a.terms) ? a.terms : [];
      const byId = {};
      (data.team || []).forEach(function (m) { byId[m.id] = m.name; });
      const ul = el('ul');
      terms.forEach(function (t) {
        ul.appendChild(el('li', null, (byId[t.user_id] || 'somebody') + ' — ' + pct(t.share_bp)));
      });
      wrap.appendChild(ul);

      if (a.note) wrap.appendChild(el('p', 'muted', '\u201c' + a.note + '\u201d'));

      if (a.state === 'signed') {
        wrap.appendChild(el('p', null, 'Signed by everybody. These are the team\u2019s terms.'));
      } else if ((data.waiting_on || []).length) {
        // Named, never counted. "Waiting on 2 people" is a fact nobody can act on.
        wrap.appendChild(el('p', null, 'Waiting on ' + data.waiting_on.join(' and ') + ' to sign.'));
        const sign = el('button', 'btn', 'Sign this'); sign.type = 'button';
        const line = el('div'); const said = saidLine(line);
        sign.addEventListener('click', async function () {
          sign.disabled = true;
          try {
            const r = await Kiln.api('/agreements/' + a.id + '/sign', { method: 'POST' });
            say(said, r.message);
            setTimeout(function () { render(host, conceptId, data.can_decide); }, 1200);
          } catch (e) {
            say(said, e && e.status ? e.message : 'That did not go through, so nothing was signed.');
            sign.disabled = false;
          }
        });
        wrap.appendChild(sign); wrap.appendChild(line);
      }
    }

    if ((data.history || []).length > 1) {
      wrap.appendChild(el('p', 'muted', (data.history.length) + ' versions of this agreement. Every '
        + 'earlier one is kept, so the team can always see what was agreed and when.'));
    }
    return wrap;
  }

  window.TeamSpace = { render };
})();
