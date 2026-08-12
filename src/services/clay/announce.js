// ANNOUNCEMENTS — a message from Clay to everyone who has an account.
//
// This is deliberately separate from Clay Weekly. The magazine is something people opted into and
// can leave; an announcement is an ACCOUNT NOTICE — a change to what someone pays, what they own,
// or what they were promised. Those go to everyone with an account, including people who left the
// magazine, because opting out of a newsletter is not opting out of being told your terms changed.
//
// That distinction cuts both ways, and the rules here enforce it:
//   * Announcements must be rare and must actually matter. If it could go in the magazine, it should.
//   * Every send is recorded by key, and the same announcement can NEVER go out twice — a duplicate
//     "we're changing your pricing" email is its own small betrayal of trust.
//   * The count reported is what the mail provider accepted, never what we hoped for.
//   * Nothing sends without a human deciding. There is no schedule and no automatic trigger.

const { query } = require('../../config/db');
const { sendBatch } = require('../email');

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');

// The pricing change, written as Clay would say it: what changed, what it means for you, and the
// part most companies bury — what you are NOT losing.
function pricingChange() {
  const url = SITE();
  const text = `Hi {{name}},

Clay here. We have changed how Access YP Labs charges, and I would rather you hear it from me than notice it on a statement.

Your first project is now free. Not a trial — free, in full, and with no time limit. You can build it with me, upload your own material to it, keep adding to it, download it, take it off the platform entirely, work with a launch partner on it, list it in the Exchange, and sell it, without paying anything.

Everything beyond that first project is one plan at $19 a month. It covers unlimited projects, and it now includes the website builder and landing pages, which used to be a separate cost. The images I make while we work are part of it too.

If you were on the $2.99 per-project plan, that plan is finished and you will not be charged again. The project you paid for stays yours, unlocked, permanently — you do not need a plan to keep it, download it, or sell it. If you have other projects you want to unlock as well, the $19 plan covers all of them; if you do not, there is nothing here for you to buy.

Building with me has not changed at all. It is still free and still unlimited. Shape as many projects as you like, for as long as you like, and pay nothing.

I want to be clear that this is a decision, not a correction. Charging for each project made people weigh up whether to have another idea, and that is the exact opposite of what this place is for. We would rather have far more people building, listing and selling than collect a few dollars from the ones already here. We are early enough that we can make that call now, and take the harder road while it is still cheap to choose.

One thing worth stating plainly, since it is easy to misread. When something sells through the Exchange, we take 20% and you keep 80% — that applies to every marketplace sale, whether we sent the buyer or you did. When you sell through the website we build for your project, direct to your own customers, we take nothing at all.

That is the whole change. There is nothing you need to do.

${url}

— Clay`;

  const html = `<p>Hi {{name}},</p>
<p>Clay here. We have changed how Access YP Labs charges, and I would rather you hear it from me than notice it on a statement.</p>
<p><strong>Your first project is now free.</strong> Not a trial — free, in full, and with no time limit. Build it with me, upload your own material, keep adding to it, download it, take it off the platform, work with a launch partner, list it in the Exchange, and sell it, without paying anything.</p>
<p><strong>Everything beyond that first project is one plan at $19 a month.</strong> Unlimited projects, and it now includes the website builder and landing pages, which used to be a separate cost. The images I make while we work are part of it too.</p>
<p><strong>If you were on the $2.99 per-project plan, that plan is finished and you will not be charged again.</strong> The project you paid for stays yours, unlocked, permanently — you do not need a plan to keep it, download it, or sell it. If you have other projects you want to unlock as well, the $19 plan covers all of them; if you do not, there is nothing here for you to buy.</p>
<p><strong>Building with me has not changed at all.</strong> Still free, still unlimited. As many projects as you like, for as long as you like, at no cost.</p>
<p>I want to be clear that this is a decision, not a correction. Charging for each project made people weigh up whether to have another idea, and that is the exact opposite of what this place is for. We would rather have far more people building, listing and selling than collect a few dollars from the ones already here. We are early enough that we can make that call now, and take the harder road while it is still cheap to choose.</p>
<p>One thing worth stating plainly, since it is easy to misread. When something sells <strong>through the Exchange</strong>, we take 20% and you keep 80% — every marketplace sale, whether we sent the buyer or you did. When you sell through <strong>the website we build for your project</strong>, direct to your own customers, we take nothing at all.</p>
<p>That is the whole change. There is nothing you need to do.</p>
<p><a href="${url}">${url.replace(/^https?:\/\//, '')}</a></p>
<p>— Clay</p>`;

  return { key: 'pricing-2026-08', subject: 'A change to what Access YP Labs costs', text, html };
}

const ANNOUNCEMENTS = { 'pricing-2026-08': pricingChange };

function preview(key) {
  const make = ANNOUNCEMENTS[key];
  if (!make) return null;
  const a = make();
  return { key: a.key, subject: a.subject, text: a.text.replace('{{name}}', 'there') };
}

// Has this announcement already gone out? Recorded in email_log, which already exists for exactly
// this purpose — every send attempt, including failures.
async function alreadySent(key) {
  const r = await query(
    `SELECT count(*)::int AS n FROM email_log WHERE kind = $1 AND sent = true`, ['announce:' + key]);
  return (r.rows[0] && r.rows[0].n) > 0;
}

// Send to every account holder. Returns honest counts.
async function send(key) {
  const make = ANNOUNCEMENTS[key];
  if (!make) return { ok: false, reason: 'unknown_announcement' };
  if (await alreadySent(key)) return { ok: false, reason: 'already_sent' };

  const a = make();
  const rec = await query(
    `SELECT id, email, COALESCE(NULLIF(name,''),'there') AS name
       FROM users WHERE email IS NOT NULL AND status <> 'suspended'`);
  if (!rec.rows.length) return { ok: false, reason: 'no_recipients' };

  let sent = 0;
  for (let i = 0; i < rec.rows.length; i += 100) {
    const chunk = rec.rows.slice(i, i + 100).map((u) => ({
      to: u.email,
      subject: a.subject,
      text: a.text.replace('{{name}}', u.name),
      html: a.html.replace('{{name}}', u.name),
    }));
    const out = await sendBatch(chunk);
    sent += (out && out.sent) || 0;
  }

  // Record it so it can never be sent a second time, even from another instance. Recorded as
  // sent ONLY if something actually went out — otherwise a total failure would permanently block
  // the retry of an announcement nobody ever received.
  await query(
    `INSERT INTO email_log (to_email, kind, sent, reason) VALUES ($1,$2,$3,$4)`,
    ['(all accounts)', 'announce:' + key, sent > 0, `delivered ${sent} of ${rec.rows.length}`]);

  // Zero delivered is NOT success, however cleanly the code ran. Reporting ok on an announcement
  // that reached nobody would let someone believe their creators had been told when they had not —
  // and they would find out from the confusion afterwards.
  if (sent === 0) {
    return { ok: false, reason: 'nothing_delivered', sent: 0, attempted: rec.rows.length,
      message: `Nothing was delivered. All ${rec.rows.length} attempts failed, so nobody has been told. `
        + 'The announcement has NOT been marked as sent, so it can be tried again.' };
  }
  if (sent < rec.rows.length) {
    return { ok: true, sent, attempted: rec.rows.length,
      message: `Sent to ${sent} of ${rec.rows.length}. The rest did not go through — that difference is real, not a rounding.` };
  }
  return { ok: true, sent, attempted: rec.rows.length, message: `Sent to all ${sent}.` };
}

module.exports = { preview, send, alreadySent, ANNOUNCEMENTS };
