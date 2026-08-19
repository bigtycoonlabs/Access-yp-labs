// Shared primary navigation.
// One consistent menu on every page, so the app stops feeling like a different maze
// on each screen. Renders synchronously (so #signout exists for other page scripts),
// then reveals a Staff link for staff accounts after checking the session.
//
// Logged-in menu:  Laboratory · Dashboard · The Exchange · Help build · Affiliate · Profile
//                  · Staff (staff only) · Sign out
// Logged-out menu: Home · The Exchange · Help build · Become an Affiliate · The Desk · Sign in · Sign up
//
// Clay Weekly is NOT a separate entry: it is part of The Desk, reached from there. The Desk and the
// magazine are the same thing to a reader — writing about what is happening here — and two menu
// entries for one idea makes a person wonder what the difference is.
//
// Launch partners is deliberately NOT here: it is a tab INSIDE the Exchange, not a separate
// destination. Two entrances to one room only makes people wonder which is the real one.
//
// IMPORTANT: this file REPLACES whatever markup a page has in nav.top. Adding a link to a page's
// HTML therefore does nothing — it is wiped on load. Every destination has to be listed HERE, or it
// is invisible to everyone. (Links added to individual pages were silently disappearing this way,
// which is exactly how the Affiliate and Launch partner pages ended up unreachable from the menu.)
(function () {
  var nav = document.querySelector('nav.top');
  if (!nav) return;

  var here = location.pathname;
  function link(href, label) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (here === href) a.setAttribute('aria-current', 'page');
    return a;
  }
  // A LIST, NOT A RUN-ON SENTENCE. The links were appended with nothing between them, so a screen
  // reader announced "LaboratoryDashboardThe ExchangeAffiliateProfileSign out" as a single
  // unbroken string — the first thing heard on every page of the platform. Marking the nav up as a
  // real list makes each item a separate stop with a countable position, which is how someone
  // listening navigates rather than guesses.
  function asList(items) {
    var ul = document.createElement('ul');
    ul.className = 'nav-list';
    items.forEach(function (node) {
      var li = document.createElement('li');
      li.appendChild(node);
      ul.appendChild(li);
    });
    return ul;
  }

  function tokens() {
    try { return JSON.parse(localStorage.getItem('kiln.tokens')) || {}; } catch (_) { return {}; }
  }

  nav.textContent = '';

  if (tokens().accessToken) {
    var so = document.createElement('a');
    so.href = '#';
    so.id = 'signout';
    so.textContent = 'Sign out';
    so.addEventListener('click', function (e) {
      e.preventDefault();
      try { if (window.Kiln && Kiln.clearTokens) Kiln.clearTokens(); else localStorage.removeItem('kiln.tokens'); } catch (_) {}
      location.href = '/';
    });
    nav.appendChild(asList([
      link('/app.html', 'Laboratory'),
      link('/dashboard.html', 'Dashboard'),
      link('/marketplace.html', 'The Exchange'),
      // HELP BUILD, in BOTH menus. I added this to ten static pages and it never appeared, because
      // nav.js replaces every page's nav on load — the static markup was dead the whole time. It
      // matters most for the signed-out menu: somebody who has a skill and no idea of their own is
      // exactly a stranger, and they could not see the one page built for them.
      link('/seats.html', 'Help build'),
      link('/movers.html', 'Affiliate'),
      link('/profile.html', 'Profile'),
      so,
    ]));

    // Reveal Staff for staff accounts — async, never blocks the menu rendering.
    if (window.Kiln && Kiln.api) {
      Kiln.api('/auth/me').then(function (r) {
        var role = r && r.user && r.user.role;
        if (['staff', 'admin', 'master_staff'].indexOf(role) !== -1) {
          // Insert into the LIST, wrapped in its own item — the links are list items now, so
          // inserting into `nav` would put a bare anchor outside the list where a screen reader
          // would not count it among the menu items.
          var out = document.getElementById('signout');
          var host = out && out.parentNode ? out.parentNode.parentNode : nav;
          var li = document.createElement('li');
          li.appendChild(link('/console.html', 'Operations'));
          if (host && out && out.parentNode) host.insertBefore(li, out.parentNode);
          else nav.appendChild(li);
        }
      }).catch(function () {});
    }
  } else {
    var out = [
      link('/', 'Home'),
      link('/marketplace.html', 'The Exchange'),
      link('/seats.html', 'Help build'),
      link('/movers.html', 'Become an Affiliate'),
      link('/desk', 'The Desk'),
      link('/login.html', 'Sign in'),
      link('/register.html', 'Sign up'),
    ];
    nav.appendChild(asList(out));
  }
})();
