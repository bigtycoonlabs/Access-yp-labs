// EMAIL: what went out and what did not, newest first.
Staff.load(async function (main) {
  var S = Staff, e = S.esc;
  var d = await S.get('/email');
  var failed = d.recent.filter(function (m) { return !m.sent; }).length;
  S.say(failed ? S.plural(failed, 'of the latest emails did not send', 'of the latest emails did not send') + '.' : 'The latest emails all went out.');
  var kinds = d.by_kind.map(function (k) {
    return e(k.kind) + ': ' + S.plural(k.n, 'email', 'emails') + (k.failed ? ', ' + k.failed + ' not sent' : ', all sent') + '.';
  });
  var recent = d.recent.map(function (m) {
    return (m.sent ? 'Sent' : '<strong>Not sent</strong>') + ' to ' + e(m.to_email) + ', ' + e(m.kind) + ', ' + e(S.when(m.created_at))
      + (m.sent ? '.' : ': ' + e(m.reason || 'no reason given') + '.');
  });
  main.innerHTML = S.section('The last 30 days, by kind', kinds, 'No email in the last 30 days.')
    + S.section('Latest', recent, 'No email has been sent yet.');
});
