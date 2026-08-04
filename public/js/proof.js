// Proof badge — the visible trust signal that makes a Dream Market concept
// different from a bare idea on a flip site. Renders real, earned signals only:
// captured waitlist demand, whether the concept was written against real
// research, and whether its concrete claims passed a source self-check. Honest:
// shows a caution state when claims need review, and says plainly when nothing
// has been proven yet. Screen-reader first — the whole badge is spoken as one
// clear sentence; the coloured chips are decorative (aria-hidden).
(function () {
  if (!document.getElementById('proof-css')) {
    const s = document.createElement('style');
    s.id = 'proof-css';
    s.textContent =
      '.proof{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:.5rem 0}' +
      '.proof-label{font-weight:600;font-size:.85rem}' +
      '.proof-chip{display:inline-block;padding:.15rem .55rem;border-radius:999px;font-size:.8rem;line-height:1.7;border:1px solid}' +
      '.proof-ok{background:#e8f5ee;border-color:#7bc99a;color:#14532d}' +
      '.proof-warn{background:#fff4e5;border-color:#e0a45c;color:#7a3d00}';
    document.head.appendChild(s);
  }

  window.proofBadge = function (d, opts) {
    opts = opts || {};
    const waiting = Number(d && d.waiting) || 0;
    const grounded = !!(d && d.research_grounded);
    const verified = d ? d.claims_verified : null; // true | false | null

    const chips = [];
    if (waiting > 0) chips.push({ t: waiting + ' waiting', k: 'ok' });
    if (grounded) chips.push({ t: 'Research grounded', k: 'ok' });
    if (verified === true) chips.push({ t: 'Claims verified', k: 'ok' });
    else if (verified === false) chips.push({ t: 'Claims need review', k: 'warn' });

    const wrap = document.createElement('div');
    wrap.className = 'proof';

    if (!chips.length) {
      if (!opts.full) return null; // compact cards stay clean when nothing's proven
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No proof captured yet — no waitlist demand or grounded research on this concept so far.';
      wrap.appendChild(p);
      return wrap;
    }

    const summary = 'Proof — ' + chips.map(function (c) { return c.t; }).join(', ') + '.';
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = summary;
    wrap.appendChild(sr);

    const label = document.createElement('span');
    label.className = 'proof-label';
    label.textContent = 'Proof';
    label.setAttribute('aria-hidden', 'true');
    wrap.appendChild(label);

    chips.forEach(function (c) {
      const span = document.createElement('span');
      span.className = 'proof-chip ' + (c.k === 'warn' ? 'proof-warn' : 'proof-ok');
      span.textContent = c.t;
      span.setAttribute('aria-hidden', 'true');
      wrap.appendChild(span);
    });
    return wrap;
  };
})();
