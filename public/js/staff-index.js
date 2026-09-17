// TODAY: what needs a person, most urgent first. Alerts can be marked in hand and resolved with a note.
Staff.load(async function (main) {
  var S = Staff, e = S.esc;
  var d = await S.get('/today');
  S.say(d.says);
  var alerts = d.alerts.map(function (a) {
    return '<strong>' + e(a.subject) + '</strong>'
      + (a.times > 1 ? ' (' + a.times + ' times, most recently ' + e(S.when(a.last_seen)) + ')' : ', ' + e(S.when(a.last_seen)))
      + (a.acknowledged ? '. Somebody is on it.' : '.')
      + (a.body ? '<br/>' + e(String(a.body).slice(0, 400)) : '')
      + '<div class="row-actions">'
      + (a.acknowledged ? '' : '<button class="btn plain" type="button" data-ack="' + e(a.id) + '">I am on it</button>')
      + '<label class="sr-only" for="note-' + e(a.id) + '">What was done about ' + e(a.subject) + '</label>'
      + '<input class="box" id="note-' + e(a.id) + '" type="text" placeholder="What was done"/>'
      + '<button class="btn" type="button" data-resolve="' + e(a.id) + '">Resolve</button></div>';
  });
  var builds = d.builds.map(function (b) {
    return e(b.business) + ': ' + e(b.asked_for.slice(0, 120)) + '. '
      + (b.status === 'failed' ? 'Failed ' + e(S.when(b.updated_at)) + '. ' + e(b.says || '') : 'Still building after 30 minutes.');
  });
  var research = d.research.map(function (r) {
    return e(r.business) + ': ' + (r.status === 'failed' ? 'research failed ' + e(S.when(r.created_at)) + '. ' + e(r.says || '')
      : 'research started ' + e(S.when(r.created_at)) + ' and has not finished.');
  });
  var mail = d.email_failures.map(function (m) {
    return 'To ' + e(m.to_email) + ' (' + e(m.kind) + '), ' + e(S.when(m.created_at)) + ': ' + e(m.reason || 'no reason given');
  });
  var due = d.past_due.map(function (p) {
    return e(p.name || p.email) + ' (' + e(p.email) + '): the last payment for their ' + e(p.bundle || p.plan) + ' plan failed.';
  });
  var joined = d.joined.map(function (j) { return e(j.name || j.email) + ' (' + e(j.email) + '), ' + e(S.when(j.created_at)); });
  var topups = d.topups.map(function (t) { return e(t.email) + ' bought ' + t.units + ' ' + e(t.kind.replace(/_/g, ' ')) + 's, ' + e(S.when(t.created_at)); });
  main.innerHTML = '<p><strong>' + e(d.says) + '</strong></p>'
    + S.section('Alerts', alerts, 'No open alerts.')
    + S.section('Payments that failed', due, 'No failed payments.')
    + S.section('Builds that need a look', builds, 'No failed or stuck builds this week.')
    + S.section('Compliance research that needs a look', research, 'No failed or stuck research this week.')
    + S.section('Emails that did not send', mail, 'Every email this week went out.')
    + S.section('New members this week', joined, 'Nobody new this week.')
    + S.section('Top-ups bought this week', topups, 'No top-ups this week.');
});

document.addEventListener('click', async function (ev) {
  var t = ev.target, S = Staff;
  try {
    if (t.dataset.ack) {
      t.disabled = true;
      await S.send('/api/console/alerts/' + t.dataset.ack + '/ack');
      S.say('Marked as in hand.'); location.reload();
    } else if (t.dataset.resolve) {
      var note = document.getElementById('note-' + t.dataset.resolve).value.trim();
      if (!note) { S.say('Say what was done about it first, even briefly.'); document.getElementById('note-' + t.dataset.resolve).focus(); return; }
      t.disabled = true;
      await S.send('/api/console/alerts/' + t.dataset.resolve + '/resolve', { note: note });
      S.say('Resolved.'); location.reload();
    }
  } catch (e) { t.disabled = false; S.say(e.message); }
});
