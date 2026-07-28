// Accessibility helpers. The whole platform is built for VoiceOver first:
// every state change is announced, focus is always managed deliberately.
(function () {
  // One polite + one assertive live region, created once.
  function region(id, live) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.setAttribute('aria-live', live);
      el.setAttribute('aria-atomic', 'true');
      el.className = 'sr-only';
      document.body.appendChild(el);
    }
    return el;
  }
  function ensureRegions() { region('sr-polite', 'polite'); region('sr-assertive', 'assertive'); }

  // Announce a message to screen readers. assertive=true interrupts.
  window.announce = function (msg, assertive) {
    ensureRegions();
    const el = document.getElementById(assertive ? 'sr-assertive' : 'sr-polite');
    el.textContent = '';
    // Timeout so repeated identical messages are still re-announced.
    setTimeout(() => { el.textContent = msg; }, 60);
  };

  // Move focus to an element and optionally announce it.
  window.focusEl = function (el, announceText) {
    if (!el) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus();
    if (announceText) window.announce(announceText);
  };

  document.addEventListener('DOMContentLoaded', ensureRegions);
})();
