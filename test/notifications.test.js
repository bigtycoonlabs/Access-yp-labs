'use strict';
// TELLING PEOPLE WHAT HAPPENED.
//
// Everything built this week worked and told nobody. A contributor offered help and the owner found
// out only by opening the project page. A collaboration platform where you have to poll for the
// collaboration is a filing cabinet.
//
// Driven end to end with two accounts against a real Postgres: seat filled, work offered, accepted,
// split proposed, split signed. Each person was told the right thing at the right moment.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const svc = fs.readFileSync('src/services/notify.js', 'utf8');
const route = fs.readFileSync('src/routes/notifications.js', 'utf8');
const sql = fs.readFileSync('docs/migrations/058_notifications.sql', 'utf8');

test('in-app is the truth; email is an attempt', () => {
  // Email needs a key that may not be set and a domain that may not be verified. Verified live: with
  // no key in the sandbox, every notification recorded email_status 'failed' with the reason
  // 'email_not_configured' — never 'sent'.
  assert.match(svc, /Record the event, then try to email\. In that order, always/);
  assert.match(svc, /if \(res && res\.sent\) await mark\(row\.id, 'accepted', null, res\.id\);/);
  assert.match(svc, /else await mark\(row\.id, 'failed', \(res && res\.reason\) \|\| 'unknown'\);/);
  assert.match(sql, /email_status IN \('accepted','skipped','failed'\)/);
});

