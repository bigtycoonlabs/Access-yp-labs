// MONEY: recurring revenue, top-ups, and what Penny cost to run this month.
Staff.load(async function (main) {
  var S = Staff, e = S.esc;
  var d = await S.get('/money');
  var margin = d.recurring_cents + d.topup_cents - d.model_cost_cents;
  S.say('Recurring revenue ' + S.dollars(d.recurring_cents) + ' a month. Penny cost ' + S.dollars(d.model_cost_cents) + ' so far this month.');
  var plans = d.plans.map(function (p) {
    return e(p.name) + ', paid ' + e(p.billing || 'monthly') + ': ' + S.plural(p.n, 'subscriber', 'subscribers') + ', '
      + S.dollars(p.monthly_cents) + ' a month.';
  });
  var tops = d.topups.map(function (t) { return S.plural(t.n, 'top-up', 'top-ups') + ' for ' + e(t.kind.replace(/_/g, ' ')) + 's: ' + S.dollars(t.cents) + '.'; });
  var cost = d.cost_by_purpose.map(function (c) { return e(c.purpose) + ': ' + S.plural(c.calls, 'call', 'calls') + ', ' + S.dollars(c.cents) + '.'; });
  // One column of sentences, not a grid of figures: the workspace rule (test/today-screen.test.js).
  main.innerHTML = '<section class="panel" aria-labelledby="s-month"><h2 id="s-month">This month</h2>'
    + '<p>Recurring revenue is <strong>' + S.dollars(d.recurring_cents) + ' a month</strong>. Top-ups brought in '
    + S.dollars(d.topup_cents) + '. Penny cost ' + S.dollars(d.model_cost_cents) + ' to run, which leaves <strong>'
    + S.dollars(margin) + '</strong>.</p></section>'
    + '<p class="muted">Yearly plans are counted at a twelfth of their price. Hosting, storage and the payment processor\u2019s fees are not included.'
    + (d.unpriced_calls ? ' ' + S.plural(d.unpriced_calls, 'model call has', 'model calls have') + ' no known price and are not in the cost.' : '') + '</p>'
    + S.section('Active plans', plans, 'Nobody is on a paid plan yet.')
    + S.section('Top-ups this month', tops, 'No top-ups this month.')
    + S.section('What Penny cost this month, by kind of work', cost, 'No model use recorded this month.');
});
