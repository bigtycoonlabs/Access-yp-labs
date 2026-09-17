// DESK: drafts waiting for an owner's decision, and what is published.
Staff.load(async function (main) {
  var S = Staff, e = S.esc;
  var dr = await fetch('/api/desk/drafts'); var drafts = dr.ok ? (await dr.json()).drafts : [];
  var pr = await fetch('/api/desk/articles'); var pub = pr.ok ? (await pr.json()).articles : [];
  S.say(S.plural(drafts.length, 'draft waits', 'drafts wait') + ' for review. ' + S.plural(pub.length, 'article is', 'articles are') + ' shown on the Desk.');
  var d = drafts.map(function (a) {
    return '<strong>' + e(a.title) + '</strong><br/>' + e(String(a.dek ? a.dek + ' ' + (a.body || '') : (a.body || '')).slice(0, 600))
      + (String(a.body || '').length > 600 ? '\u2026' : '')
      + '<div class="row-actions"><button class="btn" type="button" data-publish="' + e(a.id) + '">Publish ' + e(a.title) + '</button>'
      + '<button class="btn plain" type="button" data-archive="' + e(a.id) + '">Discard ' + e(a.title) + '</button></div>';
  });
  var p = pub.map(function (a) {
    return '<a href="/desk/' + e(a.slug) + '">' + e(a.title) + '</a>'
      + '<div class="row-actions"><button class="btn plain" type="button" data-archive="' + e(a.id) + '">Take down ' + e(a.title) + '</button></div>';
  });
  main.innerHTML = '<p class="muted">Only an owner can publish or take down an article.</p>'
    + S.section('Waiting for review', d, 'No drafts are waiting.')
    + S.section('Published, most recent', p, 'Nothing is published.');
});
document.addEventListener('click', async function (ev) {
  var t = ev.target, S = Staff;
  try {
    if (t.dataset.publish) { t.disabled = true; await S.send('/api/desk/' + t.dataset.publish + '/publish'); S.say('Published.'); location.reload(); }
    else if (t.dataset.archive) {
      if (!confirm('Take this article off the Desk?')) return;
      t.disabled = true; await S.send('/api/desk/' + t.dataset.archive + '/archive'); S.say('Taken down.'); location.reload();
    }
  } catch (e) { t.disabled = false; S.say(e.message); }
});