test('a notification never breaks the thing it reports', () => {
  // If telling somebody fails, the contribution was still accepted. Every caller uses safely().
  assert.match(svc, /function safely\(args\)/);
  for (const f of ['src/routes/contributions.js', 'src/routes/seats.js', 'src/routes/agreements.js']) {
    const code = fs.readFileSync(f, 'utf8');
    assert.match(code, /const \{ safely \} = require\('\.\.\/services\/notify'\)/, f);
    assert.ok(!/await notify\(/.test(code), f + ' must not await notify directly');
  }
});

test('the same event cannot be recorded twice', () => {
  // A retry, a double-click, or a route called from two places all collapse to one notification.
  // Verified live: six events, six rows, six distinct keys.
  assert.match(sql, /dedupe_key\s+text NOT NULL UNIQUE/);
  assert.match(svc, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  // And a duplicate is not an error. It is the key doing its job.
  assert.match(svc, /if \(!r\.rows\.length\) return \{ ok: true, duplicate: true \};/);
});

test('the sentence is written now, in full, and stored', () => {
  // "A contribution was accepted" is useless. "Rel accepted your marketing plan at 20%" is not, and
  // rebuilding it later means re-reading records that may have changed since.
  assert.match(sql, /Written for the person receiving it, in a full sentence, at the moment it happened/);
  const c = fs.readFileSync('src/routes/contributions.js', 'utf8');
  assert.match(c, /headline: \(concept\.title \|\| 'A project'\) \+ ' accepted your ' \+ contribution\.kind/);
  assert.match(c, /body: 'You hold ' \+ \(Number\(req\.body\.share_bp\) \/ 100\) \+ '% of the seller side/);
});

test('a no arrives as reliably as a yes, and carries the reason', () => {
  // Somebody left wondering why is worse off than somebody told plainly.
  const c = fs.readFileSync('src/routes/contributions.js', 'utf8');
  assert.match(c, /kind: 'contribution_declined'/);
  assert.match(c, /body: req\.body\.reason\.trim\(\) \+ ' — this costs you nothing/);
});

test('nothing happened is a real answer', () => {
  // A digest that always finds something to celebrate is one nobody believes by week three. Verified
  // live on a fresh account: "Nothing happened on your projects in the last day."
  assert.match(route, /No invented encouragement on an empty day/);
  assert.match(route, /'Nothing new on your projects in the last '/);
  // And it counts UNREAD only. Somebody who has read and acted on everything was still being shown
  // it under "While you were away" — if you have read it, you were not away, and repeating it every
  // morning teaches people to skip the one panel whose whole job is being worth reading.
  assert.match(route, /WHERE user_id=\$1 AND read_at IS NULL/);
  assert.match(route, /Nothing has happened on your projects yet/);
  // A bare 0 and a failed read look identical, so the summary is words.
  assert.match(route, /Said in words, because a bare 0 and a failed read look identical/);
});

test('an unreadable preference means silence, not a send', () => {
  // Failing open on an email preference means mailing somebody who may have opted out.
  assert.match(svc, /return false;\s*\/\/ could not read the preference, so do not send/);
  // But a missing row means yes: somebody whose work is waiting on a decision needs to know, and
  // treating an absent preference as "no" would silence everybody who never found the setting.
  assert.match(svc, /return !r\.rows\.length \|\| r\.rows\[0\]\.team_activity !== false;/);
});

test('marking something read twice is a person clicking twice', () => {
  assert.match(route, /Already read is not an error/);
  assert.match(route, /res\.json\(\{ ok: true, changed: r\.rows\.length > 0 \}\)/);
});

test('it is mounted and the migration is registered', () => {
  assert.match(fs.readFileSync('src/server.js', 'utf8'),
    /app\.use\('\/api\/notifications', require\('\.\/routes\/notifications'\)\)/);
  assert.ok(fs.readFileSync('docs/migrations/ORDER.txt', 'utf8').includes('058_notifications.sql'));
});

test('the overnight report is on the dashboard, above everything that did not change', () => {
  // The endpoint existed with no screen in front of it — the same gap the seats board had, and the
  // reason it kept being the last thing built. An API nobody can see is an API that does not exist.
  const dash = fs.readFileSync('public/dashboard.html', 'utf8');
  const js = fs.readFileSync('public/js/dashboard.js', 'utf8');
  assert.match(dash, /<section aria-labelledby="away-h" id="away-sec"/);
  assert.match(js, /async function loadAway\(\)/);
  assert.match(js, /loadAway\(\); loadPath\(\);/);
  // It leads the page. Everything below it was here yesterday; this is the only thing that changed.
  const order = [...dash.matchAll(/<h2 id="([a-z]+)-h"/g)].map((m) => m[1]);
  assert.strictEqual(order[0], 'away');
  assert.strictEqual(order[1], 'con');
});

test('a quiet morning is shown, not hidden', () => {
  // A panel that only appears on good days trains people to read its absence as bad news. Verified
  // in a browser on an account with everything read: "Nothing new on your projects in the last day."
  const js = fs.readFileSync('public/js/dashboard.js', 'utf8');
  assert.match(js, /Nothing happened is a real answer and it is shown, not hidden/);
  assert.match(js, /sec\.hidden = false;\s*\n\s*host\.innerHTML = '';/);
});

test('a failed read is not a quiet night', () => {
  // On the one panel whose entire job is telling you what is true, saying "nothing happened" when
  // we could not look would be inventing a fact out of a network error.
  const js = fs.readFileSync('public/js/dashboard.js', 'utf8');
  assert.match(js, /That is a failed read, '\s*\n?\s*\+ 'not a quiet night/);
});


test('"accepted" is not "delivered", and the word is chosen', () => {
  // A 200 from Resend means the provider TOOK the message. It does not mean anybody received it.
  //
  // Deliverability was verified separately and it works: a real send from clay@accessyplabs.com came
  // back "delivered" in the provider's dashboard. But that was checked THERE, not here, and this
  // platform cannot know it — the one webhook on the Resend account is disabled and points at
  // accessyourplace.com, a different platform. So a bounce is invisible here.
  //
  // Writing 'sent' would be this codebase's signature defect appearing in its own records:
  // reporting success for something it never verified.
  // Checked against CODE, not the comments explaining the choice. My assertion failed on the very
  // comment saying why 'sent' is wrong — the fourth time this session a test of mine has matched my
  // own prose instead of the product. The comment strip has to remove inline trailing comments too,
  // not only whole-line ones.
  const code = svc.split('\n').map(function (l) { return l.replace(/\/\/.*/, ' '); }).join('\n');
  assert.ok(!/'sent'/.test(code), 'no status called sent');
  assert.match(svc, /means the provider took the message, not/);
  // And the caller cannot misread the return value either.
  assert.match(svc, /handedOff: !!\(res && res\.sent\)/);
  assert.ok(!/emailed:/.test(code), 'no caller-facing emailed flag');
});

test('the provider id is kept so a bounce can be traced later', () => {
  // sendEmail already returned it and the first version threw it away. Discarding it is what makes
  // tracing impossible once a webhook exists, and by then the connection to the person is gone.
  assert.match(sql, /email_provider_id text/);
  assert.match(svc, /email_provider_id=COALESCE\(\$4, email_provider_id\)/);
});
