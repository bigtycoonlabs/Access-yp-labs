// MEMBERS: who is here, on what plan, using how much. Owners can suspend, restore and message.
var members = [];
function render(filter) {
  var S = Staff, e = S.esc;
  var f = String(filter || '').toLowerCase();
  var list = members.filter(function (m) {
    return !f || (m.email + ' ' + (m.name || '') + ' ' + m.plan_name).toLowerCase().indexOf(f) >= 0;
  });
  var paying = members.filter(function (m) { return m.plan && m.plan_status === 'active'; }).length;
  document.getElementById('summary').textContent = S.plural(members.length, 'member', 'members') + ', ' + paying + ' paying. '
    + (f ? 'Showing ' + list.length + ' that match.' : '');
  document.getElementById('list').innerHTML = list.length ? list.map(function (m) {
    var staff = ['staff', 'admin', 'master_staff'].indexOf(m.role) >= 0;
    return '<li><strong>' + e(m.name || m.email) + '</strong>, ' + e(m.email) + '. '
      + (staff ? 'Staff. ' : '') + e(m.plan_name)
      + (m.plan ? ', paid ' + e(m.billing || 'monthly') + (m.plan_status === 'past_due' ? ', last payment failed' : '') : '') + '. '
      + (m.status !== 'active' ? '<strong>Account ' + e(m.status) + '.</strong> ' : '')
      + 'This month: ' + S.plural(m.messages, 'message', 'messages') + ', ' + S.plural(m.builds, 'build', 'builds') + ', '
      + S.plural(m.research, 'compliance search', 'compliance searches') + ', costing ' + S.dollars(m.cost_cents) + '. '
      + S.plural(m.businesses, 'business', 'businesses') + '. Joined ' + e(S.when(m.created_at))
      + ', last used Penny ' + e(S.when(m.last_active)) + '.'
      + '<div class="row-actions">'
      + (m.status === 'suspended'
        ? '<button class="btn plain" type="button" data-restore="' + e(m.id) + '">Restore ' + e(m.name || m.email) + '</button>'
        : '<button class="btn plain" type="button" data-suspend="' + e(m.id) + '">Suspend ' + e(m.name || m.email) + '</button>')
      + '<button class="btn plain" type="button" data-message="' + e(m.id) + '">Email ' + e(m.name || m.email) + '</button>'
      + '</div><div id="msg-' + e(m.id) + '"></div></li>';
  }).join('') : '<li>Nobody matches.</li>';
}
Staff.load(async function (main) {
  var d = await Staff.get('/members');
  members = d.members;
  main.innerHTML = '<label class="field" for="find">Find a member by name, email or plan</label>'
    + '<input class="box" id="find" type="search" autocomplete="off"/>'
    + '<p id="summary"></p><section class="panel" aria-label="Members"><ul class="lines" id="list"></ul></section>';
  render('');
  document.getElementById('find').addEventListener('input', function (ev) { render(ev.target.value); });
});
document.addEventListener('click', async function (ev) {
  var t = ev.target, S = Staff, d = t.dataset;
  var who = function (id) { var m = members.find(function (x) { return x.id === id; }); return m ? (m.name || m.email) : 'this member'; };
  try {
    if (d.suspend) {
      if (!confirm('Suspend ' + who(d.suspend) + '? They will be signed out and cannot sign in until restored.')) return;
      await S.send('/api/admin/users/' + d.suspend + '/suspend'); S.say(who(d.suspend) + ' is suspended.'); location.reload();
    } else if (d.restore) {
      await S.send('/api/admin/users/' + d.restore + '/restore'); S.say(who(d.restore) + ' is restored.'); location.reload();
    } else if (d.message) {
      var box = document.getElementById('msg-' + d.message);
      box.innerHTML = '<label class="field" for="subj-' + d.message + '">Subject</label><input class="box" id="subj-' + d.message + '" type="text"/>'
        + '<label class="field" for="body-' + d.message + '">Message</label><textarea class="box" id="body-' + d.message + '" rows="5"></textarea>'
        + '<div class="row-actions"><button class="btn" type="button" data-sendmsg="' + d.message + '">Send the email</button></div>';
      document.getElementById('subj-' + d.message).focus();
    } else if (d.sendmsg) {
      t.disabled = true;
      await S.send('/api/admin/users/' + d.sendmsg + '/message', {
        subject: document.getElementById('subj-' + d.sendmsg).value.trim(),
        body: document.getElementById('body-' + d.sendmsg).value.trim() });
      document.getElementById('msg-' + d.sendmsg).innerHTML = '';
      S.say('Your email to ' + who(d.sendmsg) + ' was sent.');
    }
  } catch (e) { t.disabled = false; S.say(e.message); }
});
