// Shared primary navigation.
// One consistent menu on every page, so the app stops feeling like a different maze
// on each screen. Renders synchronously (so #signout exists for other page scripts),
// then reveals a Staff link for staff accounts after checking the session.
//
// Logged-in menu:  Laboratory · Dashboard · The Dreamhold · Consultants · Profile
//                  · Staff (staff only) · Sign out
// Logged-out menu: Home · The Dreamhold · Sign in · Sign up
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
  function tokens() {
    try { return JSON.parse(localStorage.getItem('kiln.tokens')) || {}; } catch (_) { return {}; }
  }

  nav.textContent = '';

  if (tokens().accessToken) {
    nav.appendChild(link('/app.html', 'Laboratory'));
    nav.appendChild(link('/dashboard.html', 'Dashboard'));
    nav.appendChild(link('/marketplace.html', 'The Dreamhold'));
    nav.appendChild(link('/consultants.html', 'Consultants'));
    nav.appendChild(link('/profile.html', 'Profile'));

    var so = document.createElement('a');
    so.href = '#';
    so.id = 'signout';
    so.textContent = 'Sign out';
    so.addEventListener('click', function (e) {
      e.preventDefault();
      try { if (window.Kiln && Kiln.clearTokens) Kiln.clearTokens(); else localStorage.removeItem('kiln.tokens'); } catch (_) {}
      location.href = '/';
    });
    nav.appendChild(so);

    // Reveal Staff for staff accounts — async, never blocks the menu rendering.
    if (window.Kiln && Kiln.api) {
      Kiln.api('/auth/me').then(function (r) {
        var role = r && r.user && r.user.role;
        if (['staff', 'admin', 'master_staff'].indexOf(role) !== -1) {
          nav.insertBefore(link('/admin-overview.html', 'Staff'), document.getElementById('signout'));
        }
      }).catch(function () {});
    }
  } else {
    nav.appendChild(link('/', 'Home'));
    nav.appendChild(link('/marketplace.html', 'The Dreamhold'));
    nav.appendChild(link('/login.html', 'Sign in'));
    nav.appendChild(link('/register.html', 'Sign up'));
  }
})();
