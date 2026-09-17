// Company links at the foot of every Access YP Labs page.
//
// Pages here were written at different times and about half have no footer at all, so the
// links live in one file: if a page already has a <footer>, the links are added to it; if
// not, a footer is added at the end of the page. The accessibility statement for all three
// platforms lives on the company site, so "Accessibility" goes there.
//
// Not used on customer portals (portal.html): those belong to the Labs user's business,
// not to us.
(function () {
  if (document.querySelector('nav[data-company-links]')) return;
  var CO = 'https://accessyourplace.com/setupyourplace';
  var tag = 'utm_source=yplabs&utm_medium=footer';
  var links = [
    [CO + '?' + tag, 'Set Up Your Place LLC'],
    [CO + '/accessibility?' + tag, 'Accessibility'],
    ['https://accessypflow.com/?' + tag, 'Access YP Flow'],
    ['https://accessyourplace.com/?' + tag, 'Access Your Place'],
    ['/terms.html', 'Terms'],
    ['/privacy.html', 'Privacy'],
  ];

  function build() {
    var nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Company');
    nav.setAttribute('data-company-links', '');
    nav.className = 'company-links';
    var p = document.createElement('p');
    links.forEach(function (l, i) {
      if (i) p.appendChild(document.createTextNode(' \u00b7 '));
      var a = document.createElement('a');
      a.href = l[0];
      a.textContent = l[1];
      p.appendChild(a);
    });
    nav.appendChild(p);
    var note = document.createElement('p');
    note.textContent = 'Access YP Labs is a Set Up Your Place LLC company.';
    nav.appendChild(note);
    return nav;
  }

  function place() {
    var footer = document.querySelector('footer');
    if (!footer) {
      footer = document.createElement('footer');
      footer.className = 'site-footer';
      document.body.appendChild(footer);
    }
    footer.appendChild(build());
  }

  var css = document.createElement('style');
  css.textContent =
    'nav.company-links{margin:1.5em auto 0;padding:1em 1rem 1.5em;max-width:60rem;font-size:.95rem;line-height:1.6}' +
    'nav.company-links a{display:inline-block;min-height:44px;line-height:44px;padding:0 .15em}' +
    'footer.site-footer{border-top:1px solid rgba(127,127,127,.35);margin-top:2em}';
  document.head.appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
  else place();
})();
