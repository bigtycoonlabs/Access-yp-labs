// PENNY: is she working. Model use, compliance research, builds and launches.
Staff.load(async function (main) {
  var S = Staff, e = S.esc;
  var d = await S.get('/penny');
  var total = d.calls.reduce(function (n, c) { return n + c.calls; }, 0);
  var failedRuns = (d.research.find(function (r) { return r.status === 'failed'; }) || { n: 0 }).n;
  var failedBuilds = (d.builds.find(function (b) { return b.status === 'failed'; }) || { n: 0 }).n;
  S.say(S.plural(total, 'model call', 'model calls') + ' this week. ' + S.plural(failedRuns, 'research run', 'research runs') + ' and '
    + S.plural(failedBuilds, 'build', 'builds') + ' failed.');
  var calls = d.calls.map(function (c) {
    return e(c.purpose) + ': ' + S.plural(c.calls, 'call', 'calls') + ', ' + c.input.toLocaleString('en-US') + ' tokens in and '
      + c.output.toLocaleString('en-US') + ' out, ' + S.dollars(c.cents) + '.';
  });
  var research = d.research.map(function (r) {
    return S.plural(r.n, 'run', 'runs') + ' ' + e(r.status) + (r.avg_minutes != null ? ', taking ' + r.avg_minutes + ' minutes on average' : '') + '.';
  });
  var builds = d.builds.map(function (b) { return S.plural(b.n, 'build', 'builds') + ' ' + e(b.status) + '.'; });
  var launches = d.launches.map(function (l) { return e(l.step) + ' step ' + e(l.status) + ': ' + l.n + '.'; });
  var f = d.findings || { n: 0, official: 0 };
  main.innerHTML = '<p>Penny runs on ' + e(d.model) + '.</p>'
    + S.section('Model use this week', calls, 'No model calls this week.')
    + S.section('Compliance research this week', research, 'No research this week.')
    + '<p>In the last 30 days Penny kept ' + S.plural(f.n, 'finding', 'findings') + ', ' + f.official + ' of them backed by a government page.</p>'
    + S.section('Builds this week', builds, 'No builds this week.')
    + S.section('Launches in the last 30 days', launches, 'No launches yet.');
});
