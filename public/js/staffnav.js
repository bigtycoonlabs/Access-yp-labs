// ONE STAFF NAVIGATION, ON EVERY STAFF SCREEN.
//
// Walked as a staff member on a phone, and the complaint was exact: still difficult to navigate,
// difficult to complete tasks. The reason is that there were TWO disconnected staff worlds.
//
//   From the global menu: Operations -> console.html -> market-control.html. Dead end. Two pages.
//   From the dashboard:   admin-overview.html -> admin-tools, admin-clay, desk-admin, weekly-admin,
//                         people. Six pages, cross-linked to each other.
//
// Nothing joined them. From Operations you could not reach Clay Weekly, the Desk, moderation,
// people or Clay health. From the overview you could not reach Operations or market control. The
// global menu offered exactly one staff entry, into the smaller of the two islands.
//
// The second world also had no shared navigation: each page carried its own hand-rolled `nav.top`
// bar listing a different subset — admin-tools had four links, admin-clay six, people three — so
// which screens existed depended on which screen you happened to be standing on. None carried
// aria-current, so seven of the eight staff pages never told a screen-reader user where they were.
//
// This is the same fix YP Flow arrived at for the same complaint: separate routes, ONE labelled nav
// landmark, aria-current on the active link. The set of screens is now identical everywhere, which
// is the part that makes a place learnable — you find a thing once and it is in that spot after.
(function () {
  var LINKS = [
    ['/console.html', 'Operations', 'the day: what needs a person right now'],
    ['/market-control.html', 'Exchange', 'review, edit and approve listings'],
    ['/desk-admin.html', "Clay's Desk", 'review what Clay wrote'],
    ['/weekly-admin.html', 'Clay Weekly', 'assemble and send the magazine'],
    ['/people.html', 'People', 'accounts and creators'],
    ['/admin-tools.html', 'Moderation', 'reports, takedowns, suspensions'],
    ['/admin-clay.html', 'Clay health', 'is Clay working'],
    ['/admin-overview.html', 'Overview', 'one honest read on the whole platform'],
  ];

  function build() {
    var here = location.pathname.replace(/\/+$/, '') || '/';
    var nav = document.createElement('nav');
    nav.className = 'staffnav';
    // Labelled, because a page with two nav landmarks and no names on them gives a screen reader
    // "navigation, navigation" and no way to tell the site menu from the staff menu.
    nav.setAttribute('aria-label', 'Staff areas');

    var ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';
    ul.style.display = 'flex';
    ul.style.flexWrap = 'wrap';
    ul.style.gap = '6px 14px';

    LINKS.forEach(function (row) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = row[0];
      a.textContent = row[1];
      a.title = row[2];
      // 44px targets. A queue is worked with a thumb.
      a.style.display = 'inline-block';
      a.style.minHeight = '44px';
      a.style.lineHeight = '44px';
      if (row[0] === here) {
        // The one thing that answers "where am I", and it must be announced rather than only drawn:
        // a colour change alone says nothing to a screen reader.
        a.setAttribute('aria-current', 'page');
        a.style.fontWeight = '700';
      }
      li.appendChild(a);
      ul.appendChild(li);
    });
    nav.appendChild(ul);
    return nav;
  }

  function mount() {
    if (document.querySelector('nav.staffnav')) return;
    var main = document.querySelector('main');
    if (!main) return;
    // Above the first heading, inside main, so tabbing forward from the skip link reaches the staff
    // menu before a screenful of content rather than after it.
    main.insertBefore(build(), main.firstChild);

    // The hand-rolled bars listed different subsets on different pages. Removing them leaves one
    // answer to "what staff screens are there" instead of five competing ones.
    Array.prototype.forEach.call(document.querySelectorAll('nav.top'), function (n) { n.remove(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
